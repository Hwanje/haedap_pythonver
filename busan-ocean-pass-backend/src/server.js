/**
 * server.js — 부산오션패스 API 서버 메인 엔트리포인트
 *
 * Express 앱을 초기화하고 모든 라우트를 연결합니다.
 *
 * 실행:
 *   npm start          - 서버 시작
 *   npm run dev        - nodemon으로 개발 모드 시작
 *
 * 환경변수 (.env):
 *   PORT       - 서버 포트 (기본 3000)
 *   JWT_SECRET - JWT 서명 비밀키 (필수)
 */

'use strict';

require('dotenv').config();

const path    = require('path');
const express = require('express');
const cors    = require('cors');

// ──────────────────────────────────────────────
// 라우트 모듈 로드
// ──────────────────────────────────────────────

const authRouter     = require('./routes/auth');
const spotsRouter    = require('./routes/spots');
const stampsRouter   = require('./routes/stamps');
const reviewsRouter  = require('./routes/reviews');
const wikiRouter     = require('./routes/wiki');
const rewardsRouter  = require('./routes/rewards');
const missionsRouter = require('./routes/missions');
const adminRouter    = require('./routes/admin');
const qrRouter       = require('./routes/qr');

// DB 모듈 로드 (better-sqlite3는 동기 초기화, sql.js는 비동기 초기화)
const db = require('./db/database');

// ──────────────────────────────────────────────
// Express 앱 초기화
// ──────────────────────────────────────────────

const app  = express();
// Replit은 PORT 환경변수를 문자열로 주입합니다. parseInt로 숫자 변환 후 유효성 검증.
const PORT = (parseInt(process.env.PORT, 10) || 3000);

// ──────────────────────────────────────────────
// 공통 미들웨어
// ──────────────────────────────────────────────

