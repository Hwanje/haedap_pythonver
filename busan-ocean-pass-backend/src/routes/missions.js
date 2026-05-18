/**
 * missions.js — 미션 라우트
 *
 * 여러 명소를 조합한 테마 미션을 제공합니다.
 * 사용자가 미션에 필요한 모든 명소를 방문하면 자동으로 완료되고
 * 보너스 스탬프가 지급됩니다 (stamps.js의 checkAndCompleteMissions 호출).
 *
 * 엔드포인트:
 *   GET /api/missions/     - 전체 미션 목록 + 로그인 시 진행률 포함 (optionalAuth)
 *   GET /api/missions/my   - 내가 완료한 미션 목록 (🔐)
 */

'use strict';

const express = require('express');
const router  = express.Router();

const { authenticateToken, optionalAuth } = require('../middleware/auth');
const db                                  = require('../db/database');

// ──────────────────────────────────────────────
// GET /api/missions/ — 전체 미션 목록 (비로그인 허용)
// ──────────────────────────────────────────────

/**
 * 활성화된 미션 전체 목록을 반환합니다.
 *
 * 로그인한 사용자의 경우 각 미션별 진행률 정보가 추가됩니다:
 *   - visited_count   : 필수 명소 중 방문한 수
 *   - required_count  : 미션 완료에 필요한 총 명소 수
 *   - percent         : 진행률 (0~100)
 *   - is_completed    : 완료 여부
 *
 * 비로그인 사용자는 미션 기본 정보만 반환됩니다.
 */
router.get('/', optionalAuth, (req, res) => {
  // 활성 미션 전체 조회
  const missions = db.prepare(`
    SELECT
      id,
      name_ko,
      name_en,
      description,
      required_spot_ids,
      bonus_stamps,
      bonus_reward,
      icon,
      is_active,
      created_at
    FROM  missions
    WHERE is_active = 1
    ORDER BY created_at ASC
  `).all();

  // 미션이 없으면 빈 배열 반환
  if (missions.length === 0) {
    return res.json({ success: true, count: 0, data: [] });
  }

  // 비로그인 사용자: 기본 정보만 반환
  if (!req.user) {
    const data = missions.map(mission => {
      let requiredIds = [];
      try {
        requiredIds = JSON.parse(mission.required_spot_ids || '[]');
      } catch {
        requiredIds = [];
      }

      return {
        ...mission,
        required_spot_ids: requiredIds,
        required_count:    requiredIds.length,
        // 비로그인 시 진행률 정보 없음
        progress: null,
      };
    });

    return res.json({ success: true, count: data.length, data });
  }

  // 로그인 사용자: 진행률 계산을 위해 방문 명소와 완료 미션 조회
  const visitedRows = db.prepare(`
    SELECT DISTINCT spot_id
    FROM   stamp_logs
    WHERE  user_id = ?
  `).all(req.user.id);

  const visitedSet = new Set(visitedRows.map(r => r.spot_id));

  // 완료한 미션 ID 집합
  const completedRows = db.prepare(`
    SELECT mission_id
    FROM   mission_completions
    WHERE  user_id = ?
  `).all(req.user.id);

  const completedSet = new Set(completedRows.map(r => r.mission_id));

  // 각 미션에 진행률 정보 추가
  const data = missions.map(mission => {
    let requiredIds = [];
    try {
      requiredIds = JSON.parse(mission.required_spot_ids || '[]');
    } catch {
      console.warn(`[미션] required_spot_ids 파싱 실패 — mission.id: ${mission.id}`);
      requiredIds = [];
    }

    const requiredCount = requiredIds.length;
    const visitedCount  = requiredIds.filter(spotId => visitedSet.has(spotId)).length;
    const isCompleted   = completedSet.has(mission.id);

    // 미완료 시 실제 방문 수 기준으로 진행률 계산
    // 완료된 미션은 100% 표시
    const percent = requiredCount === 0
      ? 0
      : isCompleted
        ? 100
        : Math.floor((visitedCount / requiredCount) * 100);

    return {
      ...mission,
      required_spot_ids: requiredIds,
      progress: {
        visited_count:  visitedCount,
        required_count: requiredCount,
        percent,
        is_completed:   isCompleted,
      },
    };
  });

  return res.json({ success: true, count: data.length, data });
});

// ──────────────────────────────────────────────
// GET /api/missions/my — 내가 완료한 미션 목록 (인증 필수)
// ※ /:id 형태의 라우트가 없으므로 /my 등록 순서는 무방하나
//   확장성을 위해 명시적으로 앞에 위치
// ──────────────────────────────────────────────

/**
 * 로그인한 사용자가 완료한 미션 목록을 최신순으로 반환합니다.
 *
 * missions 테이블과 JOIN하여 미션 상세 정보도 함께 반환합니다.
 */
router.get('/my', authenticateToken, (req, res) => {
  const completions = db.prepare(`
    SELECT
      mc.id           AS completion_id,
      mc.completed_at,
      m.id            AS mission_id,
      m.name_ko,
      m.name_en,
      m.description,
      m.required_spot_ids,
      m.bonus_stamps,
      m.bonus_reward,
      m.icon
    FROM  mission_completions mc
    JOIN  missions m ON m.id = mc.mission_id
    WHERE mc.user_id = ?
    ORDER BY mc.completed_at DESC
  `).all(req.user.id);

  // required_spot_ids JSON 파싱
  const data = completions.map(row => ({
    ...row,
    required_spot_ids: (() => {
      try {
        return JSON.parse(row.required_spot_ids || '[]');
      } catch {
        return [];
      }
    })(),
  }));

  // 완료 미션 총 보너스 스탬프 합계
  const totalBonus = data.reduce((sum, row) => sum + (row.bonus_stamps || 0), 0);

  return res.json({
    success:           true,
    count:             data.length,
    total_bonus_stamps: totalBonus,
    data,
  });
});

module.exports = router;
