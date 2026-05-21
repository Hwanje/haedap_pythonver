from datetime import date

from flask import Blueprint, jsonify, request

from db import get_db, q_one, q_all
from helpers import haversine_distance, get_congestion, get_localized_field, CONGESTION_WINDOW_MINUTES

spots_bp = Blueprint('spots', __name__)


def _format_spot(spot, lang, include_congestion=True):
    name        = get_localized_field(spot, lang, 'name')
    description = get_localized_field(spot, lang, 'description')
    result = {
        'id':               spot['id'],
        'name':             name,
        'description':      description,
        'category':         spot['category'],
        'latitude':         spot['latitude'],
        'longitude':        spot['longitude'],
        'address':          spot['address'],
        'image_url':        spot.get('image_url'),
        'qr_code':          spot['qr_code'],
        'base_stamp_count': spot['base_stamp_count'],
        'order_in_route':   spot['order_in_route'],
        'is_active':        spot['is_active'],
        'created_at':       spot['created_at'],
    }
    if include_congestion:
        cong = get_congestion(spot['id'], get_db())
        result['congestion'] = {
            'level':       cong['level'],
            'label':       cong['label'],
            'emoji':       cong['emoji'],
            'multiplier':  cong['multiplier'],
            'recentCount': cong['recentCount'],
        }
    return result


@spots_bp.route('/', methods=['GET'])
def list_spots():
    lang          = request.args.get('lang', 'ko')
    category      = request.args.get('category')
    filter_active = request.args.get('is_active', '1') != '0'

    conditions, params = [], []
    if filter_active:
        conditions.append('is_active = 1')
    if category:
        conditions.append('category = ?')
        params.append(category)

    where = ('WHERE ' + ' AND '.join(conditions)) if conditions else ''
    db    = get_db()
    spots = q_all(db, f'SELECT * FROM spots {where} ORDER BY order_in_route ASC', params)
    formatted = [_format_spot(s, lang) for s in spots]
    return jsonify({'success': True, 'count': len(formatted), 'spots': formatted})


@spots_bp.route('/nearby', methods=['GET'])
def nearby_spots():
    try:
        lat    = float(request.args.get('lat', ''))
        lng    = float(request.args.get('lng', ''))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'lat(위도)와 lng(경도) 파라미터가 필요합니다.'}), 400

    if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        return jsonify({'success': False, 'error': '유효하지 않은 GPS 좌표입니다.'}), 400

    radius = float(request.args.get('radius', '3000'))
    lang   = request.args.get('lang', 'ko')
    db     = get_db()

    all_spots = q_all(db, 'SELECT * FROM spots WHERE is_active = 1')
    nearby = []
    for s in all_spots:
        dist = round(haversine_distance(lat, lng, s['latitude'], s['longitude']))
        if dist <= radius:
            nearby.append({**s, 'distance_meters': dist})
    nearby.sort(key=lambda x: x['distance_meters'])

    formatted = [{**_format_spot(s, lang), 'distance_meters': s['distance_meters']} for s in nearby]
    return jsonify({
        'success':       True,
        'count':         len(formatted),
        'user_location': {'lat': lat, 'lng': lng},
        'radius_meters': radius,
        'spots':         formatted,
    })


@spots_bp.route('/<spot_id>/congestion', methods=['GET'])
def congestion(spot_id):
    db   = get_db()
    spot = q_one(db, 'SELECT id FROM spots WHERE id = ?', (spot_id,))
    if not spot:
        return jsonify({'success': False, 'error': '명소를 찾을 수 없습니다.'}), 404
    cong = get_congestion(spot_id, db)
    return jsonify({
        'success':        True,
        'spot_id':        spot_id,
        'level':          cong['level'],
        'label':          cong['label'],
        'emoji':          cong['emoji'],
        'multiplier':     cong['multiplier'],
        'recent_count':   cong['recentCount'],
        'window_minutes': CONGESTION_WINDOW_MINUTES,
    })


@spots_bp.route('/<spot_id>', methods=['GET'])
def spot_detail(spot_id):
    lang = request.args.get('lang', 'ko')
    db   = get_db()
    spot = q_one(db, 'SELECT * FROM spots WHERE id = ?', (spot_id,))
    if not spot:
        return jsonify({'success': False, 'error': '명소를 찾을 수 없습니다.'}), 404

    cong = get_congestion(spot_id, db)
    today = date.today().isoformat()

    reviews = q_all(db,
        'SELECT r.id, r.content, r.photo_url, r.rating, r.language, '
        'r.like_count, r.created_at, u.nickname AS author_nickname '
        'FROM reviews r JOIN users u ON u.id = r.user_id '
        'WHERE r.spot_id = ? ORDER BY r.like_count DESC, r.created_at DESC LIMIT 5',
        (spot_id,)
    )

    wikis = q_all(db,
        "SELECT wp.id, wp.title, wp.category, wp.photo_url, "
        "wp.event_start_date, wp.event_end_date, wp.view_count, wp.helpful_count, "
        "wp.created_at, u.nickname AS author_nickname "
        "FROM wiki_posts wp JOIN users u ON u.id = wp.user_id "
        "WHERE wp.spot_id = ? AND wp.status = 'approved' "
        "AND (wp.category != 'event' OR wp.event_end_date IS NULL OR wp.event_end_date >= ?) "
        "ORDER BY wp.created_at DESC LIMIT 3",
        (spot_id, today)
    )

    visit_stats  = q_one(db,
        'SELECT COUNT(DISTINCT user_id) AS unique_visitors, COUNT(*) AS total_stamps '
        'FROM stamp_logs WHERE spot_id = ?', (spot_id,))
    rating_stats = q_one(db,
        'SELECT COUNT(*) AS review_count, AVG(rating) AS avg_rating '
        'FROM reviews WHERE spot_id = ?', (spot_id,))

    formatted = _format_spot(spot, lang, include_congestion=False)
    avg = rating_stats['avg_rating']
    formatted.update({
        'congestion': {
            'level': cong['level'], 'label': cong['label'],
            'emoji': cong['emoji'], 'multiplier': cong['multiplier'],
            'recentCount': cong['recentCount'],
        },
        'stats': {
            'unique_visitors': visit_stats['unique_visitors'] if visit_stats else 0,
            'total_stamps':    visit_stats['total_stamps']    if visit_stats else 0,
            'review_count':    rating_stats['review_count']   if rating_stats else 0,
            'avg_rating':      round(avg * 10) / 10 if avg else None,
        },
        'recent_reviews': reviews,
        'recent_wikis':   wikis,
    })
    return jsonify({'success': True, 'spot': formatted})
