/**
 * spots.js — 명소 라우트
 *
 * 부산 해안 명소 목록 조회, 주변 명소 검색, 상세 조회,
 * 실시간 혼잡도 폴링 기능을 제공합니다.
 *
 * 엔드포인트 목록:
 *   GET /api/spots/            — 전체 명소 목록 (혼잡도 포함)
 *   GET /api/spots/nearby      — 현재 위치 기준 반경 내 명소
 *   GET /api/spots/:id         — 명소 상세 (리뷰·위키·통계 포함)
 *   GET /api/spots/:id/congestion — 실시간 혼잡도만 반환 (폴링용)
 *
 * 공통 쿼리 파라미터:
 *   ?lang=ko|en|ja|zh  — 명소 이름/설명 현지화 (기본 ko)
 *
 * 주의: :id 경로는 /nearby 다음에 등록해야
 *       /nearby 요청이 /:id에 잡히지 않습니다.
 */

'use strict';

const express = require('express');

const db                                             = require('../db/database');
const { haversineDistance, getCongestion,
        getLocalizedField, CONGESTION_WINDOW_MINUTES } = require('../utils/helpers');

const router = express.Router();

// ──────────────────────────────────────────────
// 헬퍼: 명소 객체를 현지화 + 혼잡도 결합해 응답 형태로 가공
// ──────────────────────────────────────────────

/**
 * 명소 DB 레코드에 현지화 필드와 혼잡도 정보를 추가합니다.
 *
 * @param {Object} spot  - DB에서 조회한 spots 레코드
 * @param {string} lang  - 언어 코드 ('ko'|'en'|'ja'|'zh')
 * @param {boolean} [includeCongestion=true] - 혼잡도 포함 여부
 * @returns {Object} 응답용 명소 객체
 */
function formatSpot(spot, lang, includeCongestion = true) {
  // 현지화된 이름과 설명
  const name        = getLocalizedField(spot, lang, 'name');
  const description = getLocalizedField(spot, lang, 'description');

  // 기본 필드 구성 (4개국어 원본 필드는 제외 — 용량 절약)
  const formatted = {
    id:               spot.id,
    name,
    description,
    category:         spot.category,
    latitude:         spot.latitude,
    longitude:        spot.longitude,
    address:          spot.address,
    image_url:        spot.image_url,
    qr_code:          spot.qr_code,
    base_stamp_count: spot.base_stamp_count,
    order_in_route:   spot.order_in_route,
    is_active:        spot.is_active,
    created_at:       spot.created_at,
  };

  // 혼잡도 정보 추가
  if (includeCongestion) {
    const congestion = getCongestion(spot.id, db);
    formatted.congestion = {
      level:       congestion.level,
      label:       congestion.label,
      emoji:       congestion.emoji,
      multiplier:  congestion.multiplier,
      recentCount: congestion.recentCount,
    };
  }

  return formatted;
}

// ──────────────────────────────────────────────
// GET /api/spots/ — 전체 명소 목록
// ──────────────────────────────────────────────

/**
 * 활성화된 명소 전체 목록을 혼잡도와 함께 반환합니다.
 *
 * Query Parameters:
 *   lang     {string}  언어 코드 (기본 'ko')
 *   category {string}  카테고리 필터 (선택)
 *             beach | harbor | island_lighthouse | marine_culture |
 *             coastal_trail | seafood | hidden
 *   is_active {number} 활성 필터 (기본 1, 0이면 비활성 포함)
 *
 * Response 200:
 *   { success: true, count, spots: [...] }
 */
router.get('/', (req, res) => {
  try {
    const lang       = req.query.lang     || 'ko';
    const category   = req.query.category || null;
    // is_active 기본값: 1 (활성 명소만 반환)
    // '0'을 명시적으로 넘기면 전체(비활성 포함) 조회
    const isActiveRaw = req.query.is_active;
    const filterActive = isActiveRaw === '0' ? false : true;

    // 동적 WHERE 절 구성
    const conditions = [];
    const params     = [];

    if (filterActive) {
      conditions.push('is_active = 1');
    }

    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    // 해안선 순서(order_in_route) 기준 오름차순 정렬
    const spots = db.prepare(`
      SELECT *
      FROM   spots
      ${whereClause}
      ORDER BY order_in_route ASC
    `).all(...params);

    // 현지화 + 혼잡도 가공
    const formatted = spots.map(spot => formatSpot(spot, lang, true));

    return res.status(200).json({
      success: true,
      count:   formatted.length,
      spots:   formatted,
    });

  } catch (err) {
    console.error('[명소] 목록 조회 오류:', err.message);
    return res.status(500).json({
      success: false,
      error:   '명소 목록 조회 중 오류가 발생했습니다. (Internal server error)',
    });
  }
});

// ──────────────────────────────────────────────
// GET /api/spots/nearby — 현재 위치 기준 반경 내 명소
// ──────────────────────────────────────────────

