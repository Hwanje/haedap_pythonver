'use strict';

/**
 * qr.js — QR 토큰 발급 및 스캔 라우트
 *
 * 흐름:
 *   1. 사용자가 명소 상세에서 POST /api/qr/generate 호출
 *      → qr_tokens 레코드 생성 (유효 5분), 토큰 ID 반환
 *   2. 프론트엔드가 토큰 값으로 QR 이미지 렌더링 (qrcode.js 사용)
 *   3. 관리자가 admin 페이지 카메라로 QR 스캔
 *   4. POST /api/qr/scan 호출 → 토큰 검증 → stamp_logs INSERT → 스탬프 적립
 *
 * 엔드포인트:
 *   POST /api/qr/generate   — 사용자: 명소 QR 토큰 발급 (🔐)
 *   POST /api/qr/scan        — 관리자: QR 토큰 스캔 및 스탬프 지급 (🔐 admin)
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');

const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { getCongestion, recalculateUserStamps, checkAndCompleteMissions } = require('../utils/helpers');

const router = express.Router();

const TOKEN_TTL_MINUTES = 5;

// ──────────────────────────────────────────────
// POST /api/qr/generate — QR 토큰 발급 (사용자)
// ──────────────────────────────────────────────
router.post('/generate', authenticateToken, (req, res) => {
  const { spot_id } = req.body;

  if (!spot_id) {
    return res.status(400).json({ success: false, message: 'spot_id가 필요합니다.' });
  }

  const spot = db.prepare('SELECT id, name_ko, is_active, category FROM spots WHERE id = ?').get(spot_id);
  if (!spot) {
    return res.status(404).json({ success: false, message: '존재하지 않는 명소입니다.' });
  }
  if (!spot.is_active) {
    return res.status(400).json({ success: false, message: '현재 비활성화된 명소입니다.' });
  }

  // 해당 사용자 + 명소의 미사용·미만료 토큰이 이미 있으면 재사용
  const now = new Date();
  const nowStr = now.toISOString().replace('T', ' ').substring(0, 19);
  const existing = db.prepare(`
    SELECT id, expires_at FROM qr_tokens
    WHERE user_id = ? AND spot_id = ? AND used_at IS NULL AND expires_at > ?
  `).get(req.user.id, spot_id, nowStr);

  if (existing) {
    return res.json({
      success: true,
      token: existing.id,
      expires_at: existing.expires_at,
      spot_name: spot.name_ko,
      ttl_seconds: Math.round((new Date(existing.expires_at) - now) / 1000),
    });
  }

  const tokenId  = uuidv4();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MINUTES * 60 * 1000)
    .toISOString().replace('T', ' ').substring(0, 19);

  db.prepare(`
    INSERT INTO qr_tokens (id, user_id, spot_id, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(tokenId, req.user.id, spot_id, expiresAt);

  return res.status(201).json({
    success: true,
    token: tokenId,
    expires_at: expiresAt,
    spot_name: spot.name_ko,
    ttl_seconds: TOKEN_TTL_MINUTES * 60,
  });
});

// ──────────────────────────────────────────────
// POST /api/qr/scan — QR 스캔 및 스탬프 지급 (관리자)
// ──────────────────────────────────────────────
router.post('/scan', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: '관리자만 스캔할 수 있습니다.' });
  }

  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, message: 'token이 필요합니다.' });
  }

  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const qr = db.prepare(`
    SELECT qt.*, s.name_ko AS spot_name, s.base_stamp_count, s.is_active, s.category,
           u.nickname AS user_nickname, u.total_stamps AS user_total_stamps
    FROM   qr_tokens qt
    JOIN   spots s ON s.id = qt.spot_id
    JOIN   users u ON u.id = qt.user_id
    WHERE  qt.id = ?
  `).get(token);

  if (!qr) {
    return res.status(404).json({ success: false, message: '유효하지 않은 QR 코드입니다.' });
  }
  if (qr.used_at) {
    return res.status(409).json({ success: false, message: '이미 사용된 QR 코드입니다.' });
  }
  if (qr.expires_at < nowStr) {
    return res.status(410).json({ success: false, message: 'QR 코드가 만료되었습니다. 사용자에게 재발급을 요청하세요.' });
  }
  if (!qr.is_active) {
    return res.status(400).json({ success: false, message: '비활성화된 명소입니다.' });
  }

  // 24시간 내 동일 명소 중복 인증 차단
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').substring(0, 19);

  const recentLog = db.prepare(`
    SELECT id FROM stamp_logs
    WHERE user_id = ? AND spot_id = ? AND verified_at >= ?
  `).get(qr.user_id, qr.spot_id, oneDayAgo);

  if (recentLog) {
    return res.status(409).json({ success: false, message: '해당 사용자가 24시간 이내 이미 인증한 명소입니다.' });
  }

  // 혼잡도 계산
  const congestion  = getCongestion(qr.spot_id, db);
  const multiplier  = congestion.multiplier;
  const earnedCount = Math.ceil(qr.base_stamp_count * multiplier);

  const doScan = db.transaction(() => {
    // 토큰 사용 처리
    db.prepare(`UPDATE qr_tokens SET used_at = ?, scanned_by = ? WHERE id = ?`)
      .run(nowStr, req.user.id, token);

    // stamp_log 기록
    db.prepare(`
      INSERT INTO stamp_logs
        (user_id, spot_id, earned_count, multiplier, verification_method, verified_at)
      VALUES (?, ?, ?, ?, 'qr_admin', ?)
    `).run(qr.user_id, qr.spot_id, earnedCount, multiplier, nowStr);

    // 사용자 스탬프 재계산
    recalculateUserStamps(qr.user_id, db);
  });

  doScan();

  const completedMissions = checkAndCompleteMissions(qr.user_id, db);

  const updatedUser = db.prepare('SELECT total_stamps FROM users WHERE id = ?').get(qr.user_id);

  return res.json({
    success: true,
    user_nickname:      qr.user_nickname,
    spot_name:          qr.spot_name,
    spot_category:      qr.category,
    earned_count:       earnedCount,
    multiplier,
    congestion:         { level: congestion.level, label: congestion.label, emoji: congestion.emoji },
    new_total_stamps:   updatedUser.total_stamps,
    completed_missions: completedMissions,
  });
});

module.exports = router;
