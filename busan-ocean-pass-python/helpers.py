import math
import os
import json
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()

CONGESTION_WINDOW_MINUTES = int(os.getenv('CONGESTION_WINDOW_MINUTES', '60'))
CONGESTION_HIGH_THRESHOLD = int(os.getenv('CONGESTION_HIGH_THRESHOLD', '20'))
CONGESTION_MID_THRESHOLD  = int(os.getenv('CONGESTION_MID_THRESHOLD',  '8'))


def haversine_distance(lat1, lon1, lat2, lon2):
    R = 6_371_000
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (math.sin(d_lat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(d_lon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def get_congestion(spot_id, conn):
    window_start = (datetime.now() - timedelta(minutes=CONGESTION_WINDOW_MINUTES))\
        .strftime('%Y-%m-%d %H:%M:%S')
    row = conn.execute(
        'SELECT COUNT(*) AS cnt FROM stamp_logs WHERE spot_id = ? AND verified_at >= ?',
        (spot_id, window_start)
    ).fetchone()
    count = row[0] if row else 0

    if count >= CONGESTION_HIGH_THRESHOLD:
        return {'level': 'high', 'label': '혼잡', 'emoji': '🔴', 'multiplier': 1.0, 'recentCount': count}
    if count >= CONGESTION_MID_THRESHOLD:
        return {'level': 'mid', 'label': '보통', 'emoji': '🟡', 'multiplier': 1.5, 'recentCount': count}
    return {'level': 'low', 'label': '여유', 'emoji': '🟢', 'multiplier': 2.0, 'recentCount': count}


def recalculate_user_stamps(user_id, conn):
    stamp_total = conn.execute(
        'SELECT COALESCE(SUM(earned_count), 0) FROM stamp_logs WHERE user_id = ?',
        (user_id,)
    ).fetchone()[0]

    review_total = conn.execute(
        'SELECT COALESCE(SUM(bonus_stamp_given), 0) FROM reviews WHERE user_id = ?',
        (user_id,)
    ).fetchone()[0]

    wiki_total = conn.execute(
        "SELECT COALESCE(SUM(reward_stamps), 0) FROM wiki_posts WHERE user_id = ? AND status = 'approved'",
        (user_id,)
    ).fetchone()[0]

    mission_total = conn.execute(
        'SELECT COALESCE(SUM(m.bonus_stamps), 0) FROM mission_completions mc '
        'JOIN missions m ON m.id = mc.mission_id WHERE mc.user_id = ?',
        (user_id,)
    ).fetchone()[0]

    reward_total = conn.execute(
        'SELECT COALESCE(SUM(stamp_cost), 0) FROM rewards WHERE user_id = ?',
        (user_id,)
    ).fetchone()[0]

    new_total = max(0, stamp_total + review_total + wiki_total + mission_total - reward_total)
    conn.execute('UPDATE users SET total_stamps = ? WHERE id = ?', (new_total, user_id))
    conn.commit()
    return new_total


def check_and_complete_missions(user_id, conn):
    missions = conn.execute(
        'SELECT id, name_ko, name_en, required_spot_ids, bonus_stamps, bonus_reward '
        'FROM missions WHERE is_active = 1'
    ).fetchall()

    visited_rows = conn.execute(
        'SELECT DISTINCT spot_id FROM stamp_logs WHERE user_id = ?', (user_id,)
    ).fetchall()
    visited_set = {r[0] for r in visited_rows}

    completed_rows = conn.execute(
        'SELECT mission_id FROM mission_completions WHERE user_id = ?', (user_id,)
    ).fetchall()
    completed_set = {r[0] for r in completed_rows}

    newly_completed = []

    for m in missions:
        mission_id = m[0]
        if mission_id in completed_set:
            continue
        try:
            required_ids = json.loads(m[3] or '[]')
        except Exception:
            required_ids = []
        if not required_ids:
            continue
        if not all(sid in visited_set for sid in required_ids):
            continue
        try:
            conn.execute(
                'INSERT INTO mission_completions (user_id, mission_id) VALUES (?, ?)',
                (user_id, mission_id)
            )
            newly_completed.append({
                'id': mission_id,
                'name_ko': m[1],
                'name_en': m[2],
                'bonus_stamps': m[4],
                'bonus_reward': m[5],
            })
        except Exception as e:
            if 'UNIQUE' not in str(e):
                print(f'[미션] INSERT 실패: {e}')

    if newly_completed:
        conn.commit()
        recalculate_user_stamps(user_id, conn)

    return newly_completed


def get_localized_field(obj, lang, field_prefix):
    supported = ['ko', 'en', 'ja', 'zh']
    safe_lang = lang if lang in supported else 'ko'
    key = f'{field_prefix}_{safe_lang}'
    fallback = f'{field_prefix}_ko'
    val = obj.get(key)
    if val:
        return val
    return obj.get(fallback, '')
