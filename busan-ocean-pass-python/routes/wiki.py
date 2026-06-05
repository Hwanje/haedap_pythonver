
import uuid
from datetime import datetime, timedelta, date

from flask import Blueprint, g, jsonify, request

from db import get_db, q_one, q_all, q_run
from helpers import recalculate_user_stamps
from middleware import authenticate_token, optional_auth

wiki_bp = Blueprint('wiki', __name__)

VALID_CATEGORIES = ['event', 'hidden_spot', 'safety', 'tip', 'food']
DEFAULT_REWARD_STAMPS = {'event': 10, 'hidden_spot': 15, 'safety': 20, 'tip': 5, 'food': 8}
HELPFUL_MILESTONE_STAMPS = 10
HELPFUL_MILESTONE_COUNT  = 100


@wiki_bp.route('/', methods=['POST'])
@authenticate_token
def create_wiki():
    data             = request.get_json() or {}
    title            = data.get('title', '')
    content          = data.get('content', '')
    category         = data.get('category')
    spot_id          = data.get('spot_id')
    photo_url        = data.get('photo_url')
    event_start_date = data.get('event_start_date')
    event_end_date   = data.get('event_end_date')

    if not isinstance(title, str) or not title.strip():
        return jsonify({'success': False, 'message': '제목을 입력해주세요.'}), 400
    if not isinstance(content, str) or len(content.strip()) < 20:
        return jsonify({'success': False, 'message': '내용은 20자 이상 입력해주세요.'}), 400
    if category not in VALID_CATEGORIES:
        return jsonify({'success': False, 'message': f'카테고리가 올바르지 않습니다. 허용 값: {", ".join(VALID_CATEGORIES)}'}), 400
    if category == 'event' and (not event_start_date or not event_end_date):
        return jsonify({'success': False, 'message': '이벤트 카테고리는 시작일과 종료일이 필수입니다.'}), 400

    db          = get_db()
    window_start = (datetime.now() - timedelta(hours=24)).strftime('%Y-%m-%d %H:%M:%S')

    if q_one(db,
        'SELECT id FROM wiki_posts WHERE user_id = ? AND title = ? AND category = ? AND created_at >= ?',
        (g.user['id'], title.strip(), category, window_start)
    ):
        return jsonify({'success': False, 'message': '24시간 내에 동일한 제목과 카테고리로 이미 제보하셨습니다.'}), 409

    if spot_id and not q_one(db, 'SELECT id FROM spots WHERE id = ?', (spot_id,)):
        return jsonify({'success': False, 'message': '존재하지 않는 명소 ID입니다.'}), 400

    post_id = str(uuid.uuid4())
    now     = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    q_run(db,
        "INSERT INTO wiki_posts (id, user_id, title, content, category, spot_id, photo_url, "
        "event_start_date, event_end_date, status, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
        (post_id, g.user['id'], title.strip(), content.strip(), category,
         spot_id or None, photo_url or None,
         event_start_date or None, event_end_date or None, now)
    )

    expected = DEFAULT_REWARD_STAMPS[category]
    return jsonify({
        'success':                True,
        'message':                '제보가 접수되었습니다. 관리자 검토 후 승인됩니다.',
        'id':                     post_id,
        'status':                 'pending',
        'expected_reward_stamps': expected,
        'reward_notice':          f'승인 시 최대 {expected}개의 스탬프가 지급됩니다.',
    }), 201


@wiki_bp.route('/', methods=['GET'])
def list_wiki():
    category = request.args.get('category')
    spot_id  = request.args.get('spot_id')
    sort     = request.args.get('sort', 'recent')
    today    = date.today().isoformat()
    order_by = 'wp.helpful_count DESC' if sort == 'helpful' else 'wp.created_at DESC'

    conditions = [
        "wp.status = 'approved'",
        "(wp.category != 'event' OR wp.event_end_date IS NULL OR wp.event_end_date >= ?)",
    ]
    params = [today]

    if category:
        if category not in VALID_CATEGORIES:
            return jsonify({'success': False, 'message': f'잘못된 카테고리입니다.'}), 400
        conditions.append('wp.category = ?')
        params.append(category)
    if spot_id:
        conditions.append('wp.spot_id = ?')
        params.append(spot_id)

    where = ' AND '.join(conditions)
    db    = get_db()
    posts = q_all(db,
        f'SELECT wp.id, wp.title, wp.category, wp.spot_id, wp.photo_url, '
        f'wp.event_start_date, wp.event_end_date, wp.helpful_count, wp.view_count, '
        f'wp.reward_stamps, wp.created_at, u.nickname AS author_nickname, '
        f"s.name_ko AS spot_name_ko, s.name_en AS spot_name_en "
        f'FROM wiki_posts wp JOIN users u ON u.id = wp.user_id '
        f'LEFT JOIN spots s ON s.id = wp.spot_id '
        f'WHERE {where} ORDER BY {order_by} LIMIT 100',
        params
    )
    return jsonify({'success': True, 'count': len(posts), 'data': posts})