/** CORS — Replit 프리뷰 및 외부 도구에서 API 접근 허용 */
app.use(cors({
  origin: '*', // 프로토타입 단계 — 실서비스 시 허용 도메인 명시 필요
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

/** 정적 파일 서빙 — public/ 디렉터리의 HTML/CSS/JS를 직접 제공 */
app.use(express.static(path.join(__dirname, '../public')));

/** 요청 본문 파싱 */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ──────────────────────────────────────────────
// 요청 로그 미들웨어 (개발 환경 가시성)
// ──────────────────────────────────────────────

app.use((req, _res, next) => {
  // 타임스탬프와 함께 요청 로그 출력 (디버깅 및 프롬프트 엔지니어링 과정 기록용)
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${ts}] ${req.method} ${req.path}`);
  next();
});

// ──────────────────────────────────────────────
// 라우트 연결
// ──────────────────────────────────────────────

app.use('/api/auth',     authRouter);
app.use('/api/spots',    spotsRouter);
app.use('/api/stamps',   stampsRouter);
app.use('/api/reviews',  reviewsRouter);
app.use('/api/wiki',     wikiRouter);
app.use('/api/rewards',  rewardsRouter);
app.use('/api/missions', missionsRouter);
app.use('/api/admin',    adminRouter);
app.use('/api/qr',       qrRouter);

// ──────────────────────────────────────────────
// 헬스체크 및 루트 엔드포인트
// ──────────────────────────────────────────────

// GET / 는 express.static 이 index.html 을 자동으로 서빙하므로 별도 핸들러 불필요

/**
 * GET /api — 전체 엔드포인트 목록 (헬스체크 겸용)
 *
 * 외부 도구나 프론트엔드 개발 시 사용 가능한 API 목록을 반환합니다.
 * 심사 시연 시 API 구조를 한눈에 파악할 수 있도록 구성했습니다.
 */
app.get('/api', (_req, res) => {
  res.json({
    success: true,
    status:  'healthy',
    server:  '부산오션패스 API v1.0.0',
    endpoints: {
      auth: {
        'POST /api/auth/register': '회원가입',
        'POST /api/auth/login':    '로그인 (JWT 토큰 발급)',
        'GET  /api/auth/me':       '내 정보 조회 [🔐]',
      },
      spots: {
        'GET  /api/spots':                    '명소 목록 + 혼잡도 (?lang=ko|en|ja|zh)',
        'GET  /api/spots/nearby':             '주변 명소 (?lat=&lng=&radius=)',
        'GET  /api/spots/:id':                '명소 상세',
        'GET  /api/spots/:id/congestion':     '혼잡도 실시간 조회',
      },
      stamps: {
        'POST /api/stamps/verify':  '스탬프 인증 (QR + GPS) [🔐]',
        'GET  /api/stamps/my':      '내 스탬프 내역 [🔐]',
        'GET  /api/stamps/progress': '방문 진행률 [🔐]',
      },
      reviews: {
        'POST /api/reviews':             '리뷰 작성 [🔐]',
        'GET  /api/reviews/spot/:spotId': '명소별 리뷰 목록',
        'POST /api/reviews/:id/like':    '리뷰 좋아요 [🔐]',
        'GET  /api/reviews/my':          '내 리뷰 목록 [🔐]',
      },
      wiki: {
        'POST /api/wiki':           '위키 제보 작성 [🔐]',
        'GET  /api/wiki':           '승인된 위키 목록 (?category=&spot_id=&sort=)',
        'GET  /api/wiki/my':        '내 제보 목록 [🔐]',
        'GET  /api/wiki/:id':       '위키 상세 조회',
        'POST /api/wiki/:id/helpful': '도움됨 투표 [🔐]',
      },
      rewards: {
        'GET  /api/rewards/catalog': '리워드 카탈로그 [🔐]',
        'POST /api/rewards/redeem':  '스탬프 교환 [🔐]',
        'GET  /api/rewards/my':      '내 교환 내역 [🔐]',
      },
      missions: {
        'GET /api/missions':    '미션 목록 + 진행률',
        'GET /api/missions/my': '완료한 미션 목록 [🔐]',
      },
      admin: {
        'GET   /api/admin/wiki/pending': '심사 대기 위키 목록 [🛡️]',
        'PATCH /api/admin/wiki/:id':     '위키 승인/거절 [🛡️]',
        'GET   /api/admin/dashboard':    '통계 대시보드 [🛡️]',
        'GET   /api/admin/users':        '사용자 목록 [🛡️]',
      },
    },
    legend: {
      '🔐': 'JWT 인증 필요 (Authorization: Bearer <token>)',
      '🛡️': '관리자 전용 (role=admin)',
    },
  });
});

// ──────────────────────────────────────────────
// 404 핸들러
// ──────────────────────────────────────────────

/**
 * 등록되지 않은 라우트에 대한 404 응답
 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `요청한 경로를 찾을 수 없습니다: ${req.method} ${req.path} / Not Found.`,
    hint:    '사용 가능한 엔드포인트 목록: GET /api',
  });
});

// ──────────────────────────────────────────────
// 글로벌 에러 핸들러
// ──────────────────────────────────────────────

/**
 * 라우트 핸들러에서 next(err)로 전달된 오류를 일괄 처리합니다.
 * 운영 환경에서는 스택 트레이스를 숨깁니다.
 *
 * @param {Error} err
 */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error(`[서버 오류] ${req.method} ${req.path}:`, err);

  // JWT 오류 처리
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: '유효하지 않은 토큰입니다. / Invalid token.',
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: '만료된 토큰입니다. 다시 로그인해주세요. / Token expired.',
    });
  }

  // SQLite 제약 위반
  if (err.message && err.message.includes('UNIQUE constraint failed')) {
    return res.status(409).json({
      success: false,
      message: '중복된 데이터입니다. / Duplicate entry.',
    });
  }

  // 기타 서버 오류
  const isDev = process.env.NODE_ENV !== 'production';
  return res.status(500).json({
    success: false,
    message: '서버 내부 오류가 발생했습니다. / Internal server error.',
    // 개발 환경에서만 스택 트레이스 노출
    ...(isDev && { error: err.message, stack: err.stack }),
  });
});

// ──────────────────────────────────────────────
// 서버 시작 (DB 초기화 완료 후)
// ──────────────────────────────────────────────

/**
 * DB 초기화가 완료된 뒤 HTTP 서버를 시작합니다.
 * better-sqlite3 모드에서는 즉시 시작, sql.js 모드에서는 wasm 로드 후 시작합니다.
 */
let server;

db.ready.then(async () => {
  // 마스터 어드민 자동 생성/동기화
  const masterEmail    = (process.env.MASTER_ADMIN_EMAIL    || '').trim().toLowerCase();
  const masterPassword = (process.env.MASTER_ADMIN_PASSWORD || '').trim();
  if (masterEmail && masterPassword) {
    const bcrypt = require('bcryptjs');
    const { v4: uuidv4 } = require('uuid');
    const existing = db.prepare('SELECT id, role, password_hash FROM users WHERE email = ?').get(masterEmail);
    const hash = await bcrypt.hash(masterPassword, 10);
    if (!existing) {
      db.prepare(`
        INSERT INTO users (id, nickname, email, password_hash, language, role)
        VALUES (?, '마스터관리자', ?, ?, 'ko', 'admin')
      `).run(uuidv4(), masterEmail, hash);
      console.log(`[마스터 어드민] 신규 생성 — ${masterEmail}`);
    } else {
      // 비밀번호 동기화 및 role 강제 admin
      db.prepare('UPDATE users SET password_hash = ?, role = ? WHERE email = ?')
        .run(hash, 'admin', masterEmail);
      console.log(`[마스터 어드민] 동기화 완료 — ${masterEmail}`);
    }
  }

  server = app.listen(PORT, '0.0.0.0', () => {
    // REPL_SLUG, REPL_OWNER 는 Replit이 자동 주입하는 환경변수입니다.
    const replSlug  = process.env.REPL_SLUG;
    const replOwner = process.env.REPL_OWNER;
    const replUrl   = replSlug && replOwner
      ? `https://${replSlug}.${replOwner}.repl.co`
      : null;

    console.log('');
    console.log('========================================');
    console.log('  부산오션패스 API 서버 시작');
    console.log(`  포트: ${PORT}`);
    console.log(`  환경: ${process.env.NODE_ENV || 'development'}`);
    console.log(`  로컬 헬스체크: http://localhost:${PORT}/api`);
    if (replUrl) {
      console.log(`  Replit 외부 URL: ${replUrl}/api`);
    }
    console.log('========================================');
    console.log('');
  });
}).catch(err => {
  console.error('[서버] DB 초기화 실패 — 서버를 시작할 수 없습니다:', err.message);
  process.exit(1);
});

// ──────────────────────────────────────────────
// Graceful Shutdown — SIGINT / SIGTERM 처리
// ──────────────────────────────────────────────

/**
 * 서버 종료 시 DB 연결을 안전하게 닫습니다.
 * Ctrl+C(SIGINT) 또는 프로세스 관리자(SIGTERM) 신호에 모두 반응합니다.
 */
function gracefulShutdown(signal) {
  console.log(`\n[서버] ${signal} 수신 — 서버를 정상 종료합니다...`);

  server.close(() => {
    console.log('[서버] HTTP 서버 종료 완료.');

    try {
      // better-sqlite3 및 sql.js 래퍼 모두 close() 지원
      if (db && typeof db.close === 'function') {
        db.close();
        console.log('[서버] DB 연결 종료 완료.');
      }
    } catch (err) {
      console.warn('[서버] DB 종료 중 오류:', err.message);
    }

    console.log('[서버] 종료 완료.');
    process.exit(0);
  });

  // 10초 내 종료 안 되면 강제 종료
  setTimeout(() => {
    console.error('[서버] 강제 종료 (타임아웃)');
    process.exit(1);
  }, 10_000);
}

process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

module.exports = app; // 테스트 모듈에서 import 가능하도록 export
