/**
 * reviews.js — 리뷰 라우트
 *
 * 명소 방문 인증 후 리뷰를 작성하고, 다른 사용자의 리뷰에 좋아요를 남길 수 있습니다.
 * 리뷰 품질(길이, 사진, 외국어)에 따라 보너스 스탬프가 자동 지급됩니다.
 *
 * 엔드포인트 목록:
 *   POST /api/reviews/             — 리뷰 작성 🔐 (방문 인증 필수)
 *   GET  /api/reviews/spot/:spotId — 명소별 리뷰 목록 (공개, 로그인 시 좋아요 여부 포함)
 *   POST /api/reviews/:id/like     — 리뷰 좋아요 🔐
 *   GET  /api/reviews/my           — 내가 쓴 리뷰 목록 🔐
 *
 * 보너스 스탬프 지급 기준:
 *   내용 50자 이상 → +1
 *   사진(photo_url) 첨부 → +1
 *   외국어(ko 이외) 작성 → +1
 *
 * 좋아요 10개 달성 시:
 *   리뷰 작성자에게 보너스 스탬프 +2 지급 (1회만)
 */

'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');

const db                              = require('../db/database');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { recalculateUserStamps, getLocalizedField } = require('../utils/helpers');

const router = express.Router();

// ──────────────────────────────────────────────
// POST /api/reviews/ — 리뷰 작성 (🔐 인증 필수)
// ──────────────────────────────────────────────

/**
 * 방문 인증이 완료된 명소에 리뷰를 작성합니다.
 *
 * 검증 순서:
 *   1. spot_id 유효성 확인
 *   2. 해당 명소 방문 기록(stamp_logs) 확인 → 없으면 403
 *   3. 동일 명소 중복 리뷰 확인 → 있으면 409
 *   4. content 최소 10자 확인
 *
 * 보너스 스탬프 자동 계산:
 *   content.length >= 50 → +1
 *   photo_url 첨부 → +1
 *   language !== 'ko' → +1 (외국어 작성 보너스)
 *
 * Request Body:
 *   { spot_id, content, photo_url(optional), rating(1~5), language('ko'|'en'|'ja'|'zh') }
 *
 * Response 201:
 *   { success, review, bonus_stamps_earned, new_total_stamps }
 */
