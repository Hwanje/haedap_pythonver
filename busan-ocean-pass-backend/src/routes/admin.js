/**
 * admin.js — 관리자 전용 라우트 (requireAdmin 전체 적용)
 *
 * 위키 제보 심사, 대시보드 통계, 사용자 목록 관리 기능을 제공합니다.
 *
 * 모든 엔드포인트는 requireAdmin 미들웨어로 보호됩니다:
 *   - JWT 인증 필수
 *   - users.role = 'admin' 확인
 *
 * 엔드포인트:
 *   GET   /api/admin/wiki/pending - 심사 대기 위키 목록
 *   PATCH /api/admin/wiki/:id     - 위키 승인 또는 거절
 *   GET   /api/admin/dashboard    - 통계 대시보드
 *   GET   /api/admin/users        - 사용자 목록
 */

'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();

const { requireAdmin }          = require('../middleware/auth');
const { recalculateUserStamps } = require('../utils/helpers');
const db                        = require('../db/database');

const MASTER_ADMIN_EMAIL = (process.env.MASTER_ADMIN_EMAIL || '').toLowerCase();

/** 마스터 어드민 여부 확인 */
function isMasterAdmin(req) {
  return MASTER_ADMIN_EMAIL && req.user.email.toLowerCase() === MASTER_ADMIN_EMAIL;
}

// ──────────────────────────────────────────────
// 전체 라우트에 관리자 인증 적용
// ──────────────────────────────────────────────

router.use(requireAdmin);

// ──────────────────────────────────────────────
// 카테고리별 기본 보상 스탬프 (wiki.js와 동일한 값 유지)
// ──────────────────────────────────────────────

/** 관리자가 별도로 reward_stamps를 지정하지 않은 경우 사용되는 기본값 */
const DEFAULT_REWARD_STAMPS = {
  event:       10,
  hidden_spot: 15,
  safety:      20,
  tip:          5,
  food:         8,
};

// ──────────────────────────────────────────────
// GET /api/admin/wiki/pending — 심사 대기 위키 목록
// ──────────────────────────────────────────────

/**
 * 관리자 승인을 기다리는 위키 제보 목록을 반환합니다.
 *
 * 오래된 것 먼저(created_at ASC) 정렬하여 FIFO 심사를 유도합니다.
 */
router.get('/wiki/pending', (req, res) => {
  const posts = db.prepare(`
    SELECT
      wp.id,
      wp.title,
      wp.content,
      wp.category,
      wp.spot_id,
      wp.photo_url,
      wp.event_start_date,
      wp.event_end_date,
      wp.status,
      wp.created_at,
      u.id       AS user_id,
      u.nickname AS author_nickname,
      u.email    AS author_email,
      s.name_ko  AS spot_name_ko
    FROM   wiki_posts wp
    JOIN   users u ON u.id = wp.user_id
    LEFT JOIN spots s ON s.id = wp.spot_id
    WHERE  wp.status = 'pending'
    ORDER  BY wp.created_at ASC
  `).all();

  return res.json({
    success: true,
    count:   posts.length,
    data:    posts,
  });
});

// ──────────────────────────────────────────────
// PATCH /api/admin/wiki/:id — 위키 승인 또는 거절
// ──────────────────────────────────────────────

/**
 * 특정 위키 제보를 승인하거나 거절합니다.
 *
 * Body:
 *   action       : 'approve' | 'reject' (필수)
 *   admin_note   : 관리자 코멘트 (옵션, 거절 시 사유 작성 권장)
 *   reward_stamps: 승인 시 지급할 스탬프 수 (옵션, 미지정 시 카테고리 기본값 사용)
 *
 * 승인 처리:
 *   - status='approved', reviewed_by, reviewed_at 업데이트
 *   - reward_stamps 저장 (작성자 스탬프 잔액에 반영)
 *   - recalculateUserStamps(post.user_id) 호출
 *
 * 거절 처리:
 *   - status='rejected', admin_note 저장
 */