@wiki_bp.route('/my', methods=['GET'])
@authenticate_token
def my_wiki():
    db    = get_db()
    posts = q_all(db,
        'SELECT wp.id, wp.title, wp.category, wp.spot_id, wp.photo_url, '
        'wp.event_start_date, wp.event_end_date, wp.status, wp.admin_note, '
        'wp.reward_stamps, wp.helpful_count, wp.view_count, wp.created_at, wp.reviewed_at, '
        's.name_ko AS spot_name_ko '
        'FROM wiki_posts wp LEFT JOIN spots s ON s.id = wp.spot_id '
        'WHERE wp.user_id = ? ORDER BY wp.created_at DESC',
        (g.user['id'],)
    )
    return jsonify({'success': True, 'count': len(posts), 'data': posts})


@wiki_bp.route('/<post_id>', methods=['GET'])
@optional_auth
def wiki_detail(post_id):
    db   = get_db()
    post = q_one(db,
        'SELECT wp.*, u.nickname AS author_nickname, '
        's.name_ko AS spot_name_ko, s.name_en AS spot_name_en, '
        's.latitude AS spot_latitude, s.longitude AS spot_longitude '
        'FROM wiki_posts wp JOIN users u ON u.id = wp.user_id '
        'LEFT JOIN spots s ON s.id = wp.spot_id WHERE wp.id = ?',
        (post_id,)
    )
    if not post:
        return jsonify({'success': False, 'message': '위키 게시글을 찾을 수 없습니다.'}), 404

    is_owner = g.user and g.user['id'] == post['user_id']
    if post['status'] != 'approved' and not is_owner:
        return jsonify({'success': False, 'message': '접근 권한이 없습니다.'}), 403

    try:
        db.execute('UPDATE wiki_posts SET view_count = view_count + 1 WHERE id = ?', (post_id,))
        db.commit()
        post['view_count'] = (post.get('view_count') or 0) + 1
    except Exception:
        pass

    return jsonify({'success': True, 'data': post})


@wiki_bp.route('/<post_id>/helpful', methods=['POST'])
@authenticate_token
def helpful(post_id):
    db   = get_db()
    post = q_one(db,
        'SELECT id, user_id, helpful_count, status FROM wiki_posts WHERE id = ?',
        (post_id,)
    )
    if not post:
        return jsonify({'success': False, 'message': '위키 게시글을 찾을 수 없습니다.'}), 404
    if post['status'] != 'approved':
        return jsonify({'success': False, 'message': '승인된 게시글에만 투표할 수 있습니다.'}), 400
    if post['user_id'] == g.user['id']:
        return jsonify({'success': False, 'message': '자신의 게시글에는 도움됨을 누를 수 없습니다.'}), 400
    if q_one(db, 'SELECT id FROM wiki_helpful_votes WHERE user_id = ? AND wiki_post_id = ?',
             (g.user['id'], post_id)):
        return jsonify({'success': False, 'message': '이미 도움됨을 눌렀습니다.'}), 409

    milestone_reached = False
    try:
        cur = db.execute(
            'INSERT INTO wiki_helpful_votes (user_id, wiki_post_id) VALUES (?, ?) '
            'ON CONFLICT (user_id, wiki_post_id) DO NOTHING',
            (g.user['id'], post_id))
        if cur.rowcount == 0:
            db.rollback()
            return jsonify({'success': False, 'message': '이미 도움됨을 눌렀습니다.'}), 409
        db.execute('UPDATE wiki_posts SET helpful_count = helpful_count + 1 WHERE id = ?', (post_id,))
        updated = db.execute('SELECT helpful_count FROM wiki_posts WHERE id = ?', (post_id,)).fetchone()
        new_count = updated[0]

        if new_count == HELPFUL_MILESTONE_COUNT:
            milestone_reached = True
            now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            db.execute(
                "INSERT INTO stamp_logs (user_id, spot_id, earned_count, multiplier, verification_method, verified_at) "
                "VALUES (?, NULL, ?, 1.0, 'wiki_milestone', ?)",
                (post['user_id'], HELPFUL_MILESTONE_STAMPS, now_str)
            )
        db.commit()
    except Exception as e:
        db.rollback()
        return jsonify({'success': False, 'message': '서버 오류가 발생했습니다.'}), 500

    if milestone_reached:
        recalculate_user_stamps(post['user_id'], db)

    return jsonify({
        'success':         True,
        'message':         '도움됨이 반영되었습니다.',
        'helpful_count':   new_count,
        'milestone_bonus': f'축하합니다! 작성자에게 {HELPFUL_MILESTONE_STAMPS}개 보너스 스탬프가 지급되었습니다.' if milestone_reached else None,
    })
