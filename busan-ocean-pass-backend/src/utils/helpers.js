/**
 * helpers.js — 공통 유틸리티 함수 모음
 *
 * 이 모듈은 라우트와 미들웨어 전반에서 재사용되는
 * 핵심 비즈니스 로직 함수들을 제공합니다.
 *
 * 주요 기능:
 *   - haversineDistance : GPS 두 좌표 간 거리 계산 (명소 인증 반경 검사)
 *   - getCongestion     : 명소 혼잡도 계산 (스탬프 배율 결정)
 *   - recalculateUserStamps : 사용자 스탬프 잔액 재계산 (트랜잭션 안전)
 *   - checkAndCompleteMissions : 미션 자동 완료 체크
 *   - formatStampCount  : 소수점 스탬프 올림 처리
 *   - getLocalizedField : 다국어 필드 반환 (ko 폴백)
 */

'use strict';

require('dotenv').config();

// ──────────────────────────────────────────────
// 환경변수 상수
// ──────────────────────────────────────────────

/** 혼잡도 계산 시간 창 (분) — 기본 60분 */
const CONGESTION_WINDOW_MINUTES = parseInt(process.env.CONGESTION_WINDOW_MINUTES, 10) || 60;

/** 혼잡(🔴) 기준 방문 건수 이상 — 기본 20 */
const CONGESTION_HIGH_THRESHOLD = parseInt(process.env.CONGESTION_HIGH_THRESHOLD, 10) || 20;

/** 보통(🟡) 기준 방문 건수 이상 — 기본 8 */
const CONGESTION_MID_THRESHOLD = parseInt(process.env.CONGESTION_MID_THRESHOLD, 10) || 8;

// ──────────────────────────────────────────────
// 지리 계산
// ──────────────────────────────────────────────

/**
 * Haversine 공식으로 두 GPS 좌표 간의 직선 거리를 미터 단위로 반환합니다.
 *
 * 사용처: POST /api/stamps/verify — 사용자 위치와 명소 좌표 비교
 *
 * @param {number} lat1 - 출발 위도 (도)
 * @param {number} lon1 - 출발 경도 (도)
 * @param {number} lat2 - 도착 위도 (도)
 * @param {number} lon2 - 도착 경도 (도)
 * @returns {number} 두 좌표 사이의 거리 (미터)
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  // 지구 반지름 (미터)
  const R = 6_371_000;

  // 위도·경도 차이를 라디안으로 변환
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // 미터 단위
}

/**
 * 도(degree)를 라디안(radian)으로 변환합니다.
 * @param {number} deg
 * @returns {number}
 */
function toRad(deg) {
  return deg * (Math.PI / 180);
}

// ──────────────────────────────────────────────
// 혼잡도 계산
// ──────────────────────────────────────────────

/**
 * 특정 명소의 현재 혼잡도를 계산하고 스탬프 배율을 결정합니다.
 *
 * 최근 CONGESTION_WINDOW_MINUTES(기본 60분) 내 stamp_logs 건수를 집계합니다.
 *
 * 반환 기준:
 *   count >= CONGESTION_HIGH_THRESHOLD(20) → high  (배율 1.0x) 🔴
 *   count >= CONGESTION_MID_THRESHOLD(8)   → mid   (배율 1.5x) 🟡
 *   count <  CONGESTION_MID_THRESHOLD(8)   → low   (배율 2.0x) 🟢
 *
 * 혼잡도가 낮을수록(여유로울수록) 더 많은 스탬프를 지급해
 * 방문객 분산 효과를 유도합니다.
 *
 * @param {number|string} spotId - 명소 ID
 * @param {import('better-sqlite3').Database} db - DB 인스턴스
 * @returns {{ level: string, label: string, emoji: string, multiplier: number, recentCount: number }}
 */
