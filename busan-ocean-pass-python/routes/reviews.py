import uuid

from flask import Blueprint, g, jsonify, request

from db import get_db, q_one, q_all, q_run
from helpers import recalculate_user_stamps, get_localized_field
from middleware import authenticate_token, optional_auth

reviews_bp   = Blueprint('reviews', __name__)
SUPPORTED_LANGS = {'ko', 'en', 'ja', 'zh'}


@reviews_bp.route('/', methods=['POST'])
@authenticate_token
def create_review():
    data      = request.get_json() or {}
    user_id   = g.user['id']
    spot_id   = data.get('spot_id')
    content   = data.get('content', '')
    photo_url = data.get('photo_url')
    rating    = data.get('rating')
    language  = data.get('language', 'ko')

    if not spot_id:
        return jsonify({'success': False, 'error': 'spot_id가 필요합니다.'}), 400
    if not isinstance(content, str) or not content:
        return jsonify({'success': False, 'error': '리뷰 내용이 필요합니다.'}), 400
    if len(content.strip()) < 10:
        return jsonify({'success': False, 'error': '리뷰는 최소 10자 이상 작성해야 합니다.'}), 400

    try:
        rating_num = int(rating)
        assert 1 <= rating_num <= 5
    except (TypeError, ValueError, AssertionError):
        return jsonify({'success': False, 'error': '평점은 1~5 사이의 정수여야 합니다.'}), 400

    safe_lang = language if language in SUPPORTED_LANGS else 'ko'
    db        = get_db()

    if not q_one(db, 'SELECT id FROM spots WHERE id = ? AND is_active = 1', (spot_id,)):
        return jsonify({'success': False, 'error': '존재하지 않는 명소입니다.'}), 404
    if not q_one(db, 'SELECT id FROM stamp_logs WHERE user_id = ? AND spot_id = ?', (user_id, spot_id)):
        return jsonify({'success': False, 'error': '방문 인증 후 리뷰를 작성할 수 있습니다.'}), 403
    if q_one(db, 'SELECT id FROM reviews WHERE user_id = ? AND spot_id = ?', (user_id, spot_id)):
        return jsonify({'success': False, 'error': '이미 이 명소에 리뷰를 작성했습니다.'}), 409

    bonus = 0
    if len(content.strip()) >= 50:
        bonus += 1
    if photo_url and photo_url.strip():
        bonus += 1
    if safe_lang != 'ko':
        bonus += 1

    review_id = str(uuid.uuid4())
    q_run(db,
        'INSERT INTO reviews (id, user_id, spot_id, content, photo_url, rating, language, like_count, bonus_stamp_given) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
        (review_id, user_id, spot_id, content.strip(), photo_url, rating_num, safe_lang, bonus)
    )

    new_total = recalculate_user_stamps(user_id, db)
    review    = q_one(db,
        'SELECT id, spot_id, content, photo_url, rating, language, '
        'like_count, bonus_stamp_given, created_at FROM reviews WHERE id = ?',
        (review_id,)
    )

    return jsonify({
        'success':             True,
        'review':              review,
        'bonus_stamps_earned': bonus,
        'new_total_stamps':    new_total,
    }), 201


@reviews_bp.route('/spot/<spot_id>', methods=['GET'])
@optional_auth
def spot_reviews(spot_id):
    user_id = g.user['id'] if g.user else None
    db      = get_db()

    if not q_one(db, 'SELECT id FROM spots WHERE id = ?', (spot_id,)):
        return jsonify({'success': False, 'error': '존재하지 않는 명소입니다.'}), 404

    reviews = q_all(db,
        'SELECT r.id, r.content, r.photo_url, r.rating, r.language, r.like_count, '
        'r.bonus_stamp_given, r.created_at, u.id AS author_id, u.nickname AS author_nickname '
        'FROM reviews r JOIN users u ON u.id = r.user_id '
        'WHERE r.spot_id = ? ORDER BY r.like_count DESC, r.created_at DESC',
        (spot_id,)
    )

    liked_set = set()
    if user_id:
        liked_rows = q_all(db, 'SELECT review_id FROM review_likes WHERE user_id = ?', (user_id,))
        liked_set  = {r['review_id'] for r in liked_rows}

    formatted = [{**r, 'is_liked': r['id'] in liked_set} for r in reviews]

    avg_rating = None
    if reviews:
        avg_rating = round(sum(r['rating'] for r in reviews) / len(reviews) * 10) / 10

    return jsonify({'success': True, 'count': len(formatted), 'avg_rating': avg_rating, 'reviews': formatted})


