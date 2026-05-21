import uuid
from datetime import datetime

from flask import Blueprint, g, jsonify, request

from db import get_db, q_one, q_all, q_run
from helpers import recalculate_user_stamps
from middleware import authenticate_token

rewards_bp = Blueprint('rewards', __name__)

REWARD_CATALOG = [
    {
        'reward_type':      'dongbaekjeon_3000',
        'stamp_cost':       10,
        'value':            3000,
        'description_ko':   '동백전 3,000원',
        'description_en':   'Dongbaekjeon 3,000 KRW',
        'foreigner_alt':    'merchant_coupon_3000',
        'foreigner_desc':   '가맹점 QR 쿠폰 3,000원 (외국인 전용)',
        'foreigner_desc_en':'Merchant QR Coupon 3,000 KRW (Foreigners only)',
        'category':         'cash',
    },
    {
        'reward_type':      'dongbaekjeon_7000',
        'stamp_cost':       20,
        'value':            7000,
        'description_ko':   '동백전 7,000원',
        'description_en':   'Dongbaekjeon 7,000 KRW',
        'foreigner_alt':    'merchant_coupon_7000',
        'foreigner_desc':   '가맹점 QR 쿠폰 7,000원 (외국인 전용)',
        'foreigner_desc_en':'Merchant QR Coupon 7,000 KRW (Foreigners only)',
        'category':         'cash',
    },
    {
        'reward_type':      'busan_voucher_10000',
        'stamp_cost':       30,
        'value':            10000,
        'description_ko':   '부산사랑상품권 1만원',
        'description_en':   'Busan Love Voucher 10,000 KRW',
        'foreigner_alt':    'merchant_coupon_10000',
        'foreigner_desc':   '가맹점 QR 쿠폰 10,000원 (외국인 전용)',
        'foreigner_desc_en':'Merchant QR Coupon 10,000 KRW (Foreigners only)',
        'category':         'voucher',
    },
    {
        'reward_type':      'special_box',
        'stamp_cost':       50,
        'value':            20000,
        'description_ko':   '부산 특산물 박스 (어묵 + 기장미역)',
        'description_en':   'Busan Special Box (fish cake + Gijang seaweed)',
        'foreigner_alt':    'special_box',
        'foreigner_desc':   '부산 특산물 박스 (외국인도 동일 제공)',
        'foreigner_desc_en':'Busan Special Box (available to foreigners)',
        'category':         'goods',
    },
]

CATALOG_MAP      = {item['reward_type']: item for item in REWARD_CATALOG}
CATALOG_ALT_MAP  = {item['foreigner_alt']: item for item in REWARD_CATALOG}


@rewards_bp.route('/catalog', methods=['GET'])
@authenticate_token
def catalog():
    is_foreigner = g.user.get('is_foreigner') == 1
    db           = get_db()
    user_row     = q_one(db, 'SELECT total_stamps FROM users WHERE id = ?', (g.user['id'],))
    user_stamps  = user_row['total_stamps'] if user_row else 0

    items = []
    for item in REWARD_CATALOG:
        display_type   = item['foreigner_alt']    if is_foreigner else item['reward_type']
        display_desc   = item['foreigner_desc']   if is_foreigner else item['description_ko']
        display_desc_en= item['foreigner_desc_en']if is_foreigner else item['description_en']
        items.append({
            'reward_type':    display_type,
            'original_type':  item['reward_type'],
            'stamp_cost':     item['stamp_cost'],
            'value':          item['value'],
            'description_ko': display_desc,
            'description_en': display_desc_en,
            'category':       item['category'],
            'can_redeem':     user_stamps >= item['stamp_cost'],
        })

    return jsonify({
        'success':          True,
        'user_stamps':      user_stamps,
        'foreigner_mode':   is_foreigner,
        'foreigner_notice': '외국인 사용자에게는 동백전/상품권 대신 가맹점 QR 쿠폰이 제공됩니다.' if is_foreigner else None,
        'data':             items,
    })


@rewards_bp.route('/redeem', methods=['POST'])
@authenticate_token
def redeem():
    data        = request.get_json() or {}
    reward_type = data.get('reward_type')

    if not reward_type:
        return jsonify({'success': False, 'message': '교환할 리워드 타입을 지정해주세요.'}), 400

    catalog_item = CATALOG_MAP.get(reward_type) or CATALOG_ALT_MAP.get(reward_type)
    if not catalog_item:
        return jsonify({'success': False, 'message': '존재하지 않는 리워드 타입입니다.'}), 400

    db       = get_db()
    user_row = q_one(db,
        'SELECT total_stamps, is_foreigner, nickname FROM users WHERE id = ?',
        (g.user['id'],)
    )
    if not user_row:
        return jsonify({'success': False, 'message': '사용자를 찾을 수 없습니다.'}), 404

    if user_row['total_stamps'] < catalog_item['stamp_cost']:
        shortage = catalog_item['stamp_cost'] - user_row['total_stamps']
        return jsonify({
            'success':  False,
            'message':  f'스탬프가 부족합니다. 필요: {catalog_item["stamp_cost"]}개, 보유: {user_row["total_stamps"]}개',
            'required': catalog_item['stamp_cost'],
            'current':  user_row['total_stamps'],
            'shortage': shortage,
        }), 400

    is_foreigner = user_row['is_foreigner'] == 1
    final_type   = catalog_item['foreigner_alt'] if is_foreigner else catalog_item['reward_type']
    final_desc   = catalog_item['foreigner_desc'] if is_foreigner else catalog_item['description_ko']

    reward_id = str(uuid.uuid4())
    now       = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    q_run(db,
        "INSERT INTO rewards (id, user_id, reward_type, stamp_cost, value, description, status, redeemed_at) "
        "VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)",
        (reward_id, g.user['id'], final_type, catalog_item['stamp_cost'], catalog_item['value'], final_desc, now)
    )

    new_stamps = recalculate_user_stamps(g.user['id'], db)

    return jsonify({
        'success':            True,
        'message':            '리워드 교환이 완료되었습니다.',
        'reward_id':          reward_id,
        'reward_type':        final_type,
        'description':        final_desc,
        'value':              catalog_item['value'],
        'stamp_cost':         catalog_item['stamp_cost'],
        'remaining_stamps':   new_stamps,
        'foreigner_converted': is_foreigner and final_type != catalog_item['reward_type'],
    }), 201


@rewards_bp.route('/my', methods=['GET'])
@authenticate_token
def my_rewards():
    db      = get_db()
    rewards = q_all(db,
        'SELECT id, reward_type, stamp_cost, value, description, status, redeemed_at '
        'FROM rewards WHERE user_id = ? ORDER BY redeemed_at DESC',
        (g.user['id'],)
    )
    user_row = q_one(db, 'SELECT total_stamps FROM users WHERE id = ?', (g.user['id'],))
    return jsonify({
        'success':      True,
        'count':        len(rewards),
        'total_stamps': user_row['total_stamps'] if user_row else 0,
        'data':         rewards,
    })
