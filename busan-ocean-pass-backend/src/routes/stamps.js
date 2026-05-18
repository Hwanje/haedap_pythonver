/**
 * stamps.js — 스탬프 인증 라우트
 *
 * 부산 해안 명소를 QR 코드 + GPS로 인증하고 스탬프를 지급합니다.
 * 혼잡도에 따라 배율이 달라지며, 인증 시마다 미션 달성 여부를 자동 확인합니다.
 *
 * 엔드포인트 목록 (모두 인증 필요 🔐):
 *   POST /api/stamps/verify       — QR+GPS 이중 인증으로 스탬프 획득
 *   GET  /api/stamps/my           — 내 스탬프 인증 이력 조회
 *   GET  /api/stamps/progress     — 해안선 방문 진행률 및 카테고리 통계
 *
 * 인증 흐름:
 *   QR 코드 조회 → 명소 활성 확인 → GPS 반경 확인(200m)
 *   → 24시간 중복 인증 차단 → 혼잡도 계산 → 스탬프 지급
 *   → 미션 자동 완료 체크
 */

'use strict';

const express = require('express');

const db                               = require('../db/database');
const { authenticateToken }            = require('../middleware/auth');
const {
  haversineDistance,
  getCongestion,
  recalculateUserStamps,
  checkAndCompleteMissions,
  getLocalizedField,
} = require('../utils/helpers');

// GPS 검증 반경 (미터) — 환경변수로 조정 가능, 기본 200m
const GPS_VERIFY_RADIUS_METERS = parseInt(process.env.GPS_VERIFY_RADIUS_METERS, 10) || 200;

const router = express.Router();

// 모든 엔드포인트에 인증 필수 적용
router.use(authenticateToken);

// ──────────────────────────────────────────────
// POST /api/stamps/verify — QR + GPS 이중 인증
// ──────────────────────────────────────────────

/**
 * QR 코드와 GPS 좌표를 이중 검증하여 명소 스탬프를 지급합니다.
 *
 * 처리 순서:
 *   1. qr_code로 명소 조회 → 404
 *   2. is_active 확인 → 400
 *   3. GPS 반경 확인 (200m) → 403
 *   4. 24시간 내 중복 인증 차단 → 409
 *   5. 혼잡도 계산 → 배율 결정
 *   6. earned_count = ceil(base_stamp_count * multiplier)
 *   7. stamp_logs INSERT
 *   8. 스탬프 잔액 재계산
 *   9. 미션 자동 완료 체크
 *
 * Request Body:
 *   { qr_code: string, user_lat: number, user_lng: number }
 *
 * Response 201:
 *   { success, spot, earned_count, multiplier, congestion, new_total_stamps, completed_missions }
 */