router.post('/', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const {
      spot_id,
      content,
      photo_url = null,
      rating,
      language  = 'ko',
    } = req.body;

    // ── 필수 파라미터 검증 ──────────────────────────────────────────────────
    if (!spot_id) {
      return res.status(400).json({
        success: false,
        error:   'spot_id가 필요합니다. (spot_id is required)',
      });
    }

    if (!content || typeof content !== 'string') {
      return res.status(400).json({
        success: false,
        error:   '리뷰 내용이 필요합니다. (content is required)',
      });
    }

    // 내용 최소 10자 확인
    if (content.trim().length < 10) {
      return res.status(400).json({
        success: false,
        error:   '리뷰는 최소 10자 이상 작성해야 합니다. (Content must be at least 10 characters)',
      });
    }

    // 평점 범위 확인 (1~5)
    const ratingNum = parseInt(rating, 10);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({
        success: false,
        error:   '평점은 1~5 사이의 정수여야 합니다. (Rating must be an integer between 1 and 5)',
      });
    }

    // 언어 코드 유효성 확인
    const supportedLangs = ['ko', 'en', 'ja', 'zh'];
    const safeLang = supportedLangs.includes(language) ? language : 'ko';

    // ── 1. 명소 존재 확인 ──────────────────────────────────────────────────
    const spot = db.prepare(`
      SELECT id, name_ko
      FROM   spots
      WHERE  id = ? AND is_active = 1
    `).get(spot_id);

    if (!spot) {
      return res.status(404).json({
        success: false,
        error:   '존재하지 않는 명소입니다. (Spot not found)',
      });
    }

    // ── 2. 방문 인증 기록 확인 ─────────────────────────────────────────────
    const stampRecord = db.prepare(`
      SELECT id
      FROM   stamp_logs
      WHERE  user_id = ? AND spot_id = ?
    `).get(userId, spot_id);

    if (!stampRecord) {
      return res.status(403).json({
        success: false,
        error:   '방문 인증 후 리뷰를 작성할 수 있습니다. (Please verify your visit first)',
      });
    }

    // ── 3. 동일 명소 중복 리뷰 확인 ───────────────────────────────────────
    const existingReview = db.prepare(`
      SELECT id
      FROM   reviews
      WHERE  user_id = ? AND spot_id = ?
    `).get(userId, spot_id);

    if (existingReview) {
      return res.status(409).json({
        success: false,
        error:   '이미 이 명소에 리뷰를 작성했습니다. (You already reviewed this spot)',
      });
    }

    // ── 보너스 스탬프 계산 ─────────────────────────────────────────────────
    let bonusStamps = 0;

    // 내용 50자 이상 → +1
    if (content.trim().length >= 50) {
      bonusStamps += 1;
    }

    // 사진 첨부 → +1
    if (photo_url && photo_url.trim() !== '') {
      bonusStamps += 1;
    }

    // 외국어 작성 → +1 (한국어 이외)
    if (safeLang !== 'ko') {
      bonusStamps += 1;
    }

    // ── 리뷰 INSERT ────────────────────────────────────────────────────────
    const reviewId = uuidv4();

    db.prepare(`
      INSERT INTO reviews
        (id, user_id, spot_id, content, photo_url, rating, language,
         like_count, bonus_stamp_given)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(reviewId, userId, spot_id, content.trim(), photo_url, ratingNum, safeLang, bonusStamps);

    // ── 스탬프 잔액 재계산 ──────────────────────────────────────────────────
    const newTotalStamps = recalculateUserStamps(userId, db);

    // 생성된 리뷰 조회 (응답용)
    const review = db.prepare(`
      SELECT id, spot_id, content, photo_url, rating, language,
             like_count, bonus_stamp_given, created_at
      FROM   reviews
      WHERE  id = ?
    `).get(reviewId);

    return res.status(201).json({
      success:            true,
      review,
      bonus_stamps_earned: bonusStamps,
      new_total_stamps:   newTotalStamps,
    });

  } catch (err) {
    console.error('[리뷰] 작성 오류:', err.message);
    return res.status(500).json({
      success: false,
      error:   '리뷰 작성 중 오류가 발생했습니다. (Internal server error)',
    });
  }
});

// ──────────────────────────────────────────────
// GET /api/reviews/spot/:spotId — 명소별 리뷰 목록
// ──────────────────────────────────────────────

/**
 * 특정 명소의 리뷰 목록을 좋아요 수 내림차순, 최신순으로 반환합니다.
 *
 * 로그인 사용자의 경우 각 리뷰에 내가 좋아요를 눌렀는지(is_liked) 여부를 포함합니다.
 * optionalAuth 사용 — 비로그인 사용자도 조회 가능
 *
 * Query Parameters:
 *   lang {string} 언어 코드 (기본 'ko', 사용자 닉네임 등에서 참조)
 *
 * Response 200:
 *   { success, count, avg_rating, reviews: [..., is_liked] }
 */
router.get('/spot/:spotId', optionalAuth, (req, res) => {
  try {
    const spotId = parseInt(req.params.spotId, 10);
    const userId = req.user ? req.user.id : null; // 비로그인 시 null

    if (isNaN(spotId)) {
      return res.status(400).json({
        success: false,
        error:   '유효하지 않은 명소 ID입니다. (Invalid spot ID)',
      });
    }

    // 명소 존재 확인
    const spot = db.prepare(`
      SELECT id FROM spots WHERE id = ?
    `).get(spotId);

    if (!spot) {
      return res.status(404).json({
        success: false,
        error:   '존재하지 않는 명소입니다. (Spot not found)',
      });
    }

    // 리뷰 목록 조회 (작성자 닉네임 포함)
    const reviews = db.prepare(`
      SELECT
        r.id,
        r.content,
        r.photo_url,
        r.rating,
        r.language,
        r.like_count,
        r.bonus_stamp_given,
        r.created_at,
        u.id       AS author_id,
        u.nickname AS author_nickname
      FROM   reviews r
      JOIN   users   u ON u.id = r.user_id
      WHERE  r.spot_id = ?
      ORDER  BY r.like_count DESC, r.created_at DESC
    `).all(spotId);

    // 로그인 사용자의 좋아요 여부 확인
    let likedSet = new Set();

    if (userId) {
      const likedRows = db.prepare(`
        SELECT review_id
        FROM   review_likes
        WHERE  user_id = ?
      `).all(userId);
      likedSet = new Set(likedRows.map(r => r.review_id));
    }

    // is_liked 필드 추가
    const formatted = reviews.map(review => ({
      ...review,
      is_liked: likedSet.has(review.id),
    }));

    // 평균 평점 계산
    const avgRating = reviews.length > 0
      ? Math.round(reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length * 10) / 10
      : null;

    return res.status(200).json({
      success:    true,
      count:      formatted.length,
      avg_rating: avgRating,
      reviews:    formatted,
    });

  } catch (err) {
    console.error('[리뷰] 명소별 조회 오류:', err.message);
    return res.status(500).json({
      success: false,
      error:   '리뷰 조회 중 오류가 발생했습니다. (Internal server error)',
    });
  }
});

// ──────────────────────────────────────────────
// POST /api/reviews/:id/like — 리뷰 좋아요 (🔐 인증 필수)
// ──────────────────────────────────────────────

/**
 * 특정 리뷰에 좋아요를 추가합니다.
 *
 * review_likes 테이블의 UNIQUE(user_id, review_id) 제약으로 중복을 방지합니다.
 * 좋아요가 10개가 되는 시점에 리뷰 작성자에게 보너스 스탬프 +2를 지급합니다.
 * (bonus_stamp_given 값을 10 미만→이상 전환 시점에만 지급 — 중복 방지)
 *
 * Response 200:
 *   { success, like_count, bonus_awarded }
 *
 * Error:
 *   404 — 리뷰 없음
 *   409 — 이미 좋아요
 */
router.post('/:id/like', authenticateToken, (req, res) => {
  try {
    const reviewId = req.params.id;
    const userId   = req.user.id;

    // ── 리뷰 존재 확인 ─────────────────────────────────────────────────────
    const review = db.prepare(`
      SELECT id, user_id, like_count, bonus_stamp_given
      FROM   reviews
      WHERE  id = ?
    `).get(reviewId);

    if (!review) {
      return res.status(404).json({
        success: false,
        error:   '존재하지 않는 리뷰입니다. (Review not found)',
      });
    }

    // 자신의 리뷰에 좋아요 방지
    if (review.user_id === userId) {
      return res.status(400).json({
        success: false,
        error:   '자신의 리뷰에는 좋아요를 누를 수 없습니다. (Cannot like your own review)',
      });
    }

    // ── 중복 좋아요 확인 ───────────────────────────────────────────────────
    const alreadyLiked = db.prepare(`
      SELECT id
      FROM   review_likes
      WHERE  user_id = ? AND review_id = ?
    `).get(userId, reviewId);

    if (alreadyLiked) {
      return res.status(409).json({
        success: false,
        error:   '이미 좋아요를 눌렀습니다. (Already liked this review)',
      });
    }

    // ── review_likes INSERT ────────────────────────────────────────────────
    const likeId = uuidv4();
    db.prepare(`
      INSERT INTO review_likes (id, user_id, review_id)
      VALUES (?, ?, ?)
    `).run(likeId, userId, reviewId);

    // ── reviews.like_count +1 ──────────────────────────────────────────────
    const newLikeCount = review.like_count + 1;

    db.prepare(`
      UPDATE reviews
      SET    like_count = ?
      WHERE  id = ?
    `).run(newLikeCount, reviewId);

    // ── 좋아요 10개 달성 시 작성자 보너스 스탬프 지급 ─────────────────────
    // bonus_stamp_given을 이미 10이상 지급 여부 플래그로 활용
    // (기존 bonus_stamp_given < 10 + offset → 신규 10개 달성 체크)
    // 단순하게: like_count가 10이 된 순간에만 지급 (10 미만 → 10)
    let bonusAwarded = false;

    if (newLikeCount === 10 && review.like_count < 10) {
      // 작성자에게 보너스 스탬프 지급을 위해 reviews.bonus_stamp_given 업데이트
      // (리뷰 생성 시의 보너스 + 좋아요 10개 보너스 2를 더해 기록)
      const newBonusTotal = review.bonus_stamp_given + 2;

      db.prepare(`
        UPDATE reviews
        SET    bonus_stamp_given = ?
        WHERE  id = ?
      `).run(newBonusTotal, reviewId);

      // 작성자 스탬프 잔액 재계산 (리뷰 보너스 합산 방식이므로 자동 반영)
      recalculateUserStamps(review.user_id, db);
      bonusAwarded = true;

      console.log(`[리뷰] 좋아요 10개 달성 보너스 지급 — reviewId: ${reviewId}, 작성자: ${review.user_id}, +2스탬프`);
    }

    return res.status(200).json({
      success:       true,
      like_count:    newLikeCount,
      bonus_awarded: bonusAwarded,
    });

  } catch (err) {
    // UNIQUE 제약 위반 — 동시 요청으로 인한 중복 처리
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({
        success: false,
        error:   '이미 좋아요를 눌렀습니다. (Already liked this review)',
      });
    }

    console.error('[리뷰] 좋아요 오류:', err.message);
    return res.status(500).json({
      success: false,
      error:   '좋아요 처리 중 오류가 발생했습니다. (Internal server error)',
    });
  }
});

// ──────────────────────────────────────────────
// GET /api/reviews/my — 내가 쓴 리뷰 목록 (🔐 인증 필수)
// ──────────────────────────────────────────────

/**
 * 로그인 사용자가 작성한 리뷰 목록을 최신순으로 반환합니다.
 *
 * spots 테이블과 JOIN하여 명소 이름을 함께 제공합니다.
 *
 * Query Parameters:
 *   lang {string} 언어 코드 (기본 'ko')
 *
 * Response 200:
 *   { success, count, reviews: [...spot_name, ...] }
 */
router.get('/my', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const lang   = req.query.lang || 'ko';

    // 리뷰 + 명소 정보 JOIN
    const reviews = db.prepare(`
      SELECT
        r.id,
        r.content,
        r.photo_url,
        r.rating,
        r.language,
        r.like_count,
        r.bonus_stamp_given,
        r.created_at,
        s.id       AS spot_id,
        s.name_ko,
        s.name_en,
        s.name_ja,
        s.name_zh,
        s.category AS spot_category,
        s.image_url AS spot_image_url
      FROM   reviews r
      JOIN   spots   s ON s.id = r.spot_id
      WHERE  r.user_id = ?
      ORDER  BY r.created_at DESC
    `).all(userId);

    // 현지화 처리
    const formatted = reviews.map(review => ({
      id:                 review.id,
      spot_id:            review.spot_id,
      spot_name:          getLocalizedField(review, lang, 'name'),
      spot_category:      review.spot_category,
      spot_image_url:     review.spot_image_url,
      content:            review.content,
      photo_url:          review.photo_url,
      rating:             review.rating,
      language:           review.language,
      like_count:         review.like_count,
      bonus_stamp_given:  review.bonus_stamp_given,
      created_at:         review.created_at,
    }));

    return res.status(200).json({
      success: true,
      count:   formatted.length,
      reviews: formatted,
    });

  } catch (err) {
    console.error('[리뷰] 내 리뷰 조회 오류:', err.message);
    return res.status(500).json({
      success: false,
      error:   '내 리뷰 조회 중 오류가 발생했습니다. (Internal server error)',
    });
  }
});

module.exports = router;
