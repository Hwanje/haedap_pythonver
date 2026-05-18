/**
 * rewards.js — 스탬프 리워드 교환 라우트 (전체 인증 필수)
 *
 * 사용자가 적립한 스탬프를 동백전, 부산사랑상품권, 특산물 박스 등으로
 * 교환하는 기능을 제공합니다.
 *
 * 외국인(is_foreigner=1) 처리:
 *   동백전, 부산사랑상품권은 외국인 계좌가 필요하므로,
 *   외국인 사용자에게는 자동으로 가맹점 QR 쿠폰으로 전환됩니다.
 *
 * 엔드포인트:
 *   GET  /api/rewards/catalog - 리워드 카탈로그 조회
 *   POST /api/rewards/redeem  - 스탬프로 리워드 교환
 *   GET  /api/rewards/my      - 내 교환 내역 조회
 */

'use strict';

const express    = require('express');
const { v4: uuidv4 } = require('uuid');
const router     = express.Router();

const { authenticateToken }     = require('../middleware/auth');
const { recalculateUserStamps } = require('../utils/helpers');
const db                        = require('../db/database');

// ──────────────────────────────────────────────
// 전체 라우트 인증 적용
// ──────────────────────────────────────────────

router.use(authenticateToken);

// ──────────────────────────────────────────────
// 리워드 카탈로그 상수
// ──────────────────────────────────────────────

/**
 * 교환 가능한 리워드 카탈로그
 *
 * foreigner_alt: 외국인 사용자에게 자동으로 제공되는 대체 타입
 *   동백전 계열 → merchant_coupon(가맹점 QR 쿠폰)
 *   special_box → 그대로 제공 (실물 상품)
 */
const REWARD_CATALOG = [
  {
    reward_type:     'dongbaekjeon_3000',
    stamp_cost:      10,
    value:           3000,
    description_ko:  '동백전 3,000원',
    description_en:  'Dongbaekjeon 3,000 KRW',
    foreigner_alt:   'merchant_coupon_3000',
    foreigner_desc:  '가맹점 QR 쿠폰 3,000원 (외국인 전용)',
    foreigner_desc_en: 'Merchant QR Coupon 3,000 KRW (Foreigners only)',
    category:        'cash',
  },
  {
    reward_type:     'dongbaekjeon_7000',
    stamp_cost:      20,
    value:           7000,
    description_ko:  '동백전 7,000원',
    description_en:  'Dongbaekjeon 7,000 KRW',
    foreigner_alt:   'merchant_coupon_7000',
    foreigner_desc:  '가맹점 QR 쿠폰 7,000원 (외국인 전용)',
    foreigner_desc_en: 'Merchant QR Coupon 7,000 KRW (Foreigners only)',
    category:        'cash',
  },
  {
    reward_type:     'busan_voucher_10000',
    stamp_cost:      30,
    value:           10000,
    description_ko:  '부산사랑상품권 1만원',
    description_en:  'Busan Love Voucher 10,000 KRW',
    foreigner_alt:   'merchant_coupon_10000',
    foreigner_desc:  '가맹점 QR 쿠폰 10,000원 (외국인 전용)',
    foreigner_desc_en: 'Merchant QR Coupon 10,000 KRW (Foreigners only)',
    category:        'voucher',
  },
  {
    reward_type:     'special_box',
    stamp_cost:      50,
    value:           20000,
    description_ko:  '부산 특산물 박스 (어묵 + 기장미역)',
    description_en:  'Busan Special Box (fish cake + Gijang seaweed)',
    foreigner_alt:   'special_box',
    foreigner_desc:  '부산 특산물 박스 (외국인도 동일 제공)',
    foreigner_desc_en: 'Busan Special Box (available to foreigners)',
    category:        'goods',
  },
];

/** reward_type → 카탈로그 항목 빠른 검색용 Map */
const CATALOG_MAP = new Map(REWARD_CATALOG.map(item => [item.reward_type, item]));

// ──────────────────────────────────────────────
// GET /api/rewards/catalog — 리워드 카탈로그 조회
// ──────────────────────────────────────────────

/**
 * 교환 가능한 리워드 목록을 반환합니다.
 *
 * 외국인(is_foreigner=1) 사용자의 경우:
 *   - reward_type을 foreigner_alt로 표시
 *   - 설명 문구도 외국인용으로 변경
 *   - 안내 메시지 포함
 */
router.get('/catalog', (req, res) => {
  const isForeigner = req.user.is_foreigner === 1;

  // 현재 사용자의 스탬프 잔액 조회
  const userRow = db.prepare('SELECT total_stamps FROM users WHERE id = ?').get(req.user.id);
  const userStamps = userRow ? userRow.total_stamps : 0;

  const items = REWARD_CATALOG.map(item => {
    const displayType = isForeigner ? item.foreigner_alt : item.reward_type;
    const displayDesc = isForeigner ? item.foreigner_desc : item.description_ko;
    const displayDescEn = isForeigner ? item.foreigner_desc_en : item.description_en;

    return {
      reward_type:    displayType,
      original_type:  item.reward_type,
      stamp_cost:     item.stamp_cost,
      value:          item.value,
      description_ko: displayDesc,
      description_en: displayDescEn,
      category:       item.category,
      // 현재 잔액으로 교환 가능 여부 표시
      can_redeem:     userStamps >= item.stamp_cost,
    };
  });

  return res.json({
    success:       true,
    user_stamps:   userStamps,
    foreigner_mode: isForeigner,
    foreigner_notice: isForeigner
      ? '외국인 사용자에게는 동백전/상품권 대신 가맹점 QR 쿠폰이 제공됩니다. / Merchant QR coupons are provided instead of Dongbaekjeon for foreign users.'
      : null,
    data: items,
  });
});