router.post('/verify', (req, res) => {
  try {
    const { qr_code, user_lat, user_lng } = req.body;
    const userId = req.user.id;

    // ── 요청 파라미터 검증 ──────────────────────────────────────────────────
    if (!qr_code) {
      return res.status(400).json({
        success: false,
        error:   'qr_code가 필요합니다. (qr_code is required)',
      });
    }

    // GPS 좌표 필수 확인
    if (user_lat === undefined || user_lat === null ||
        user_lng === undefined || user_lng === null) {
      return res.status(400).json({
        success: false,
        error:   'GPS 좌표(user_lat, user_lng)가 필요합니다. (GPS coordinates are required)',
      });
    }

    const lat = parseFloat(user_lat);
    const lng = parseFloat(user_lng);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({
        success: false,
        error:   '유효하지 않은 GPS 좌표입니다. (Invalid GPS coordinates)',
      });
    }

    // 위도/경도 범위 검증
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({
        success: false,
        error:   'GPS 좌표 범위를 벗어났습니다. (GPS coordinates out of range)',
      });
    }

    // ── 1. QR 코드로 명소 조회 ─────────────────────────────────────────────
    const spot = db.prepare(`
      SELECT *
      FROM   spots
      WHERE  qr_code = ?
    `).get(qr_code);

    if (!spot) {
      return res.status(404).json({
        success: false,
        error:   '존재하지 않는 QR 코드입니다. (Invalid QR code)',
      });
    }

    // ── 2. 명소 활성 상태 확인 ─────────────────────────────────────────────
    if (!spot.is_active) {
      return res.status(400).json({
        success: false,
        error:   '현재 인증이 비활성화된 명소입니다. (This spot is currently inactive)',
      });
    }

    // ── 3. GPS 반경 검증 (Haversine) ───────────────────────────────────────
    const distanceMeters = Math.round(
      haversineDistance(lat, lng, spot.latitude, spot.longitude)
    );

    if (distanceMeters > GPS_VERIFY_RADIUS_METERS) {
      return res.status(403).json({
        success:  false,
        error:    `명소에서 너무 멀리 있습니다. 현재 거리: ${distanceMeters}m / You are too far from the spot. (${distanceMeters}m away, limit: ${GPS_VERIFY_RADIUS_METERS}m)`,
        distance_meters: distanceMeters,
        limit_meters:    GPS_VERIFY_RADIUS_METERS,
      });
    }

    // ── 4. 24시간 내 동일 명소 중복 인증 차단 ─────────────────────────────
    // 현재 시각 기준 24시간 전 ISO 타임스탬프 계산
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .replace('T', ' ')
      .substring(0, 19);

    const recentLog = db.prepare(`
      SELECT id
      FROM   stamp_logs
      WHERE  user_id     = ?
      AND    spot_id     = ?
      AND    verified_at >= ?
    `).get(userId, spot.id, oneDayAgo);

    if (recentLog) {
      return res.status(409).json({
        success: false,
        error:   '24시간 내 이미 인증한 명소입니다. (Already verified this spot within 24 hours)',
      });
    }

    // ── 5. 혼잡도 계산 + 배율 결정 ────────────────────────────────────────
    const congestion = getCongestion(spot.id, db);
    const multiplier = congestion.multiplier;

    // ── 6. 획득 스탬프 수 계산 (올림 처리) ────────────────────────────────
    const earnedCount = Math.ceil(spot.base_stamp_count * multiplier);

    // ── 7. stamp_logs INSERT ───────────────────────────────────────────────
    // id는 AUTOINCREMENT INTEGER이므로 생략 (DB가 자동 부여)
    const verifiedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);

    db.prepare(`
      INSERT INTO stamp_logs
        (user_id, spot_id, earned_count, multiplier, verification_method,
         user_lat, user_lng, verified_at)
      VALUES
        (?, ?, ?, ?, 'qr_gps', ?, ?, ?)
    `).run(userId, spot.id, earnedCount, multiplier, lat, lng, verifiedAt);

    // ── 8. 스탬프 잔액 재계산 ──────────────────────────────────────────────
    const newTotalStamps = recalculateUserStamps(userId, db);

    // ── 9. 미션 자동 완료 체크 ─────────────────────────────────────────────
    const completedMissions = checkAndCompleteMissions(userId, db);

    // ── 응답 ───────────────────────────────────────────────────────────────
    return res.status(201).json({
      success: true,
      spot: {
        id:       spot.id,
        name:     spot.name_ko,
        category: spot.category,
        address:  spot.address,
      },
      earned_count:       earnedCount,
      multiplier,
      congestion: {
        level:   congestion.level,
        label:   congestion.label,
        emoji:   congestion.emoji,
      },
      distance_meters:    distanceMeters,
      new_total_stamps:   newTotalStamps,
      completed_missions: completedMissions,
    });

  } catch (err) {
    console.error('[스탬프] 인증 오류:', err.message);
    return res.status(500).json({
      success: false,
      error:   '스탬프 인증 중 오류가 발생했습니다. (Internal server error)',
    });
  }
});

// ──────────────────────────────────────────────
// GET /api/stamps/my — 내 스탬프 인증 이력
// ──────────────────────────────────────────────

/**
 * 로그인 사용자의 스탬프 인증 이력 전체를 반환합니다.
 *
 * spots 테이블과 JOIN하여 명소 이름을 함께 제공합니다.
 * ?lang 파라미터로 명소 이름 현지화가 가능합니다.
 *
 * Query Parameters:
 *   lang {string} 언어 코드 (기본 'ko')
 *
 * Response 200:
 *   { success, count, total_stamps, logs: [...] }
 */
router.get('/my', (req, res) => {
  try {
    const userId = req.user.id;
    const lang   = req.query.lang || 'ko';

    // 스탬프 인증 이력 + 명소 정보 JOIN
    const logs = db.prepare(`
      SELECT
        sl.id,
        sl.earned_count,
        sl.multiplier,
        sl.verification_method,
        sl.user_lat,
        sl.user_lng,
        sl.verified_at,
        s.id          AS spot_id,
        s.name_ko,
        s.name_en,
        s.name_ja,
        s.name_zh,
        s.category,
        s.address,
        s.image_url
      FROM   stamp_logs sl
      JOIN   spots s ON s.id = sl.spot_id
      WHERE  sl.user_id = ?
      ORDER  BY sl.verified_at DESC
    `).all(userId);

    // 현지화 처리
    const formatted = logs.map(log => ({
      id:                  log.id,
      spot_id:             log.spot_id,
      spot_name:           getLocalizedField(log, lang, 'name'),
      spot_category:       log.category,
      spot_address:        log.address,
      spot_image_url:      log.image_url,
      earned_count:        log.earned_count,
      multiplier:          log.multiplier,
      verification_method: log.verification_method,
      user_lat:            log.user_lat,
      user_lng:            log.user_lng,
      verified_at:         log.verified_at,
    }));

    // 사용자 현재 총 스탬프 조회
    const user = db.prepare(`
      SELECT total_stamps FROM users WHERE id = ?
    `).get(userId);

    return res.status(200).json({
      success:      true,
      count:        formatted.length,
      total_stamps: user ? user.total_stamps : 0,
      logs:         formatted,
    });

  } catch (err) {
    console.error('[스탬프] 이력 조회 오류:', err.message);
    return res.status(500).json({
      success: false,
      error:   '스탬프 이력 조회 중 오류가 발생했습니다. (Internal server error)',
    });
  }
});

