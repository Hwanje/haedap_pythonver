import math
import os
import uuid
from datetime import datetime, timedelta

from flask import Blueprint, g, jsonify, request

from db import get_db, q_one, q_run
from helpers import haversine_distance, get_congestion, recalculate_user_stamps, check_and_complete_missions
from middleware import authenticate_token

qr_bp = Blueprint('qr', __name__)

TOKEN_TTL_MINUTES = 5
GPS_RADIUS_METERS = int(os.getenv('GPS_VERIFY_RADIUS_METERS', '200'))


@qr_bp.route('/generate', methods=['POST'])
@authenticate_token
def generate():
    data     = request.get_json() or {}
    spot_id  = data.get('spot_id')
    user_lat = data.get('user_lat')
    user_lng = data.get('user_lng')

    if not spot_id:
        return jsonify({'success': False, 'message': 'spot_id가 필요합니다.'}), 400

    db   = get_db()
    spot = q_one(db,
        'SELECT id, name_ko, is_active, category, latitude, longitude FROM spots WHERE id = ?',
        (spot_id,)
    )
    if not spot:
        return jsonify({'success': False, 'message': '존재하지 않는 명소입니다.'}), 404
    if not spot['is_active']:
        return jsonify({'success': False, 'message': '현재 비활성화된 명소입니다.'}), 400

    user_row  = q_one(db, 'SELECT is_tester FROM users WHERE id = ?', (g.user['id'],))
    is_tester = user_row and user_row['is_tester'] == 1

    if not is_tester:
        if user_lat is None or user_lng is None:
            return jsonify({'success': False, 'message': '위치 정보가 필요합니다.', 'require_gps': True}), 400
        try:
            lat = float(user_lat)
            lng = float(user_lng)
        except (TypeError, ValueError):
            return jsonify({'success': False, 'message': '유효하지 않은 GPS 좌표입니다.'}), 400
        dist = round(haversine_distance(lat, lng, spot['latitude'], spot['longitude']))
        if dist > GPS_RADIUS_METERS:
            return jsonify({
                'success':        False,
                'message':        f'명소에서 너무 멀리 있습니다. (현재 {dist}m, 허용 {GPS_RADIUS_METERS}m 이내)',
                'distance_meters': dist,
                'limit_meters':    GPS_RADIUS_METERS,
            }), 403

    now     = datetime.now()
    now_str = now.strftime('%Y-%m-%d %H:%M:%S')

    existing = q_one(db,
        'SELECT id, expires_at FROM qr_tokens '
        'WHERE user_id = ? AND spot_id = ? AND used_at IS NULL AND expires_at > ?',
        (g.user['id'], spot_id, now_str)
    )
    if existing:
        exp = datetime.strptime(existing['expires_at'], '%Y-%m-%d %H:%M:%S')
        return jsonify({
            'success':    True,
            'token':      existing['id'],
            'expires_at': existing['expires_at'],
            'spot_name':  spot['name_ko'],
            'ttl_seconds': int((exp - now).total_seconds()),
        })

    token_id   = str(uuid.uuid4())
    expires_at = (now + timedelta(minutes=TOKEN_TTL_MINUTES)).strftime('%Y-%m-%d %H:%M:%S')

    q_run(db,
        'INSERT INTO qr_tokens (id, user_id, spot_id, expires_at) VALUES (?, ?, ?, ?)',
        (token_id, g.user['id'], spot_id, expires_at)
    )

    return jsonify({
        'success':    True,
        'token':      token_id,
        'expires_at': expires_at,
        'spot_name':  spot['name_ko'],
        'ttl_seconds': TOKEN_TTL_MINUTES * 60,
    }), 201