/**
 * 사용자의 현재 GPS 좌표를 기준으로 지정 반경 내 명소를
 * 거리 오름차순으로 반환합니다.
 *
 * 모든 명소를 가져온 뒤 Haversine 공식으로 거리를 계산합니다.
 * (SQLite에서 삼각함수 UDF 없이 처리 가능)
 *
 * Query Parameters:
 *   lat    {number} 필수. 사용자 위도
 *   lng    {number} 필수. 사용자 경도
 *   radius {number} 반경 (미터, 기본 3000m = 3km)
 *   lang   {string} 언어 코드 (기본 'ko')
 *
 * Response 200:
 *   { success: true, count, user_location: {...}, spots: [...distance_meters...] }
 *
 * Error:
 *   400 — lat 또는 lng 누락
 */
router.get('/nearby', (req, res) => {
  try {
    const lat    = parseFloat(req.query.lat);
    const lng    = parseFloat(req.query.lng);
    const radius = parseFloat(req.query.radius) || 3000; // 기본 3km
    const lang   = req.query.lang || 'ko';

    // 좌표 필수 확인
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({
        success: false,
        error:   'lat(위도)와 lng(경도) 파라미터가 필요합니다. (lat and lng query parameters are required)',
      });
    }

    // 위도/경도 범위 기본 검증
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({
        success: false,
        error:   '유효하지 않은 GPS 좌표입니다. (Invalid GPS coordinates)',
      });
    }

    // 활성 명소 전체 조회
    const allSpots = db.prepare(`
      SELECT *
      FROM   spots
      WHERE  is_active = 1
    `).all();

    // Haversine 거리 계산 → 반경 내 필터 → 거리 오름차순 정렬
    const nearbySpots = allSpots
      .map(spot => {
        const distanceMeters = haversineDistance(lat, lng, spot.latitude, spot.longitude);
        return { ...spot, distance_meters: Math.round(distanceMeters) };
      })
      .filter(spot => spot.distance_meters <= radius)
      .sort((a, b) => a.distance_meters - b.distance_meters);

    // 현지화 + 혼잡도 가공 후 distance_meters 필드 유지
    const formatted = nearbySpots.map(spot => ({
      ...formatSpot(spot, lang, true),
      distance_meters: spot.distance_meters,
    }));

    return res.status(200).json({
      success:       true,
      count:         formatted.length,
      user_location: { lat, lng },
      radius_meters: radius,
      spots:         formatted,
    });

  } catch (err) {
    console.error('[명소] nearby 조회 오류:', err.message);
    return res.status(500).json({
      success: false,
      error:   '주변 명소 조회 중 오류가 발생했습니다. (Internal server error)',
    });
  }
});

// ──────────────────────────────────────────────
// GET /api/spots/:id — 명소 상세
// ──────────────────────────────────────────────

/**
 * 특정 명소의 상세 정보를 반환합니다.
 *
 * 포함 내용:
 *   - 명소 기본 정보 + 현지화 필드
 *   - 실시간 혼잡도
 *   - 최근 리뷰 5개 (좋아요 수 내림차순, 동점 시 최신순)
 *   - 승인된 위키 3개 (최신순), 만료된 이벤트 제외
 *   - 통계 (총 방문자 수, 평균 평점)
 *
 * Query Parameters:
 *   lang {string} 언어 코드 (기본 'ko')
 *
 * Error:
 *   404 — 명소를 찾을 수 없음
 */