router.patch('/wiki/:id', (req, res) => {
  const { id } = req.params;
  const { action, admin_note, reward_stamps } = req.body;

  // 필수 파라미터 검증
  if (!action || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({
      success: false,
      message: "action은 'approve' 또는 'reject'이어야 합니다. / action must be 'approve' or 'reject'.",
    });
  }

  // 게시글 존재 확인
  const post = db.prepare(`
    SELECT id, user_id, category, status, title
    FROM   wiki_posts
    WHERE  id = ?
  `).get(id);

  if (!post) {
    return res.status(404).json({
      success: false,
      message: '위키 게시글을 찾을 수 없습니다. / Wiki post not found.',
    });
  }

  // 이미 처리된 게시글 중복 처리 방지
  if (post.status !== 'pending') {
    return res.status(409).json({
      success: false,
      message: `이미 처리된 게시글입니다. 현재 상태: ${post.status} / Post already reviewed.`,
      current_status: post.status,
    });
  }

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  if (action === 'approve') {
    // 지급할 스탬프 수 결정: 관리자 지정값 > 카테고리 기본값 > 0
    let finalRewardStamps = 0;
    if (reward_stamps !== undefined && reward_stamps !== null) {
      finalRewardStamps = parseInt(reward_stamps, 10) || 0;
    } else {
      finalRewardStamps = DEFAULT_REWARD_STAMPS[post.category] || 0;
    }

    // 스탬프 수 범위 검증 (0 이상, 비상식적 값 차단)
    if (finalRewardStamps < 0 || finalRewardStamps > 1000) {
      return res.status(400).json({
        success: false,
        message: 'reward_stamps는 0 이상 1000 이하여야 합니다.',
      });
    }

    // 승인 처리
    db.prepare(`
      UPDATE wiki_posts
      SET    status      = 'approved',
             admin_note  = ?,
             reviewed_by = ?,
             reviewed_at = ?,
             reward_stamps = ?
      WHERE  id = ?
    `).run(
      admin_note || null,
      req.user.id,
      now,
      finalRewardStamps,
      id
    );

    // 작성자 스탬프 잔액 재계산 (위키 보상 반영)
    const newStamps = recalculateUserStamps(post.user_id, db);

    // 작성자 정보 조회 (응답용)
    const author = db.prepare('SELECT nickname FROM users WHERE id = ?').get(post.user_id);

    return res.json({
      success:           true,
      message:           `'${post.title}' 게시글이 승인되었습니다. / Post approved.`,
      action:            'approved',
      reward_stamps:     finalRewardStamps,
      author_nickname:   author ? author.nickname : null,
      author_new_stamps: newStamps,
    });
  }

  // 거절 처리
  db.prepare(`
    UPDATE wiki_posts
    SET    status      = 'rejected',
           admin_note  = ?,
           reviewed_by = ?,
           reviewed_at = ?
    WHERE  id = ?
  `).run(
    admin_note || null,
    req.user.id,
    now,
    id
  );

  return res.json({
    success: true,
    message: `'${post.title}' 게시글이 거절되었습니다. / Post rejected.`,
    action:  'rejected',
    admin_note: admin_note || null,
  });
});

// ──────────────────────────────────────────────
// GET /api/admin/dashboard — 통계 대시보드
// ──────────────────────────────────────────────

/**
 * 서비스 운영 현황 통계를 반환합니다.
 *
 * 포함 데이터:
 *   - 주요 지표: 총 사용자/명소/스탬프/리뷰/위키 수
 *   - 오늘 통계: 신규 가입자, 스탬프 인증
 *   - 인기 명소 TOP 10 (stamp_logs 기준)
 *   - 시간대별 스탬프 분포 (최근 7일, 0~23시)
 */
router.get('/dashboard', (req, res) => {
  const today = new Date().toISOString().substring(0, 10); // YYYY-MM-DD
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .substring(0, 19);

  // ── 주요 지표 ──
  const totalUsers  = db.prepare('SELECT COUNT(*) AS cnt FROM users').get().cnt;
  const totalSpots  = db.prepare('SELECT COUNT(*) AS cnt FROM spots WHERE is_active = 1').get().cnt;
  const totalStamps = db.prepare('SELECT COUNT(*) AS cnt FROM stamp_logs').get().cnt;
  const totalReviews = db.prepare('SELECT COUNT(*) AS cnt FROM reviews').get().cnt;
  const totalWiki   = db.prepare("SELECT COUNT(*) AS cnt FROM wiki_posts WHERE status = 'approved'").get().cnt;
  const pendingWiki = db.prepare("SELECT COUNT(*) AS cnt FROM wiki_posts WHERE status = 'pending'").get().cnt;

  // ── 오늘 통계 ──
  const todayUsers  = db.prepare(
    "SELECT COUNT(*) AS cnt FROM users WHERE created_at >= ?"
  ).get(`${today} 00:00:00`).cnt;

  const todayStamps = db.prepare(
    "SELECT COUNT(*) AS cnt FROM stamp_logs WHERE verified_at >= ?"
  ).get(`${today} 00:00:00`).cnt;

  // ── 인기 명소 TOP 10 ──
  const popularSpots = db.prepare(`
    SELECT
      sl.spot_id,
      s.name_ko,
      s.name_en,
      s.category,
      COUNT(*) AS stamp_count
    FROM   stamp_logs sl
    JOIN   spots s ON s.id = sl.spot_id
    GROUP  BY sl.spot_id
    ORDER  BY stamp_count DESC
    LIMIT  10
  `).all();

  // ── 시간대별 스탬프 분포 (최근 7일, 0~23시) ──
  // SQLite에서 verified_at은 'YYYY-MM-DD HH:MM:SS' 형식으로 저장
  // SUBSTR로 시간 추출
  const hourlyRows = db.prepare(`
    SELECT
      CAST(SUBSTR(verified_at, 12, 2) AS INTEGER) AS hour,
      COUNT(*) AS cnt
    FROM   stamp_logs
    WHERE  verified_at >= ?
    GROUP  BY hour
    ORDER  BY hour ASC
  `).all(sevenDaysAgo);

  // 0~23시 빈 배열 초기화 후 데이터 매핑
  const hourlyDistribution = Array.from({ length: 24 }, (_, h) => ({
    hour:  h,
    count: 0,
  }));

  for (const row of hourlyRows) {
    const h = row.hour;
    if (h >= 0 && h <= 23) {
      hourlyDistribution[h].count = row.cnt;
    }
  }

  return res.json({
    success: true,
    data: {
      summary: {
        total_users:    totalUsers,
        total_spots:    totalSpots,
        total_stamps:   totalStamps,
        total_reviews:  totalReviews,
        total_wiki:     totalWiki,
        pending_wiki:   pendingWiki,
      },
      today: {
        new_users:   todayUsers,
        new_stamps:  todayStamps,
        date:        today,
      },
      popular_spots:        popularSpots,
      hourly_distribution:  hourlyDistribution,
      period_note:          '시간대별 분포는 최근 7일 기준입니다.',
    },
  });
});