// ──────────────────────────────────────────────
// POST /api/rewards/redeem — 리워드 교환
// ──────────────────────────────────────────────

/**
 * 스탬프를 소모하여 리워드를 교환합니다.
 *
 * 처리 흐름:
 *   1. 카탈로그에서 stamp_cost 조회
 *   2. 사용자 잔액(total_stamps) >= stamp_cost 확인
 *   3. rewards INSERT (status='completed')
 *   4. recalculateUserStamps() 호출로 잔액 차감 반영
 *   5. 외국인이면 reward_type을 foreigner_alt로 자동 전환
 */
router.post('/redeem', (req, res) => {
  const { reward_type } = req.body;

  if (!reward_type) {
    return res.status(400).json({
      success: false,
      message: '교환할 리워드 타입을 지정해주세요. / reward_type is required.',
    });
  }

  // 카탈로그 조회 (원본 reward_type 또는 foreigner_alt로 검색)
  let catalogItem = CATALOG_MAP.get(reward_type);

  // foreigner_alt로 요청한 경우 원본 항목 찾기
  if (!catalogItem) {
    catalogItem = REWARD_CATALOG.find(item => item.foreigner_alt === reward_type);
  }

  if (!catalogItem) {
    return res.status(400).json({
      success: false,
      message: '존재하지 않는 리워드 타입입니다. / Invalid reward type.',
    });
  }

  // 현재 스탬프 잔액 조회
  const userRow = db.prepare('SELECT total_stamps, is_foreigner, nickname FROM users WHERE id = ?').get(req.user.id);
  if (!userRow) {
    return res.status(404).json({
      success: false,
      message: '사용자를 찾을 수 없습니다. / User not found.',
    });
  }

  // 스탬프 잔액 부족 확인
  if (userRow.total_stamps < catalogItem.stamp_cost) {
    return res.status(400).json({
      success: false,
      message: `스탬프가 부족합니다. 필요: ${catalogItem.stamp_cost}개, 보유: ${userRow.total_stamps}개 / Insufficient stamps.`,
      required: catalogItem.stamp_cost,
      current:  userRow.total_stamps,
      shortage: catalogItem.stamp_cost - userRow.total_stamps,
    });
  }

  // 외국인이면 reward_type을 foreigner_alt로 자동 전환
  const isForeigner = userRow.is_foreigner === 1;
  const finalType = isForeigner ? catalogItem.foreigner_alt : catalogItem.reward_type;
  const finalDesc = isForeigner ? catalogItem.foreigner_desc : catalogItem.description_ko;

  // rewards 테이블 INSERT
  const rewardId = uuidv4();
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  db.prepare(`
    INSERT INTO rewards (id, user_id, reward_type, stamp_cost, value, description, status, redeemed_at)
    VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)
  `).run(
    rewardId,
    req.user.id,
    finalType,
    catalogItem.stamp_cost,
    catalogItem.value,
    finalDesc,
    now
  );

  // 스탬프 잔액 재계산 (차감 반영)
  const newStamps = recalculateUserStamps(req.user.id, db);

  return res.status(201).json({
    success:        true,
    message:        `리워드 교환이 완료되었습니다. / Reward redeemed successfully.`,
    reward_id:      rewardId,
    reward_type:    finalType,
    description:    finalDesc,
    value:          catalogItem.value,
    stamp_cost:     catalogItem.stamp_cost,
    remaining_stamps: newStamps,
    foreigner_converted: isForeigner && finalType !== catalogItem.reward_type,
  });
});

// ──────────────────────────────────────────────
// GET /api/rewards/my — 내 교환 내역 조회
// ──────────────────────────────────────────────

/**
 * 로그인한 사용자의 리워드 교환 내역을 최신순으로 반환합니다.
 */
router.get('/my', (req, res) => {
  const rewards = db.prepare(`
    SELECT
      id,
      reward_type,
      stamp_cost,
      value,
      description,
      status,
      redeemed_at
    FROM   rewards
    WHERE  user_id = ?
    ORDER  BY redeemed_at DESC
  `).all(req.user.id);

  // 현재 스탬프 잔액도 함께 반환
  const userRow = db.prepare('SELECT total_stamps FROM users WHERE id = ?').get(req.user.id);

  return res.json({
    success:      true,
    count:        rewards.length,
    total_stamps: userRow ? userRow.total_stamps : 0,
    data:         rewards,
  });
});

module.exports = router;
