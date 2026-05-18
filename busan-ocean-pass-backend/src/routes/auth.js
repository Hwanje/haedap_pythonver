/**
 * auth.js — 인증 라우트
 *
 * 사용자 회원가입, 로그인, 내 정보 조회 기능을 제공합니다.
 *
 * 엔드포인트 목록:
 *   POST /api/auth/register — 회원가입 (JWT 토큰 즉시 발급)
 *   POST /api/auth/login    — 로그인 (JWT 토큰 발급)
 *   GET  /api/auth/me       — 내 정보 조회 (인증 필요)
 *
 * 보안 사항:
 *   - 비밀번호는 bcryptjs saltRounds=10으로 해시 저장 (평문 저장 없음)
 *   - JWT payload에 password_hash 포함 금지
 *   - 이메일 중복 시 409 응답 (정보 노출 최소화)
 */

'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const db                    = require('../db/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// JWT 환경변수 — auth 미들웨어에서 이미 검증하므로 여기서는 직접 사용
const JWT_SECRET     = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// bcrypt salt 라운드 수 — 10이 보안/속도 균형의 표준값
const SALT_ROUNDS = 10;

// ──────────────────────────────────────────────
// POST /api/auth/register — 회원가입
// ──────────────────────────────────────────────

/**
 * 새 계정을 생성하고 JWT 토큰을 즉시 발급합니다.
 *
 * Request Body:
 *   nickname    {string}  필수. 표시 이름 (공백 불가)
 *   email       {string}  필수. 고유 이메일 주소
 *   password    {string}  필수. 최소 6자
 *   language    {string}  선택. 'ko'|'en'|'ja'|'zh' (기본 'ko')
 *   is_foreigner {number} 선택. 0|1 (기본 0)
 *
 * Response 201:
 *   { success: true, token, user: { id, nickname, email, language, is_foreigner, role, total_stamps, total_cashback, created_at } }
 *
 * Error:
 *   400 — 필수 필드 누락 또는 유효성 실패
 *   409 — 이메일 중복
 */