// ──────────────────────────────────────────────
// GET /api/admin/users — 사용자 목록
// ──────────────────────────────────────────────

/**
 * 전체 사용자 목록을 반환합니다. (최대 100명, password_hash 제외)
 *
 * 보안: password_hash는 절대로 응답에 포함하지 않습니다.
 */
router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT
      id, nickname, email, language, role,
      total_stamps, total_cashback, is_foreigner,
      is_tester, created_at
    FROM   users
    ORDER  BY created_at DESC
    LIMIT  200
  `).all();

  return res.json({
    success:        true,
    count:          users.length,
    data:           users,
    is_master_admin: isMasterAdmin(req),
  });
});

// ──────────────────────────────────────────────
// PATCH /api/admin/users/:id/reset-password — 비밀번호 재설정 (모든 어드민)
// ──────────────────────────────────────────────
router.patch('/users/:id/reset-password', async (req, res) => {
  const { id } = req.params;
  const { new_password } = req.body;

  if (!new_password || typeof new_password !== 'string' || new_password.length < 6) {
    return res.status(400).json({ success: false, message: '새 비밀번호는 6자 이상이어야 합니다.' });
  }

  const user = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });

  // 마스터 어드민 계정은 일반 어드민이 변경 불가
  if (user.email.toLowerCase() === MASTER_ADMIN_EMAIL && !isMasterAdmin(req)) {
    return res.status(403).json({ success: false, message: '마스터 어드민 비밀번호는 변경할 수 없습니다.' });
  }

  const hash = await bcrypt.hash(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);

  return res.json({ success: true, message: `${user.email} 비밀번호가 재설정되었습니다.` });
});

// ──────────────────────────────────────────────
// PATCH /api/admin/users/:id/tester — 테스터 지정/해제 (마스터 어드민 전용)
// ──────────────────────────────────────────────
router.patch('/users/:id/tester', (req, res) => {
  if (!isMasterAdmin(req)) {
    return res.status(403).json({ success: false, message: '마스터 어드민만 테스터를 지정할 수 있습니다.' });
  }

  const { id } = req.params;
  const { is_tester } = req.body;
  const value = is_tester ? 1 : 0;

  const user = db.prepare('SELECT id, email, nickname, role FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
  if (user.role === 'admin') {
    return res.status(400).json({ success: false, message: '어드민 계정에는 테스터 설정이 적용되지 않습니다.' });
  }

  db.prepare('UPDATE users SET is_tester = ? WHERE id = ?').run(value, id);

  return res.json({
    success:  true,
    message:  `${user.nickname}(${user.email}) 계정을 ${value ? '테스터로 지정' : '테스터 해제'}했습니다.`,
    is_tester: value,
  });
});

// ──────────────────────────────────────────────
// POST /api/admin/users/tester-by-email — 이메일로 테스터 지정 (마스터 어드민 전용)
// ──────────────────────────────────────────────
router.post('/users/tester-by-email', (req, res) => {
  if (!isMasterAdmin(req)) {
    return res.status(403).json({ success: false, message: '마스터 어드민만 테스터를 지정할 수 있습니다.' });
  }

  const { email, is_tester } = req.body;
  if (!email) return res.status(400).json({ success: false, message: '이메일이 필요합니다.' });

  const user = db.prepare('SELECT id, email, nickname, role FROM users WHERE email = ?')
    .get(email.trim().toLowerCase());
  if (!user) return res.status(404).json({ success: false, message: '해당 이메일 계정을 찾을 수 없습니다.' });
  if (user.role === 'admin') {
    return res.status(400).json({ success: false, message: '어드민 계정에는 테스터 설정이 적용되지 않습니다.' });
  }

  const value = is_tester ? 1 : 0;
  db.prepare('UPDATE users SET is_tester = ? WHERE id = ?').run(value, user.id);

  return res.json({
    success:   true,
    message:   `${user.nickname}(${user.email}) 계정을 ${value ? '테스터로 지정' : '테스터 해제'}했습니다.`,
    user_id:   user.id,
    is_tester: value,
  });
});

module.exports = router;