@reviews_bp.route('/<review_id>/like', methods=['POST'])
@authenticate_token
def like_review(review_id):
    user_id = g.user['id']
    db      = get_db()

    review = q_one(db,
        'SELECT id, user_id, like_count, bonus_stamp_given FROM reviews WHERE id = ?',
        (review_id,)
    )
    if not review:
        return jsonify({'success': False, 'error': '존재하지 않는 리뷰입니다.'}), 404
    if review['user_id'] == user_id:
        return jsonify({'success': False, 'error': '자신의 리뷰에는 좋아요를 누를 수 없습니다.'}), 400
    if q_one(db, 'SELECT id FROM review_likes WHERE user_id = ? AND review_id = ?', (user_id, review_id)):
        return jsonify({'success': False, 'error': '이미 좋아요를 눌렀습니다.'}), 409

    try:
        db.execute('INSERT INTO review_likes (user_id, review_id) VALUES (?, ?)', (user_id, review_id))
        db.commit()
    except Exception as e:
        if 'UNIQUE' in str(e):
            return jsonify({'success': False, 'error': '이미 좋아요를 눌렀습니다.'}), 409
        raise

    new_like_count = review['like_count'] + 1
    q_run(db, 'UPDATE reviews SET like_count = ? WHERE id = ?', (new_like_count, review_id))

    bonus_awarded = False
    if new_like_count == 10 and review['like_count'] < 10:
        new_bonus = review['bonus_stamp_given'] + 2
        q_run(db, 'UPDATE reviews SET bonus_stamp_given = ? WHERE id = ?', (new_bonus, review_id))
        recalculate_user_stamps(review['user_id'], db)
        bonus_awarded = True
        print(f'[리뷰] 좋아요 10개 달성 보너스 — reviewId: {review_id}, +2스탬프')

    return jsonify({'success': True, 'like_count': new_like_count, 'bonus_awarded': bonus_awarded})


@reviews_bp.route('/my', methods=['GET'])
@authenticate_token
def my_reviews():
    lang    = request.args.get('lang', 'ko')
    user_id = g.user['id']
    db      = get_db()

    reviews = q_all(db,
        'SELECT r.id, r.content, r.photo_url, r.rating, r.language, r.like_count, '
        'r.bonus_stamp_given, r.created_at, '
        's.id AS spot_id, s.name_ko, s.name_en, s.name_ja, s.name_zh, '
        's.category AS spot_category, s.image_url AS spot_image_url '
        'FROM reviews r JOIN spots s ON s.id = r.spot_id '
        'WHERE r.user_id = ? ORDER BY r.created_at DESC',
        (user_id,)
    )

    formatted = [{
        'id':                review['id'],
        'spot_id':           review['spot_id'],
        'spot_name':         get_localized_field(review, lang, 'name'),
        'spot_category':     review['spot_category'],
        'spot_image_url':    review['spot_image_url'],
        'content':           review['content'],
        'photo_url':         review['photo_url'],
        'rating':            review['rating'],
        'language':          review['language'],
        'like_count':        review['like_count'],
        'bonus_stamp_given': review['bonus_stamp_given'],
        'created_at':        review['created_at'],
    } for review in reviews]

    return jsonify({'success': True, 'count': len(formatted), 'reviews': formatted})
