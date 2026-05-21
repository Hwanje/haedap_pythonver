import os
from datetime import datetime, timedelta

import bcrypt
from flask import Blueprint, g, jsonify, request

from db import get_db, q_one, q_all, q_run
from helpers import recalculate_user_stamps
from middleware import require_admin

admin_bp = Blueprint('admin', __name__)

MASTER_ADMIN_EMAIL = os.getenv('MASTER_ADMIN_EMAIL', '').strip().lower()
DEFAULT_REWARD_STAMPS = {'event': 10, 'hidden_spot': 15, 'safety': 20, 'tip': 5, 'food': 8}


def _is_master_admin():
    return bool(MASTER_ADMIN_EMAIL and g.user.get('email', '').lower() == MASTER_ADMIN_EMAIL)


@admin_bp.route('/wiki/pending', methods=['GET'])
@require_admin
def wiki_pending():
    db    = get_db()
    posts = q_all(db,
        'SELECT wp.id, wp.title, wp.content, wp.category, wp.spot_id, wp.photo_url, '
        'wp.event_start_date, wp.event_end_date, wp.status, wp.created_at, '
        'u.id AS user_id, u.nickname AS author_nickname, u.email AS author_email, '
        's.name_ko AS spot_name_ko '
        'FROM wiki_posts wp JOIN users u ON u.id = wp.user_id '
        "LEFT JOIN spots s ON s.id = wp.spot_id WHERE wp.status = 'pending' ORDER BY wp.created_at ASC"
    )
    return jsonify({'success': True, 'count': len(posts), 'data': posts})


@admin_bp.route('/wiki/<post_id>', methods=['PATCH'])
@require_admin
def review_wiki(post_id):
    data         = request.get_json() or {}
    action       = data.get('action')
    admin_note   = data.get('admin_note')
    reward_stamps = data.get('reward_stamps')

    if action not in ('approve', 'reject'):
        return jsonify({'success': False, 'message': "action은 'approve' 또는 'reject'이어야 합니다."}), 400

    db   = get_db()
    post = q_one(db,
        'SELECT id, user_id, category, status, title FROM wiki_posts WHERE id = ?',
        (post_id,)
    )
    if not post:
        return jsonify({'success': False, 'message': '위키 게시글을 찾을 수 없습니다.'}), 404
    if post['status'] != 'pending':
        return jsonify({
            'success': False,
            'message': f'이미 처리된 게시글입니다. 현재 상태: {post["status"]}',
            'current_status': post['status'],
        }), 409

    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    if action == 'approve':
        if reward_stamps is not None:
            final_stamps = max(0, int(reward_stamps or 0))
        else:
            final_stamps = DEFAULT_REWARD_STAMPS.get(post['category'], 0)

        if final_stamps > 1000:
            return jsonify({'success': False, 'message': 'reward_stamps는 0 이상 1000 이하여야 합니다.'}), 400

        q_run(db,
            "UPDATE wiki_posts SET status = 'approved', admin_note = ?, "
            'reviewed_by = ?, reviewed_at = ?, reward_stamps = ? WHERE id = ?',
            (admin_note or None, g.user['id'], now, final_stamps, post_id)
        )
        new_stamps = recalculate_user_stamps(post['user_id'], db)
        author     = q_one(db, 'SELECT nickname FROM users WHERE id = ?', (post['user_id'],))

        return jsonify({
            'success':           True,
            'message':           f"'{post['title']}' 게시글이 승인되었습니다.",
            'action':            'approved',
            'reward_stamps':     final_stamps,
            'author_nickname':   author['nickname'] if author else None,
            'author_new_stamps': new_stamps,
        })

    q_run(db,
        "UPDATE wiki_posts SET status = 'rejected', admin_note = ?, "
        'reviewed_by = ?, reviewed_at = ? WHERE id = ?',
        (admin_note or None, g.user['id'], now, post_id)
    )
    return jsonify({
        'success':    True,
        'message':    f"'{post['title']}' 게시글이 거절되었습니다.",
        'action':     'rejected',
        'admin_note': admin_note or None,
    })


