import math
import os
from datetime import datetime, timedelta

from flask import Blueprint, g, jsonify, request

from db import get_db, q_one, q_all, q_run
from helpers import (haversine_distance, get_congestion,
                     recalculate_user_stamps, check_and_complete_missions,
                     get_localized_field)
from middleware import authenticate_token

stamps_bp = Blueprint('stamps', __name__)

GPS_VERIFY_RADIUS = int(os.getenv('GPS_VERIFY_RADIUS_METERS', '200'))


@stamps_bp.route('/verify', methods=['POST'])
@authenticate_token
def verify():
    data     = request.get_json() or {}
    qr_code  = data.get('qr_code')
    user_lat = data.get('user_lat')
    user_lng = data.get('user_lng')
    user_id  = g.user['id']

    if not qr_code:
        return jsonify({'success': False, 'error': 'qr_code가 필요합니다.'}), 400
    if user_lat is None or user_lng is None:
        return jsonify({'success': False, 'error': 'GPS 좌표(user_lat, user_lng)가 필요합니다.'}), 400

    try:
        lat = float(user_lat)
        lng = float(user_lng)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': '유효하지 않은 GPS 좌표입니다.'}), 400

    if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        return jsonify({'success': False, 'error': 'GPS 좌표 범위를 벗어났습니다.'}), 400

    db   = get_db()
    spot = q_one(db, 'SELECT * FROM spots WHERE qr_code = ?', (qr_code,))
    if not spot:
        return jsonify({'success': False, 'error': '존재하지 않는 QR 코드입니다.'}), 404
    if not spot['is_active']:
        return jsonify({'success': False, 'error': '현재 인증이 비활성화된 명소입니다.'}), 400

    dist = round(haversine_distance(lat, lng, spot['latitude'], spot['longitude']))
    if dist > GPS_VERIFY_RADIUS:
        return jsonify({
            'success': False,
            'error': f'명소에서 너무 멀리 있습니다. 현재 거리: {dist}m (허용: {GPS_VERIFY_RADIUS}m)',
            'distance_meters': dist,
            'limit_meters':    GPS_VERIFY_RADIUS,
        }), 403

    one_day_ago = (datetime.now() - timedelta(hours=24)).strftime('%Y-%m-%d %H:%M:%S')
    if q_one(db,
        'SELECT id FROM stamp_logs WHERE user_id = ? AND spot_id = ? AND verified_at >= ?',
        (user_id, spot['id'], one_day_ago)
    ):
        return jsonify({'success': False, 'error': '24시간 내 이미 인증한 명소입니다.'}), 409

    cong         = get_congestion(spot['id'], db)
    multiplier   = cong['multiplier']
    earned_count = math.ceil(spot['base_stamp_count'] * multiplier)
    verified_at  = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    q_run(db,
        'INSERT INTO stamp_logs '
        '(user_id, spot_id, earned_count, multiplier, verification_method, user_lat, user_lng, verified_at) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        (user_id, spot['id'], earned_count, multiplier, 'qr_gps', lat, lng, verified_at)
    )

    new_total          = recalculate_user_stamps(user_id, db)
    completed_missions = check_and_complete_missions(user_id, db)

    return jsonify({
        'success': True,
        'spot': {'id': spot['id'], 'name': spot['name_ko'], 'category': spot['category'], 'address': spot['address']},
        'earned_count':       earned_count,
        'multiplier':         multiplier,
        'congestion':         {'level': cong['level'], 'label': cong['label'], 'emoji': cong['emoji']},
        'distance_meters':    dist,
        'new_total_stamps':   new_total,
        'completed_missions': completed_missions,
    }), 201


@stamps_bp.route('/my', methods=['GET'])
@authenticate_token
def my_stamps():
    lang    = request.args.get('lang', 'ko')
    user_id = g.user['id']
    db      = get_db()

    logs = q_all(db,
        'SELECT sl.id, sl.earned_count, sl.multiplier, sl.verification_method, '
        'sl.user_lat, sl.user_lng, sl.verified_at, '
        's.id AS spot_id, s.name_ko, s.name_en, s.name_ja, s.name_zh, '
        's.category, s.address, s.image_url '
        'FROM stamp_logs sl JOIN spots s ON s.id = sl.spot_id '
        'WHERE sl.user_id = ? ORDER BY sl.verified_at DESC',
        (user_id,)
    )

    formatted = [{
        'id':                  log['id'],
        'spot_id':             log['spot_id'],
        'spot_name':           get_localized_field(log, lang, 'name'),
        'spot_category':       log['category'],
        'spot_address':        log['address'],
        'spot_image_url':      log['image_url'],
        'earned_count':        log['earned_count'],
        'multiplier':          log['multiplier'],
        'verification_method': log['verification_method'],
        'user_lat':            log['user_lat'],
        'user_lng':            log['user_lng'],
        'verified_at':         log['verified_at'],
    } for log in logs]

    user = q_one(db, 'SELECT total_stamps FROM users WHERE id = ?', (user_id,))
    return jsonify({
        'success':      True,
        'count':        len(formatted),
        'total_stamps': user['total_stamps'] if user else 0,
        'logs':         formatted,
    })


@stamps_bp.route('/progress', methods=['GET'])
@authenticate_token
def progress():
    lang    = request.args.get('lang', 'ko')
    user_id = g.user['id']
    db      = get_db()

    all_spots = q_all(db,
        'SELECT id, name_ko, name_en, name_ja, name_zh, category, address, image_url, '
        'order_in_route, base_stamp_count FROM spots WHERE is_active = 1 ORDER BY order_in_route ASC'
    )

    visited_rows = q_all(db, 'SELECT DISTINCT spot_id FROM stamp_logs WHERE user_id = ?', (user_id,))
    visited_set  = {r['spot_id'] for r in visited_rows}

    total_spots    = len(all_spots)
    visited_count  = len(visited_set)
    progress_pct   = round((visited_count / total_spots) * 1000) / 10 if total_spots else 0

    category_map = {}
    for s in all_spots:
        cat = s['category']
        if cat not in category_map:
            category_map[cat] = {'total': 0, 'visited': 0}
        category_map[cat]['total'] += 1
        if s['id'] in visited_set:
            category_map[cat]['visited'] += 1

    category_stats = {
        cat: {
            'total':   v['total'],
            'visited': v['visited'],
            'percent': round((v['visited'] / v['total']) * 1000) / 10 if v['total'] else 0,
        } for cat, v in category_map.items()
    }

    unvisited = [s for s in all_spots if s['id'] not in visited_set]
    cong_order = {'low': 0, 'mid': 1, 'high': 2}
    for s in unvisited:
        s['_cong'] = get_congestion(s['id'], db)
    unvisited.sort(key=lambda x: (cong_order[x['_cong']['level']], x['order_in_route']))

    next_recommended = [{
        'id':             s['id'],
        'name':           get_localized_field(s, lang, 'name'),
        'category':       s['category'],
        'address':        s['address'],
        'image_url':      s['image_url'],
        'order_in_route': s['order_in_route'],
        'congestion': {
            'level':      s['_cong']['level'],
            'label':      s['_cong']['label'],
            'emoji':      s['_cong']['emoji'],
            'multiplier': s['_cong']['multiplier'],
        },
    } for s in unvisited[:3]]

    return jsonify({
        'success':          True,
        'visited_count':    visited_count,
        'total_spots':      total_spots,
        'progress_percent': progress_pct,
        'category_stats':   category_stats,
        'next_recommended': next_recommended,
    })
