/**
 * auth.js — JWT 인증 미들웨어
 *
 * Express 라우트에서 사용하는 인증/인가 미들웨어 모음입니다.
 *
 * 미들웨어 목록:
 *   authenticateToken : Bearer 토큰 필수 검증 (보호된 엔드포인트)
 *   optionalAuth      : 토큰이 있으면 검증, 없어도 통과 (공개+선택 엔드포인트)
 *   requireAdmin      : 관리자 전용 엔드포인트 (authenticateToken + role 확인)
 */

'use strict';

const jwt = require('jsonwebtoken');
require('dotenv').config();

// JWT 서명 키 — 환경변수 미설정 시 서버 시작을 차단합니다.
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  // 시작 시 즉시 오류 출력 (배포 환경에서 실수 방지)
  console.error('[인증] 오류: JWT_SECRET 환경변수가 설정되지 않았습니다.');
  console.error('[인증] .env 파일을 확인하거나 .env.example을 참고해 주세요.');
  process.exit(1);
}

// ──────────────────────────────────────────────
// 헬퍼: Authorization 헤더에서 토큰 추출
// ──────────────────────────────────────────────

/**
 * 요청 헤더의 Authorization 값에서 Bearer 토큰을 추출합니다.
 *
 * @param {import('express').Request} req
 * @returns {string|null} JWT 문자열 또는 null
 */
function extractToken(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;

  // 형식: "Bearer <token>"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;

  return parts[1] || null;
}

// ──────────────────────────────────────────────
// authenticateToken — 필수 인증 미들웨어
// ──────────────────────────────────────────────

/**
 * Authorization 헤더의 Bearer JWT를 검증합니다.
 *
 * 성공 시: req.user에 JWT payload({ id, email, role, nickname })를 저장하고 next()를 호출합니다.
 * 실패 시:
 *   - 토큰 없음            → 401 { error: '인증 토큰이 필요합니다.' }
 *   - 만료된 토큰          → 401 { error: '토큰이 만료되었습니다.' }
 *   - 위조/유효하지 않은 토큰 → 401 { error: '유효하지 않은 토큰입니다.' }
 *
 * 사용처: 스탬프 인증, 리뷰 작성, 리워드 교환 등 로그인 필수 엔드포인트
 *
 * @type {import('express').RequestHandler}
 */
function authenticateToken(req, res, next) {
  const token = extractToken(req);

  // 토큰이 없는 경우
  if (!token) {
    return res.status(401).json({
      success: false,
      error:   '인증 토큰이 필요합니다. (Authentication token required)',
    });
  }

  // 토큰 검증
  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) {
      // 만료 vs 위조/기타 오류 구분
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          error:   '토큰이 만료되었습니다. 다시 로그인해 주세요. (Token expired)',
        });
      }

      return res.status(401).json({
        success: false,
        error:   '유효하지 않은 토큰입니다. (Invalid token)',
      });
    }

    // payload를 req.user에 저장 (이후 라우트 핸들러에서 사용)
    req.user = payload;
    next();
  });
}

// ──────────────────────────────────────────────
// optionalAuth — 선택적 인증 미들웨어
// ──────────────────────────────────────────────

/**
 * 토큰이 있으면 검증해 req.user에 저장하지만,
 * 없거나 만료·위조된 경우에도 오류 없이 next()를 호출합니다.
 *
 * 성공 시: req.user = JWT payload
 * 토큰 없음/오류 시: req.user = null (라우트에서 null 체크 필요)
 *
 * 사용처: 미션 목록 조회(진행률 표시), 명소 목록(좋아요 여부 표시) 등
 *         — 비로그인 사용자도 기본 정보는 볼 수 있는 엔드포인트
 *
 * @type {import('express').RequestHandler}
 */
function optionalAuth(req, res, next) {
  const token = extractToken(req);

  // 토큰이 없으면 req.user를 null로 설정하고 통과
  if (!token) {
    req.user = null;
    return next();
  }

  // 토큰이 있으면 검증 시도
  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) {
      // 토큰 오류가 있어도 차단하지 않고 null 처리
      req.user = null;
    } else {
      req.user = payload;
    }
    next();
  });
}

// ──────────────────────────────────────────────
// requireAdmin — 관리자 전용 미들웨어
// ──────────────────────────────────────────────

/**
 * 관리자(role === 'admin')만 접근할 수 있는 엔드포인트를 보호합니다.
 *
 * 내부적으로 authenticateToken을 먼저 실행한 뒤 role을 확인합니다.
 * 로그인이 안 된 경우 → 401, 로그인은 됐지만 권한 없는 경우 → 403
 *
 * 성공 시: next() 호출
 * 실패 시:
 *   - 토큰 없음/유효하지 않음 → 401 (authenticateToken과 동일 처리)
 *   - role !== 'admin'        → 403 { error: '관리자 권한이 필요합니다.' }
 *
 * 사용처: /api/admin/* 전체 라우트
 *
 * @type {import('express').RequestHandler}
 */
function requireAdmin(req, res, next) {
  // 1단계: JWT 검증 (authenticateToken 재사용)
  authenticateToken(req, res, () => {
    // authenticateToken이 next()를 호출한 경우 — 토큰은 유효함
    // 2단계: 관리자 role 확인
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error:   '관리자 권한이 필요합니다. (Admin access required)',
      });
    }

    next();
  });
}

// ──────────────────────────────────────────────
// 내보내기
// ──────────────────────────────────────────────

module.exports = {
  authenticateToken,
  optionalAuth,
  requireAdmin,
};