@admin_bp.route('/dashboard', methods=['GET'])
@require_admin
def dashboard():
    db          = get_db()
    today       = datetime.now().strftime('%Y-%m-%d')
    seven_ago   = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d %H:%M:%S')

    total_users   = db.execute('SELECT COUNT(*) FROM users').fetchone()[0]
    total_spots   = db.execute('SELECT COUNT(*) FROM spots WHERE is_active = 1').fetchone()[0]
    total_stamps  = db.execute('SELECT COUNT(*) FROM stamp_logs').fetchone()[0]
    total_reviews = db.execute('SELECT COUNT(*) FROM reviews').fetchone()[0]
    total_wiki    = db.execute("SELECT COUNT(*) FROM wiki_posts WHERE status = 'approved'").fetchone()[0]
    pending_wiki  = db.execute("SELECT COUNT(*) FROM wiki_posts WHERE status = 'pending'").fetchone()[0]

    today_users  = db.execute(
        'SELECT COUNT(*) FROM users WHERE created_at >= ?', (f'{today} 00:00:00',)
    ).fetchone()[0]
    today_stamps = db.execute(
        'SELECT COUNT(*) FROM stamp_logs WHERE verified_at >= ?', (f'{today} 00:00:00',)
    ).fetchone()[0]

    popular_spots = q_all(db,
        'SELECT sl.spot_id, s.name_ko, s.name_en, s.category, COUNT(*) AS stamp_count '
        'FROM stamp_logs sl JOIN spots s ON s.id = sl.spot_id '
        'GROUP BY sl.spot_id ORDER BY stamp_count DESC LIMIT 10'
    )

    hourly_rows = q_all(db,
        'SELECT CAST(SUBSTR(verified_at, 12, 2) AS INTEGER) AS hour, COUNT(*) AS cnt '
        'FROM stamp_logs WHERE verified_at >= ? GROUP BY hour ORDER BY hour ASC',
        (seven_ago,)
    )

    hourly = [{'hour': h, 'count': 0} for h in range(24)]
    for row in hourly_rows:
        h = row['hour']
        if 0 <= h <= 23:
            hourly[h]['count'] = row['cnt']

    return jsonify({
        'success': True,
        'data': {
            'summary': {
                'total_users':   total_users,
                'total_spots':   total_spots,
                'total_stamps':  total_stamps,
                'total_reviews': total_reviews,
                'total_wiki':    total_wiki,
                'pending_wiki':  pending_wiki,
            },
            'today': {'new_users': today_users, 'new_stamps': today_stamps, 'date': today},
            'popular_spots':       popular_spots,
            'hourly_distribution': hourly,
            'period_note':         '시간대별 분포는 최근 7일 기준입니다.',
        },
    })


@admin_bp.route('/users', methods=['GET'])
@require_admin
def list_users():
    db    = get_db()
    users = q_all(db,
        'SELECT id, nickname, email, language, role, total_stamps, total_cashback, '
        'is_foreigner, is_tester, created_at FROM users ORDER BY created_at DESC LIMIT 200'
    )
    return jsonify({'success': True, 'count': len(users), 'data': users, 'is_master_admin': _is_master_admin()})


@admin_bp.route('/users/<user_id>/reset-password', methods=['PATCH'])
@require_admin
def reset_password(user_id):
    data         = request.get_json() or {}
    new_password = data.get('new_password', '')

    if not isinstance(new_password, str) or len(new_password) < 6:
        return jsonify({'success': False, 'message': '새 비밀번호는 6자 이상이어야 합니다.'}), 400

    db   = get_db()
    user = q_one(db, 'SELECT id, email, role FROM users WHERE id = ?', (user_id,))
    if not user:
        return jsonify({'success': False, 'message': '사용자를 찾을 수 없습니다.'}), 404

    if user['email'].lower() == MASTER_ADMIN_EMAIL and not _is_master_admin():
        return jsonify({'success': False, 'message': '마스터 어드민 비밀번호는 변경할 수 없습니다.'}), 403

    pw_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt(10)).decode()
    q_run(db, 'UPDATE users SET password_hash = ? WHERE id = ?', (pw_hash, user_id))
    return jsonify({'success': True, 'message': f'{user["email"]} 비밀번호가 재설정되었습니다.'})


@admin_bp.route('/users/<user_id>/tester', methods=['PATCH'])
@require_admin
def set_tester(user_id):
    if not _is_master_admin():
        return jsonify({'success': False, 'message': '마스터 어드민만 테스터를 지정할 수 있습니다.'}), 403

    data      = request.get_json() or {}
    is_tester = 1 if data.get('is_tester') else 0
    db        = get_db()
    user      = q_one(db, 'SELECT id, email, nickname, role FROM users WHERE id = ?', (user_id,))
    if not user:
        return jsonify({'success': False, 'message': '사용자를 찾을 수 없습니다.'}), 404
    if user['role'] == 'admin':
        return jsonify({'success': False, 'message': '어드민 계정에는 테스터 설정이 적용되지 않습니다.'}), 400

    q_run(db, 'UPDATE users SET is_tester = ? WHERE id = ?', (is_tester, user_id))
    action = '테스터로 지정' if is_tester else '테스터 해제'
    return jsonify({'success': True, 'message': f'{user["nickname"]}({user["email"]}) 계정을 {action}했습니다.', 'is_tester': is_tester})


@admin_bp.route('/users/tester-by-email', methods=['POST'])
@require_admin
def set_tester_by_email():
    if not _is_master_admin():
        return jsonify({'success': False, 'message': '마스터 어드민만 테스터를 지정할 수 있습니다.'}), 403

    data      = request.get_json() or {}
    email     = data.get('email', '').strip().lower()
    is_tester = 1 if data.get('is_tester') else 0

    if not email:
        return jsonify({'success': False, 'message': '이메일이 필요합니다.'}), 400

    db   = get_db()
    user = q_one(db, 'SELECT id, email, nickname, role FROM users WHERE email = ?', (email,))
    if not user:
        return jsonify({'success': False, 'message': '해당 이메일 계정을 찾을 수 없습니다.'}), 404
    if user['role'] == 'admin':
        return jsonify({'success': False, 'message': '어드민 계정에는 테스터 설정이 적용되지 않습니다.'}), 400

    q_run(db, 'UPDATE users SET is_tester = ? WHERE id = ?', (is_tester, user['id']))
    action = '테스터로 지정' if is_tester else '테스터 해제'
    return jsonify({
        'success':   True,
        'message':   f'{user["nickname"]}({user["email"]}) 계정을 {action}했습니다.',
        'user_id':   user['id'],
        'is_tester': is_tester,
    })
