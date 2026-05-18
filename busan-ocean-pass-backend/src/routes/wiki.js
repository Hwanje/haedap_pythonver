/**
 * wiki.js — 위키 제보 라우트
 *
 * 사용자가 해양 명소 관련 정보(이벤트, 숨은 명소, 안전 정보 등)를
 * 직접 제보하고 조회할 수 있는 커뮤니티 기능입니다.
 *
 * 관리자 승인 흐름:
 *   제보(pending) → 관리자 검토 → 승인(approved) 또는 거절(rejected)
 *   승인 시 reward_stamps만큼 작성자에게 스탬프 지급
 *
 * 엔드포인트:
 *   POST   /api/wiki/            - 위키 제보 작성 (🔐)
 *   GET    /api/wiki/            - 승인된 위키 목록 조회
 *   GET    /api/wiki/my          - 내 제보 목록 (🔐)
 *   GET    /api/wiki/:id         - 위키 상세 조회
 *   POST   /api/wiki/:id/helpful - 도움됨 투표 (🔐)
 */

'use strict';

const express    = require('express');
const { v4: uuidv4 } = require('uuid');
const router     = express.Router();

const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { recalculateUserStamps }           = require('../utils/helpers');
const db                                  = require('../db/database');

// ──────────────────────────────────────────────
// 상수
// ──────────────────────────────────────────────

/** 지원하는 카테고리 목록 */
const VALID_CATEGORIES = ['event', 'hidden_spot', 'safety', 'tip', 'food'];

/**
 * 카테고리별 기본 보상 스탬프 수 (관리자가 별도 지정하지 않으면 이 값 사용)
 * 실제 지급은 관리자 승인 시 이루어짐
 */
const DEFAULT_REWARD_STAMPS = {
  event:       10,
  hidden_spot: 15,
  safety:      20,
  tip:          5,
  food:         8,
};

/** helpful_count 100 달성 시 작성자에게 지급하는 보너스 스탬프 */
const HELPFUL_MILESTONE_STAMPS = 10;
const HELPFUL_MILESTONE_COUNT  = 100;

// ──────────────────────────────────────────────
// POST /api/wiki/ — 위키 제보 작성 (인증 필수)
// ──────────────────────────────────────────────

/**
 * 사용자가 해양 관련 정보를 제보합니다.
 *
 * 검증 규칙:
 *   - content 20자 이상 필수
 *   - category는 VALID_CATEGORIES 중 하나
 *   - category='event'인 경우 event_start_date, event_end_date 필수
 *   - 24시간 내 동일 title + category 중복 제보 차단 (스팸 방지)
 *
 * 처리 후 상태: status='pending' (관리자 승인 대기)
 */