router.post('/register', async (req, res) => {
  try {
    const {
      nickname,
      email,
      password,
      language    = 'ko',
      is_foreigner = 0,
    } = req.body;

    // ── 1. 필수 필드 유효성 검사 ──────────────────────────────────────────
    if (!nickname || typeof nickname !== 'string' || nickname.trim() === '') {
      return res.status(400).json({
        success: false,
        error:   '닉네임은 필수입니다. (Nickname is required)',
      });
    }

    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        error:   '이메일은 필수입니다. (Email is required)',
      });
    }

    // 간단한 이메일 형식 검증 (@ 포함 여부)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({
        success: false,
        error:   '유효하지 않은 이메일 형식입니다. (Invalid email format)',
      });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({
        success: false,
        error:   '비밀번호는 최소 6자 이상이어야 합니다. (Password must be at least 6 characters)',
      });
    }

    // 지원 언어 검증
    const supportedLangs = ['ko', 'en', 'ja', 'zh'];
    const safeLang = supportedLangs.includes(language) ? language : 'ko';

    // is_foreigner 값 정규화 (0 또는 1)
    const safeIsForeigner = is_foreigner === 1 || is_foreigner === '1' || is_foreigner === true ? 1 : 0;

    // ── 2. 이메일 중복 확인 ───────────────────────────────────────────────
    const existing = db.prepare(`
      SELECT id FROM users WHERE email = ?
    `).get(email.trim().toLowerCase());

    if (existing) {
      return res.status(409).json({
        success: false,
        error:   '이미 사용 중인 이메일입니다. (Email already in use)',
      });
    }

    // ── 3. 비밀번호 해시 생성 (bcrypt) ───────────────────────────────────
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // ── 4. 사용자 UUID 생성 및 DB 저장 ───────────────────────────────────
    const userId = uuidv4();

    db.prepare(`
      INSERT INTO users (id, nickname, email, password_hash, language, is_foreigner)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      nickname.trim(),
      email.trim().toLowerCase(),
      passwordHash,
      safeLang,
      safeIsForeigner
    );

    // ── 5. 저장된 사용자 정보 조회 (password_hash 제외) ───────────────────
    const newUser = db.prepare(`
      SELECT id, nickname, email, language, role, is_foreigner,
             total_stamps, total_cashback, created_at
      FROM   users
      WHERE  id = ?
    `).get(userId);

    // ── 6. JWT 토큰 발급 ──────────────────────────────────────────────────
    const token = jwt.sign(
      {
        id:          newUser.id,
        email:       newUser.email,
        nickname:    newUser.nickname,
        role:        newUser.role,
        is_foreigner: newUser.is_foreigner,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    console.log(`[인증] 회원가입 성공 — userId: ${userId}, email: ${email.trim().toLowerCase()}`);

    return res.status(201).json({
      success: true,
      message: '회원가입이 완료되었습니다.',
      token,
      user: newUser,
    });

  } catch (err) {
    console.error('[인증] register 오류:', err.message);
    return res.status(500).json({
      success: false,
      error:   '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요. (Internal server error)',
    });
  }
});

// ──────────────────────────────────────────────
// POST /api/auth/login — 로그인
// ──────────────────────────────────────────────

/**
 * 이메일과 비밀번호를 검증하고 JWT 토큰을 발급합니다.
 *
 * Request Body:
 *   email    {string} 필수
 *   password {string} 필수
 *
 * Response 200:
 *   { success: true, token, user: { id, nickname, email, language, is_foreigner, role, total_stamps, total_cashback } }
 *
 * Error:
 *   400 — 필수 필드 누락
 *   401 — 이메일 또는 비밀번호 불일치
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // ── 1. 필수 필드 확인 ─────────────────────────────────────────────────
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error:   '이메일과 비밀번호를 모두 입력해 주세요. (Email and password are required)',
      });
    }

    // ── 2. 사용자 조회 ────────────────────────────────────────────────────
    const user = db.prepare(`
      SELECT id, nickname, email, password_hash, language, role,
             is_foreigner, total_stamps, total_cashback, created_at
      FROM   users
      WHERE  email = ?
    `).get(email.trim().toLowerCase());

    // 보안: 이메일 존재 여부를 직접 노출하지 않고 동일 메시지 반환
    if (!user) {
      return res.status(401).json({
        success: false,
        error:   '이메일 또는 비밀번호가 올바르지 않습니다. (Invalid email or password)',
      });
    }

    // ── 3. 비밀번호 검증 (bcrypt.compare) ────────────────────────────────
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error:   '이메일 또는 비밀번호가 올바르지 않습니다. (Invalid email or password)',
      });
    }

    // ── 4. JWT 토큰 발급 ──────────────────────────────────────────────────
    const token = jwt.sign(
      {
        id:           user.id,
        email:        user.email,
        nickname:     user.nickname,
        role:         user.role,
        is_foreigner: user.is_foreigner,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // password_hash는 응답에서 제외
    const { password_hash, ...safeUser } = user;

    console.log(`[인증] 로그인 성공 — userId: ${user.id}, email: ${user.email}`);

    return res.status(200).json({
      success: true,
      message: '로그인에 성공했습니다.',
      token,
      user: safeUser,
    });

  } catch (err) {
    console.error('[인증] login 오류:', err.message);
    return res.status(500).json({
      success: false,
      error:   '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요. (Internal server error)',
    });
  }
});

// ──────────────────────────────────────────────
// GET /api/auth/me — 내 정보 조회 (인증 필요)
// ──────────────────────────────────────────────

/**
 * 현재 로그인한 사용자의 최신 정보를 반환합니다.
 *
 * JWT 토큰 payload의 id로 DB를 재조회해 최신 스탬프 잔액을 반영합니다.
 *
 * Response 200:
 *   { success: true, user: { id, nickname, email, language, role,
 *                            is_foreigner, total_stamps, total_cashback, created_at } }
 *
 * Error:
 *   401 — 토큰 없음 또는 유효하지 않음
 *   404 — 사용자를 찾을 수 없음 (탈퇴 등)
 */
router.get('/me', authenticateToken, (req, res) => {
  try {
    // req.user.id는 JWT payload에서 추출된 사용자 UUID
    const user = db.prepare(`
      SELECT id, nickname, email, language, role,
             is_foreigner, total_stamps, total_cashback, created_at
      FROM   users
      WHERE  id = ?
    `).get(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error:   '사용자를 찾을 수 없습니다. (User not found)',
      });
    }

    return res.status(200).json({
      success: true,
      user,
    });

  } catch (err) {
    console.error('[인증] /me 오류:', err.message);
    return res.status(500).json({
      success: false,
      error:   '서버 오류가 발생했습니다. (Internal server error)',
    });
  }
});

module.exports = router;