@qr_bp.route('/status/<token>', methods=['GET'])
@authenticate_token
def status(token):
    """사용자 본인의 QR 토큰이 스캔(적립)됐는지 폴링용으로 조회한다.

    관리자가 /scan 으로 처리하면 used_at 이 채워지고 stamp_logs 가 생성된다.
    프론트는 이 엔드포인트를 폴링해 적립을 감지하고 QR 모달을 닫는다.
    """
    db = get_db()
    qr = q_one(db,
        'SELECT qt.id, qt.user_id, qt.spot_id, qt.used_at, qt.expires_at, '
        's.name_ko AS spot_name '
        'FROM qr_tokens qt JOIN spots s ON s.id = qt.spot_id WHERE qt.id = ?',
        (token,)
    )
    if not qr:
        return jsonify({'success': False, 'message': '유효하지 않은 토큰입니다.'}), 404
    if qr['user_id'] != g.user['id']:
        return jsonify({'success': False, 'message': '본인의 토큰만 조회할 수 있습니다.'}), 403

    used   = qr['used_at'] is not None
    result = {'success': True, 'used': used, 'spot_name': qr['spot_name']}
    if used:
        user = q_one(db, 'SELECT total_stamps FROM users WHERE id = ?', (qr['user_id'],))
        result['total_stamps'] = user['total_stamps'] if user else 0
        # 이 토큰 스캔으로 만들어진 스탬프 로그 (verified_at == used_at)
        log = q_one(db,
            'SELECT earned_count FROM stamp_logs '
            'WHERE user_id = ? AND spot_id = ? AND verified_at = ? LIMIT 1',
            (qr['user_id'], qr['spot_id'], qr['used_at'])
        )
        result['earned_count'] = log['earned_count'] if log else None
    return jsonify(result)


@qr_bp.route('/scan', methods=['POST'])
@authenticate_token
def scan():
    if g.user.get('role') != 'admin':
        return jsonify({'success': False, 'message': '관리자만 스캔할 수 있습니다.'}), 403

    data  = request.get_json() or {}
    token = data.get('token')
    if not token:
        return jsonify({'success': False, 'message': 'token이 필요합니다.'}), 400

    now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    db      = get_db()

    qr = q_one(db,
        'SELECT qt.*, s.name_ko AS spot_name, s.base_stamp_count, s.is_active, s.category, '
        'u.nickname AS user_nickname, u.total_stamps AS user_total_stamps '
        'FROM qr_tokens qt JOIN spots s ON s.id = qt.spot_id JOIN users u ON u.id = qt.user_id '
        'WHERE qt.id = ?',
        (token,)
    )

    if not qr:
        return jsonify({'success': False, 'message': '유효하지 않은 QR 코드입니다.'}), 404
    if qr['used_at']:
        return jsonify({'success': False, 'message': '이미 사용된 QR 코드입니다.'}), 409
    if qr['expires_at'] < now_str:
        return jsonify({'success': False, 'message': 'QR 코드가 만료되었습니다. 사용자에게 재발급을 요청하세요.'}), 410
    if not qr['is_active']:
        return jsonify({'success': False, 'message': '비활성화된 명소입니다.'}), 400

    one_day_ago = (datetime.now() - timedelta(hours=24)).strftime('%Y-%m-%d %H:%M:%S')
    if q_one(db,
        'SELECT id FROM stamp_logs WHERE user_id = ? AND spot_id = ? AND verified_at >= ?',
        (qr['user_id'], qr['spot_id'], one_day_ago)
    ):
        return jsonify({'success': False, 'message': '해당 사용자가 24시간 이내 이미 인증한 명소입니다.'}), 409

    cong         = get_congestion(qr['spot_id'], db)
    multiplier   = cong['multiplier']
    earned_count = math.ceil(qr['base_stamp_count'] * multiplier)

    try:
        db.execute('UPDATE qr_tokens SET used_at = ?, scanned_by = ? WHERE id = ?',
                   (now_str, g.user['id'], token))
        db.execute(
            "INSERT INTO stamp_logs "
            "(user_id, spot_id, earned_count, multiplier, verification_method, verified_at) "
            "VALUES (?, ?, ?, ?, 'qr_admin', ?)",
            (qr['user_id'], qr['spot_id'], earned_count, multiplier, now_str)
        )
        db.commit()
    except Exception as e:
        db.rollback()
        return jsonify({'success': False, 'message': f'서버 오류: {str(e)}'}), 500

    recalculate_user_stamps(qr['user_id'], db)
    completed_missions = check_and_complete_missions(qr['user_id'], db)
    updated_user       = q_one(db, 'SELECT total_stamps FROM users WHERE id = ?', (qr['user_id'],))

    return jsonify({
        'success':           True,
        'user_nickname':     qr['user_nickname'],
        'spot_name':         qr['spot_name'],
        'spot_category':     qr['category'],
        'earned_count':      earned_count,
        'multiplier':        multiplier,
        'congestion':        {'level': cong['level'], 'label': cong['label'], 'emoji': cong['emoji']},
        'new_total_stamps':  updated_user['total_stamps'] if updated_user else 0,
        'completed_missions': completed_missions,
    })