router.get('/:id', (req, res) => {
  try {
    const spotId = req.params.id;
    const lang   = req.query.lang || 'ko';

    if (!spotId || typeof spotId !== 'string') {
      return res.status(400).json({
        success: false,
        error:   '유효하지 않은 명소 ID입니다. (Invalid spot ID)',
      });
    }

    // ── 1. 명소 기본 정보 조회 ────────────────────────────────────────────
    const spot = db.prepare(`
      SELECT *
      FROM   spots
      WHERE  id = ?
    `).get(spotId);

    if (!spot) {
      return res.status(404).json({
        success: false,
        error:   '명소를 찾을 수 없습니다. (Spot not found)',
      });
    }

    // ── 2. 실시간 혼잡도 ──────────────────────────────────────────────────
    const congestion = getCongestion(spotId, db);

    // ── 3. 최근 리뷰 5개 (좋아요 내림차순, 동점 시 최신순) ───────────────
    const reviews = db.prepare(`
      SELECT r.id, r.content, r.photo_url, r.rating, r.language,
             r.like_count, r.created_at,
             u.nickname AS author_nickname
      FROM   reviews r
      JOIN   users   u ON u.id = r.user_id
      WHERE  r.spot_id = ?
      ORDER BY r.like_count DESC, r.created_at DESC
      LIMIT  5
    `).all(spotId);

    // ── 4. 승인된 위키 3개 (최신순, 만료된 이벤트 제외) ──────────────────
    // 오늘 날짜 (YYYY-MM-DD) — 이벤트 종료일 비교에 사용
    const today = new Date().toISOString().substring(0, 10);

    const wikis = db.prepare(`
      SELECT wp.id, wp.title, wp.category, wp.photo_url,
             wp.event_start_date, wp.event_end_date,
             wp.view_count, wp.helpful_count, wp.created_at,
             u.nickname AS author_nickname
      FROM   wiki_posts wp
      JOIN   users      u ON u.id = wp.user_id
      WHERE  wp.spot_id = ?
      AND    wp.status  = 'approved'
      AND    (
        -- 이벤트가 아닌 경우 항상 표시
        wp.category != 'event'
        OR
        -- 이벤트인 경우 종료일이 없거나 오늘 이후인 것만 표시
        (wp.event_end_date IS NULL OR wp.event_end_date >= ?)
      )
      ORDER BY wp.created_at DESC
      LIMIT  3
    `).all(spotId, today);

    // ── 5. 통계: 총 방문자 수 + 평균 평점 ────────────────────────────────
    const visitStats = db.prepare(`
      SELECT COUNT(DISTINCT user_id) AS unique_visitors,
             COUNT(*)                AS total_stamps
      FROM   stamp_logs
      WHERE  spot_id = ?
    `).get(spotId);

    const ratingStats = db.prepare(`
      SELECT COUNT(*)    AS review_count,
             AVG(rating) AS avg_rating
      FROM   reviews
      WHERE  spot_id = ?
    `).get(spotId);

    // ── 6. 응답 조립 ──────────────────────────────────────────────────────
    const formattedSpot = formatSpot(spot, lang, false); // 혼잡도는 별도 추가

    return res.status(200).json({
      success: true,
      spot:    {
        ...formattedSpot,
        congestion: {
          level:       congestion.level,
          label:       congestion.label,
          emoji:       congestion.emoji,
          multiplier:  congestion.multiplier,
          recentCount: congestion.recentCount,
        },
        stats: {
          unique_visitors: visitStats ? visitStats.unique_visitors : 0,
          total_stamps:    visitStats ? visitStats.total_stamps    : 0,
          review_count:    ratingStats ? ratingStats.review_count  : 0,
          avg_rating:      ratingStats && ratingStats.avg_rating
                             ? Math.round(ratingStats.avg_rating * 10) / 10
                             : null,
        },
        recent_reviews: reviews,
        recent_wikis:   wikis,
      },
    });

  } catch (err) {
    console.error('[명소] 상세 조회 오류:', err.message);
    return res.status(500).json({
      success: false,
      error:   '명소 상세 조회 중 오류가 발생했습니다. (Internal server error)',
    });
  }
});

// ──────────────────────────────────────────────
// GET /api/spots/:id/congestion — 실시간 혼잡도 폴링
// ──────────────────────────────────────────────

/**
 * 특정 명소의 현재 혼잡도 정보만 빠르게 반환합니다.
 *
 * 클라이언트가 일정 간격으로 폴링할 때 사용합니다.
 * 전체 상세 조회(/:id)보다 훨씬 가볍습니다.
 *
 * Response 200:
 *   {
 *     success: true,
 *     spot_id,
 *     level: 'low'|'mid'|'high',
 *     label: '여유'|'보통'|'혼잡',
 *     emoji: '🟢'|'🟡'|'🔴',
 *     multiplier: 2.0|1.5|1.0,
 *     recent_count: number,    -- 최근 N분 내 인증 건수
 *     window_minutes: number   -- N분 (환경변수 설정값)
 *   }
 *
 * Error:
 *   404 — 명소를 찾을 수 없음
 */
router.get('/:id/congestion', (req, res) => {
  try {
    const spotId = req.params.id;

    if (!spotId || typeof spotId !== 'string') {
      return res.status(400).json({
        success: false,
        error:   '유효하지 않은 명소 ID입니다. (Invalid spot ID)',
      });
    }

    // 명소 존재 확인 (is_active 무관 — 관리 목적 폴링도 허용)
    const spot = db.prepare(`
      SELECT id FROM spots WHERE id = ?
    `).get(spotId);

    if (!spot) {
      return res.status(404).json({
        success: false,
        error:   '명소를 찾을 수 없습니다. (Spot not found)',
      });
    }

    // 혼잡도 계산
    const congestion = getCongestion(spotId, db);

    return res.status(200).json({
      success:        true,
      spot_id:        spotId,
      level:          congestion.level,
      label:          congestion.label,
      emoji:          congestion.emoji,
      multiplier:     congestion.multiplier,
      recent_count:   congestion.recentCount,
      window_minutes: CONGESTION_WINDOW_MINUTES,
    });

  } catch (err) {
    console.error('[명소] 혼잡도 조회 오류:', err.message);
    return res.status(500).json({
      success: false,
      error:   '혼잡도 조회 중 오류가 발생했습니다. (Internal server error)',
    });
  }
});

module.exports = router;