router.post('/', authenticateToken, (req, res) => {
  const {
    title,
    content,
    category,
    spot_id,
    photo_url,
    event_start_date,
    event_end_date,
  } = req.body;

  // 필수 필드 검증
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: '제목을 입력해주세요. / Title is required.',
    });
  }

  if (!content || typeof content !== 'string' || content.trim().length < 20) {
    return res.status(400).json({
      success: false,
      message: '내용은 20자 이상 입력해주세요. / Content must be at least 20 characters.',
    });
  }

  if (!category || !VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({
      success: false,
      message: `카테고리가 올바르지 않습니다. 허용 값: ${VALID_CATEGORIES.join(', ')} / Invalid category.`,
    });
  }

  // 이벤트 카테고리 필수 필드 검증
  if (category === 'event') {
    if (!event_start_date || !event_end_date) {
      return res.status(400).json({
        success: false,
        message: '이벤트 카테고리는 시작일과 종료일이 필수입니다. / Event start and end dates are required.',
      });
    }
  }

  // 24시간 내 동일 title + category 중복 제보 차단
  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .substring(0, 19);

  const duplicate = db.prepare(`
    SELECT id
    FROM   wiki_posts
    WHERE  user_id    = ?
    AND    title      = ?
    AND    category   = ?
    AND    created_at >= ?
  `).get(req.user.id, title.trim(), category, windowStart);

  if (duplicate) {
    return res.status(409).json({
      success: false,
      message: '24시간 내에 동일한 제목과 카테고리로 이미 제보하셨습니다. / Duplicate submission within 24 hours.',
    });
  }

  // spot_id 유효성 검증 (전달된 경우에만)
  if (spot_id) {
    const spot = db.prepare('SELECT id FROM spots WHERE id = ?').get(spot_id);
    if (!spot) {
      return res.status(400).json({
        success: false,
        message: '존재하지 않는 명소 ID입니다. / Invalid spot ID.',
      });
    }
  }

  // 위키 제보 INSERT
  const id = uuidv4();
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  db.prepare(`
    INSERT INTO wiki_posts (
      id, user_id, title, content, category,
      spot_id, photo_url, event_start_date, event_end_date,
      status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    id,
    req.user.id,
    title.trim(),
    content.trim(),
    category,
    spot_id || null,
    photo_url || null,
    event_start_date || null,
    event_end_date   || null,
    now
  );

  // 카테고리별 예상 보상 스탬프 안내
  const expectedReward = DEFAULT_REWARD_STAMPS[category];

  return res.status(201).json({
    success:        true,
    message:        '제보가 접수되었습니다. 관리자 검토 후 승인됩니다. / Submission received. It will be reviewed by an admin.',
    id,
    status:         'pending',
    expected_reward_stamps: expectedReward,
    reward_notice:  `승인 시 최대 ${expectedReward}개의 스탬프가 지급됩니다. (관리자 재량에 따라 조정 가능)`,
  });
});

// ──────────────────────────────────────────────
// GET /api/wiki/ — 승인된 위키 목록 조회 (공개)
// ──────────────────────────────────────────────

/**
 * 관리자가 승인한 위키 제보 목록을 반환합니다.
 *
 * 쿼리 파라미터:
 *   category  - 카테고리 필터 (옵션)
 *   spot_id   - 명소 ID 필터 (옵션)
 *   sort      - 정렬 기준: 'helpful'(도움됨 순) | 'recent'(최신순, 기본값)
 *
 * 자동 제외: event 카테고리 중 event_end_date가 오늘 이전인 것
 */
router.get('/', (req, res) => {
  const { category, spot_id, sort } = req.query;

  // 오늘 날짜 (YYYY-MM-DD)
  const today = new Date().toISOString().substring(0, 10);

  // 정렬 기준 결정
  const orderBy = sort === 'helpful' ? 'wp.helpful_count DESC' : 'wp.created_at DESC';

  // 동적 WHERE 조건 구성
  const conditions = [
    "wp.status = 'approved'",
    // 이벤트 카테고리 종료일 자동 제외
    `(wp.category != 'event' OR wp.event_end_date IS NULL OR wp.event_end_date >= '${today}')`,
  ];
  const params = [];

  if (category) {
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        message: `잘못된 카테고리입니다. 허용 값: ${VALID_CATEGORIES.join(', ')}`,
      });
    }
    conditions.push('wp.category = ?');
    params.push(category);
  }

  if (spot_id) {
    conditions.push('wp.spot_id = ?');
    params.push(spot_id);
  }

  const whereClause = conditions.join(' AND ');

  const posts = db.prepare(`
    SELECT
      wp.id,
      wp.title,
      wp.category,
      wp.spot_id,
      wp.photo_url,
      wp.event_start_date,
      wp.event_end_date,
      wp.helpful_count,
      wp.view_count,
      wp.reward_stamps,
      wp.created_at,
      u.nickname   AS author_nickname,
      s.name_ko    AS spot_name_ko,
      s.name_en    AS spot_name_en
    FROM   wiki_posts wp
    JOIN   users u ON u.id = wp.user_id
    LEFT JOIN spots s ON s.id = wp.spot_id
    WHERE  ${whereClause}
    ORDER  BY ${orderBy}
    LIMIT  100
  `).all(...params);

  return res.json({
    success: true,
    count:   posts.length,
    data:    posts,
  });
});

// ──────────────────────────────────────────────
// GET /api/wiki/my — 내 제보 목록 (인증 필수)
// ※ /:id 라우트보다 먼저 등록해야 Express가 'my'를 ID로 오해하지 않음
// ──────────────────────────────────────────────

/**
 * 로그인한 사용자의 제보 목록을 모든 상태(pending/approved/rejected)로 반환합니다.
 */
router.get('/my', authenticateToken, (req, res) => {
  const posts = db.prepare(`
    SELECT
      wp.id,
      wp.title,
      wp.category,
      wp.spot_id,
      wp.photo_url,
      wp.event_start_date,
      wp.event_end_date,
      wp.status,
      wp.admin_note,
      wp.reward_stamps,
      wp.helpful_count,
      wp.view_count,
      wp.created_at,
      wp.reviewed_at,
      s.name_ko AS spot_name_ko
    FROM   wiki_posts wp
    LEFT JOIN spots s ON s.id = wp.spot_id
    WHERE  wp.user_id = ?
    ORDER  BY wp.created_at DESC
  `).all(req.user.id);

  return res.json({
    success: true,
    count:   posts.length,
    data:    posts,
  });
});

// ──────────────────────────────────────────────
// GET /api/wiki/:id — 위키 상세 조회
// ──────────────────────────────────────────────

/**
 * 위키 게시글 상세 내용을 반환하고 view_count를 1 증가시킵니다.
 *
 * 접근 권한:
 *   - status='approved' 게시글은 누구나 조회 가능
 *   - 자신이 작성한 게시글은 status 무관 조회 가능 (검토 결과 확인용)
 */
router.get('/:id', optionalAuth, (req, res) => {
  const { id } = req.params;

  const post = db.prepare(`
    SELECT
      wp.*,
      u.nickname   AS author_nickname,
      s.name_ko    AS spot_name_ko,
      s.name_en    AS spot_name_en,
      s.latitude   AS spot_latitude,
      s.longitude  AS spot_longitude
    FROM   wiki_posts wp
    JOIN   users u ON u.id = wp.user_id
    LEFT JOIN spots s ON s.id = wp.spot_id
    WHERE  wp.id = ?
  `).get(id);

  if (!post) {
    return res.status(404).json({
      success: false,
      message: '위키 게시글을 찾을 수 없습니다. / Wiki post not found.',
    });
  }

  // 접근 권한 확인: 승인된 글이거나 본인의 글이어야 함
  const isOwner = req.user && req.user.id === post.user_id;
  if (post.status !== 'approved' && !isOwner) {
    return res.status(403).json({
      success: false,
      message: '접근 권한이 없습니다. / Access denied.',
    });
  }

  // view_count 증가 (비동기 부작용 — 실패해도 응답에 영향 없음)
  try {
    db.prepare('UPDATE wiki_posts SET view_count = view_count + 1 WHERE id = ?').run(id);
    post.view_count = (post.view_count || 0) + 1;
  } catch (err) {
    console.warn(`[위키] view_count 업데이트 실패: ${err.message}`);
  }

  return res.json({
    success: true,
    data:    post,
  });
});

// ──────────────────────────────────────────────
// POST /api/wiki/:id/helpful — 도움됨 투표 (인증 필수)
// ──────────────────────────────────────────────

/**
 * 위키 게시글에 '도움됨' 투표를 합니다.
 *
 * 규칙:
 *   - 자신의 게시글에는 투표 불가 (자전거 조작 방지)
 *   - 한 게시글당 1회만 투표 가능 (UNIQUE 제약으로 보장)
 *   - helpful_count가 HELPFUL_MILESTONE_COUNT(100)에 도달 시
 *     게시글 작성자에게 HELPFUL_MILESTONE_STAMPS(10) 보너스 스탬프 지급
 */
router.post('/:id/helpful', authenticateToken, (req, res) => {
  const { id } = req.params;

  // 게시글 존재 및 승인 상태 확인
  const post = db.prepare(`
    SELECT id, user_id, helpful_count, status
    FROM   wiki_posts
    WHERE  id = ?
  `).get(id);

  if (!post) {
    return res.status(404).json({
      success: false,
      message: '위키 게시글을 찾을 수 없습니다. / Wiki post not found.',
    });
  }

  if (post.status !== 'approved') {
    return res.status(400).json({
      success: false,
      message: '승인된 게시글에만 투표할 수 있습니다. / Voting is only allowed on approved posts.',
    });
  }

  // 자신의 게시글 투표 차단
  if (post.user_id === req.user.id) {
    return res.status(400).json({
      success: false,
      message: '자신의 게시글에는 도움됨을 누를 수 없습니다. / You cannot vote on your own post.',
    });
  }

  // 중복 투표 확인
  const existingVote = db.prepare(`
    SELECT id FROM wiki_helpful_votes
    WHERE  user_id     = ?
    AND    wiki_post_id = ?
  `).get(req.user.id, id);

  if (existingVote) {
    return res.status(409).json({
      success: false,
      message: '이미 도움됨을 눌렀습니다. / You have already voted on this post.',
    });
  }

  // 투표 처리 (트랜잭션으로 일관성 보장)
  let milestoneReached = false;
  let newCount;

  const doVote = db.transaction(() => {
    // wiki_helpful_votes INSERT
    try {
      db.prepare(`
        INSERT INTO wiki_helpful_votes (user_id, wiki_post_id)
        VALUES (?, ?)
      `).run(req.user.id, id);
    } catch (err) {
      if (err.message.includes('UNIQUE')) {
        // 동시 요청 레이스 컨디션 — 이미 투표됨으로 처리
        throw { code: 'DUPLICATE' };
      }
      throw err;
    }

    // helpful_count 증가
    db.prepare('UPDATE wiki_posts SET helpful_count = helpful_count + 1 WHERE id = ?').run(id);

    // 업데이트된 count 조회
    const updated = db.prepare('SELECT helpful_count FROM wiki_posts WHERE id = ?').get(id);
    newCount = updated.helpful_count;

    // 마일스톤(100) 달성 확인
    if (newCount === HELPFUL_MILESTONE_COUNT) {
      milestoneReached = true;

      // 작성자에게 보너스 스탬프 지급 (stamp_logs에 특별 기록)
      db.prepare(`
        INSERT INTO stamp_logs (user_id, spot_id, earned_count, multiplier, verification_method, verified_at)
        VALUES (?, NULL, ?, 1.0, 'wiki_milestone', ?)
      `).run(
        post.user_id,
        HELPFUL_MILESTONE_STAMPS,
        new Date().toISOString().replace('T', ' ').substring(0, 19)
      );

      // 작성자 잔액 재계산
      recalculateUserStamps(post.user_id, db);
    }
  });

  try {
    doVote();
  } catch (err) {
    if (err && err.code === 'DUPLICATE') {
      return res.status(409).json({
        success: false,
        message: '이미 도움됨을 눌렀습니다. / You have already voted on this post.',
      });
    }
    console.error(`[위키] 도움됨 투표 오류: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다. / Internal server error.',
    });
  }

  return res.json({
    success:          true,
    message:          '도움됨이 반영되었습니다. / Your vote has been recorded.',
    helpful_count:    newCount,
    milestone_bonus:  milestoneReached
      ? `축하합니다! 작성자에게 ${HELPFUL_MILESTONE_STAMPS}개 보너스 스탬프가 지급되었습니다.`
      : null,
  });
});

module.exports = router;