// ──────────────────────────────────────────────
// GET /api/stamps/progress — 해안선 방문 진행률
// ──────────────────────────────────────────────

/**
 * 로그인 사용자의 해안선 방문 진행률과 카테고리별 통계를 반환합니다.
 *
 * 포함 내용:
 *   - visited_count    : 방문한 명소 수 (중복 제거)
 *   - total_spots      : 전체 활성 명소 수
 *   - progress_percent : 방문률 (소수점 1자리)
 *   - category_stats   : 카테고리별 { total, visited, percent }
 *   - next_recommended : 아직 미방문 명소 중 order_in_route 순 다음 3곳
 *                        (혼잡도 낮은 곳 우선)
 *
 * Query Parameters:
 *   lang {string} 언어 코드 (기본 'ko')
 *
 * Response 200:
 *   { success, visited_count, total_spots, progress_percent,
 *     category_stats, next_recommended }
 */
router.get('/progress', (req, res) => {
  try {
    const userId = req.user.id;
    const lang   = req.query.lang || 'ko';

    // ── 전체 활성 명소 조회 ────────────────────────────────────────────────
    const allSpots = db.prepare(`
      SELECT id, name_ko, name_en, name_ja, name_zh,
             category, address, image_url, order_in_route, base_stamp_count
      FROM   spots
      WHERE  is_active = 1
      ORDER  BY order_in_route ASC
    `).all();

    // ── 사용자가 방문한 명소 ID 집합 ──────────────────────────────────────
    const visitedRows = db.prepare(`
      SELECT DISTINCT spot_id
      FROM   stamp_logs
      WHERE  user_id = ?
    `).all(userId);

    const visitedSet = new Set(visitedRows.map(r => r.spot_id));

    const totalSpots  = allSpots.length;
    const visitedCount = visitedSet.size;

    // ── 진행률 계산 (소수점 1자리) ─────────────────────────────────────────
    const progressPercent = totalSpots > 0
      ? Math.round((visitedCount / totalSpots) * 1000) / 10
      : 0;

    // ── 카테고리별 통계 ────────────────────────────────────────────────────
    // 카테고리별 전체 명소 수와 방문 명소 수 집계
    const categoryMap = {};

    for (const spot of allSpots) {
      const cat = spot.category;
      if (!categoryMap[cat]) {
        categoryMap[cat] = { total: 0, visited: 0 };
      }
      categoryMap[cat].total += 1;
      if (visitedSet.has(spot.id)) {
        categoryMap[cat].visited += 1;
      }
    }

    // 카테고리 통계에 percent 추가
    const categoryStats = {};
    for (const [cat, stats] of Object.entries(categoryMap)) {
      categoryStats[cat] = {
        total:   stats.total,
        visited: stats.visited,
        percent: stats.total > 0
          ? Math.round((stats.visited / stats.total) * 1000) / 10
          : 0,
      };
    }

    // ── 다음 추천 명소 3곳 ─────────────────────────────────────────────────
    // 아직 방문하지 않은 명소 중 order_in_route 순서로 후보 선별
    const unvisitedSpots = allSpots.filter(s => !visitedSet.has(s.id));

    // 혼잡도를 계산하여 낮은 곳 우선 정렬
    // 정렬 기준: 혼잡도 레벨(low→mid→high), 동점 시 order_in_route 오름차순
    const congestionOrder = { low: 0, mid: 1, high: 2 };

    const unvisitedWithCongestion = unvisitedSpots.map(spot => {
      const congestion = getCongestion(spot.id, db);
      return { ...spot, congestion };
    });

    unvisitedWithCongestion.sort((a, b) => {
      const cDiff = congestionOrder[a.congestion.level] - congestionOrder[b.congestion.level];
      if (cDiff !== 0) return cDiff;
      return a.order_in_route - b.order_in_route;
    });

    // 상위 3곳 추출
    const nextRecommended = unvisitedWithCongestion.slice(0, 3).map(spot => ({
      id:             spot.id,
      name:           getLocalizedField(spot, lang, 'name'),
      category:       spot.category,
      address:        spot.address,
      image_url:      spot.image_url,
      order_in_route: spot.order_in_route,
      congestion: {
        level:      spot.congestion.level,
        label:      spot.congestion.label,
        emoji:      spot.congestion.emoji,
        multiplier: spot.congestion.multiplier,
      },
    }));

    return res.status(200).json({
      success:          true,
      visited_count:    visitedCount,
      total_spots:      totalSpots,
      progress_percent: progressPercent,
      category_stats:   categoryStats,
      next_recommended: nextRecommended,
    });

  } catch (err) {
    console.error('[스탬프] 진행률 조회 오류:', err.message);
    return res.status(500).json({
      success: false,
      error:   '진행률 조회 중 오류가 발생했습니다. (Internal server error)',
    });
  }
});

module.exports = router;