function getCongestion(spotId, db) {
  // 현재 시각 기준 N분 전 ISO 타임스탬프 계산
  const windowStart = new Date(Date.now() - CONGESTION_WINDOW_MINUTES * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .substring(0, 19);

  // 해당 명소의 최근 N분 내 스탬프 인증 건수 집계
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM   stamp_logs
    WHERE  spot_id    = ?
    AND    verified_at >= ?
  `).get(spotId, windowStart);

  const count = row ? (row.cnt || 0) : 0;

  // 혼잡도 등급 결정
  if (count >= CONGESTION_HIGH_THRESHOLD) {
    return {
      level:       'high',
      label:       '혼잡',
      emoji:       '🔴',
      multiplier:  1.0,
      recentCount: count,
    };
  }

  if (count >= CONGESTION_MID_THRESHOLD) {
    return {
      level:       'mid',
      label:       '보통',
      emoji:       '🟡',
      multiplier:  1.5,
      recentCount: count,
    };
  }

  return {
    level:       'low',
    label:       '여유',
    emoji:       '🟢',
    multiplier:  2.0,
    recentCount: count,
  };
}

// ──────────────────────────────────────────────
// 스탬프 잔액 재계산
// ──────────────────────────────────────────────

/**
 * 사용자의 스탬프 잔액을 전체 이력에서 정확하게 재계산하고
 * users.total_stamps를 업데이트합니다.
 *
 * 계산 공식:
 *   잔액 = (스탬프 인증 합계)
 *         + (리뷰 보너스 합계)
 *         + (승인된 위키 보상 합계)
 *         + (미션 완료 보너스 합계)
 *         - (리워드 교환 소모 합계, status = 'issued' 또는 'used')
 *
 * 주의: status = 'expired' 리워드도 소모된 것으로 처리합니다.
 * (발급 시점에 스탬프가 차감되므로 만료 여부와 무관)
 *
 * @param {string} userId - 사용자 UUID
 * @param {import('better-sqlite3').Database} db - DB 인스턴스
 * @returns {number} 재계산 후 새 스탬프 잔액
 */
function recalculateUserStamps(userId, db) {
  // 1. stamp_logs — 스탬프 인증으로 획득한 스탬프 합계
  const stampRow = db.prepare(`
    SELECT COALESCE(SUM(earned_count), 0) AS total
    FROM   stamp_logs
    WHERE  user_id = ?
  `).get(userId);

  // 2. reviews — 리뷰 작성 보너스 스탬프 합계
  const reviewRow = db.prepare(`
    SELECT COALESCE(SUM(bonus_stamp_given), 0) AS total
    FROM   reviews
    WHERE  user_id = ?
  `).get(userId);

  // 3. wiki_posts — 관리자 승인(approved)된 위키 제보 보상 합계
  const wikiRow = db.prepare(`
    SELECT COALESCE(SUM(reward_stamps), 0) AS total
    FROM   wiki_posts
    WHERE  user_id = ?
    AND    status  = 'approved'
  `).get(userId);

  // 4. mission_completions × missions — 미션 완료 보너스 합계
  const missionRow = db.prepare(`
    SELECT COALESCE(SUM(m.bonus_stamps), 0) AS total
    FROM   mission_completions mc
    JOIN   missions m ON m.id = mc.mission_id
    WHERE  mc.user_id = ?
  `).get(userId);

  // 5. rewards — 스탬프 교환으로 소모된 합계 (발급·사용·만료 모두 차감)
  const rewardRow = db.prepare(`
    SELECT COALESCE(SUM(stamp_cost), 0) AS total
    FROM   rewards
    WHERE  user_id = ?
  `).get(userId);

  // 최종 잔액 계산 (마이너스 방지: 최소 0)
  const newTotal = Math.max(
    0,
    (stampRow.total   || 0) +
    (reviewRow.total  || 0) +
    (wikiRow.total    || 0) +
    (missionRow.total || 0) -
    (rewardRow.total  || 0)
  );

  // users 테이블 갱신
  db.prepare(`
    UPDATE users
    SET    total_stamps = ?
    WHERE  id = ?
  `).run(newTotal, userId);

  return newTotal;
}

// ──────────────────────────────────────────────
// 미션 자동 완료 체크
// ──────────────────────────────────────────────

/**
 * 스탬프 인증 직후 호출되어, 사용자가 완료 조건을 달성한 미션을
 * 자동으로 완료 처리하고 보너스 스탬프를 지급합니다.
 *
 * 처리 흐름:
 *   1. 활성화된 미션 전체 조회
 *   2. 각 미션의 required_spot_ids(JSON 파싱) 확인
 *   3. 사용자의 stamp_logs에서 해당 명소들을 모두 방문했는지 확인
 *   4. 조건 충족 + 아직 미완료인 경우 → mission_completions INSERT
 *   5. recalculateUserStamps() 호출로 잔액 반영
 *
 * @param {string} userId - 사용자 UUID
 * @param {import('better-sqlite3').Database} db - DB 인스턴스
 * @returns {{ id: string, name_ko: string, bonus_stamps: number }[]} 이번에 새로 완료된 미션 목록
 */
function checkAndCompleteMissions(userId, db) {
  // 활성 미션 전체 조회
  const missions = db.prepare(`
    SELECT id, name_ko, name_en, required_spot_ids, bonus_stamps, bonus_reward
    FROM   missions
    WHERE  is_active = 1
  `).all();

  // 사용자가 방문한 명소 ID 집합 (빠른 조회를 위해 Set 사용)
  const visitedRows = db.prepare(`
    SELECT DISTINCT spot_id
    FROM   stamp_logs
    WHERE  user_id = ?
  `).all(userId);

  const visitedSet = new Set(visitedRows.map(r => r.spot_id));

  // 이미 완료한 미션 ID 집합
  const completedRows = db.prepare(`
    SELECT mission_id
    FROM   mission_completions
    WHERE  user_id = ?
  `).all(userId);

  const completedSet = new Set(completedRows.map(r => r.mission_id));

  const newlyCompleted = [];

  for (const mission of missions) {
    // 이미 완료한 미션은 건너뜀
    if (completedSet.has(mission.id)) continue;

    // required_spot_ids JSON 파싱 (파싱 실패 시 빈 배열로 폴백)
    let requiredIds;
    try {
      requiredIds = JSON.parse(mission.required_spot_ids || '[]');
    } catch {
      console.warn(`[미션] required_spot_ids 파싱 실패 — mission.id: ${mission.id}`);
      requiredIds = [];
    }

    // 필수 명소가 없는 미션은 건너뜀 (데이터 오류 방지)
    if (!Array.isArray(requiredIds) || requiredIds.length === 0) continue;

    // 필수 명소를 모두 방문했는지 확인
    const allVisited = requiredIds.every(spotId => visitedSet.has(spotId));
    if (!allVisited) continue;

    // 미션 완료 기록 INSERT
    try {
      db.prepare(`
        INSERT INTO mission_completions (user_id, mission_id)
        VALUES (?, ?)
      `).run(userId, mission.id);

      newlyCompleted.push({
        id:           mission.id,
        name_ko:      mission.name_ko,
        name_en:      mission.name_en,
        bonus_stamps: mission.bonus_stamps,
        bonus_reward: mission.bonus_reward,
      });

      console.log(`[미션] 완료 — userId: ${userId}, mission: ${mission.name_ko}, 보너스: ${mission.bonus_stamps}스탬프`);
    } catch (err) {
      // UNIQUE 제약 위반(동시 요청으로 인한 중복) 시 무시
      if (!err.message.includes('UNIQUE')) {
        console.error(`[미션] INSERT 실패: ${err.message}`);
      }
    }
  }

  // 새로 완료된 미션이 있으면 잔액 재계산
  if (newlyCompleted.length > 0) {
    recalculateUserStamps(userId, db);
  }

  return newlyCompleted;
}

// ──────────────────────────────────────────────
// 스탬프 숫자 처리
// ──────────────────────────────────────────────

/**
 * 혼잡도 배율(1.5x 등) 적용으로 소수점이 생긴 스탬프 수를
 * 올림(ceil) 처리해 항상 정수로 반환합니다.
 *
 * 예: formatStampCount(1 * 1.5) → 2
 *     formatStampCount(2 * 1.5) → 3
 *     formatStampCount(3 * 2.0) → 6
 *
 * @param {number} count - 배율이 적용된 스탬프 수 (소수 가능)
 * @returns {number} 올림 처리된 정수 스탬프 수
 */
function formatStampCount(count) {
  return Math.ceil(count);
}

// ──────────────────────────────────────────────
// 다국어 필드 반환
// ──────────────────────────────────────────────

/**
 * 객체에서 언어 코드에 맞는 지역화 필드를 반환합니다.
 * 해당 언어 필드가 없거나 비어있으면 한국어(ko)로 폴백합니다.
 *
 * 사용 예:
 *   getLocalizedField(spot, 'en', 'name')    → spot.name_en (없으면 spot.name_ko)
 *   getLocalizedField(spot, 'ja', 'description') → spot.description_ja
 *
 * @param {Object} obj - 대상 객체 (spots 레코드 등)
 * @param {string} lang - 언어 코드 ('ko' | 'en' | 'ja' | 'zh')
 * @param {string} fieldPrefix - 필드 이름 접두사 (예: 'name', 'description')
 * @returns {string} 지역화된 필드 값
 */
function getLocalizedField(obj, lang, fieldPrefix) {
  // 지원 언어 목록 — 외 입력은 ko로 폴백
  const supportedLangs = ['ko', 'en', 'ja', 'zh'];
  const safeLang = supportedLangs.includes(lang) ? lang : 'ko';

  const localizedKey = `${fieldPrefix}_${safeLang}`;
  const fallbackKey  = `${fieldPrefix}_ko`;

  // 해당 언어 필드가 존재하고 비어있지 않으면 반환
  if (obj[localizedKey] !== undefined && obj[localizedKey] !== null && obj[localizedKey] !== '') {
    return obj[localizedKey];
  }

  // ko 폴백
  return obj[fallbackKey] || '';
}

// ──────────────────────────────────────────────
// 내보내기
// ──────────────────────────────────────────────

module.exports = {
  haversineDistance,
  getCongestion,
  recalculateUserStamps,
  checkAndCompleteMissions,
  formatStampCount,
  getLocalizedField,
  // 상수도 export — 라우트에서 참조 가능
  CONGESTION_WINDOW_MINUTES,
  CONGESTION_HIGH_THRESHOLD,
  CONGESTION_MID_THRESHOLD,
};
