---
name: phase-progress
description: 각 Phase 완료 상태 및 생성된 파일 목록 추적
metadata:
  type: project
---

## Phase 1 — 완료 (2026-05-15)

생성 파일:
- `package.json` — better-sqlite3 optionalDependencies, sql.js 일반 의존성
- `.env.example` — PORT, JWT_SECRET, 혼잡도/GPS 파라미터 분리
- `.replit` — nodejs-20, stable-24_05 nix, 포트 3000→80 매핑
- `.gitignore` — .env, data/*.sqlite, node_modules 제외
- `src/db/database.js` — 10개 테이블 + 인덱스, WAL/FK ON, better-sqlite3→sql.js fallback

**주요 설계 결정:**
- better-sqlite3를 optionalDependencies에 넣어 Replit native 빌드 실패 시 npm install이 중단되지 않도록 함
- sql.js 래퍼를 better-sqlite3 호환 API(prepare/run/get/all/transaction)로 설계해 나머지 코드가 드라이버를 신경 쓰지 않아도 됨
- CREATE TABLE IF NOT EXISTS로 멱등성 보장 — 서버 재시작 시 에러 없음
- review_likes, wiki_helpful_votes 테이블 추가 (명세에는 없었으나 중복 방지 UNIQUE 제약 구현에 필요)

## Phase 2 — 완료 (2026-05-15)

생성 파일:
- `src/utils/helpers.js` — haversineDistance, getCongestion, recalculateUserStamps, checkAndCompleteMissions, formatStampCount, getLocalizedField
- `src/middleware/auth.js` — authenticateToken, optionalAuth, requireAdmin

**주요 설계 결정:**
- getCongestion은 ISO 타임스탬프를 직접 비교 (SQLite datetime 함수 의존 최소화 — sql.js fallback 호환성)
- recalculateUserStamps에서 rewards는 status 무관 전체 stamp_cost 합산 (발급 시점에 차감이 원칙, 만료해도 스탬프 반환 없음)
- checkAndCompleteMissions에서 UNIQUE 제약 위반 에러는 조용히 무시 (동시 요청 레이스 컨디션 방어)
- requireAdmin은 authenticateToken을 내부 호출해 코드 중복 없이 2단계 인가 구현
- optionalAuth는 토큰 오류 시 req.user = null 설정 — 라우트에서 null 체크로 비로그인/로그인 분기
## Phase 3 — 완료 (2026-05-15)

생성 파일:
- `src/routes/auth.js` — register(POST), login(POST), me(GET)
- `src/routes/spots.js` — 목록(GET /), nearby(GET /nearby), 상세(GET /:id), 혼잡도(GET /:id/congestion)

**주요 설계 결정:**
- auth.js에서 bcrypt.hash/compare는 async/await로 처리 — DB 쿼리(동기)와 자연스럽게 혼용
- 이메일은 trim().toLowerCase() 정규화 후 저장 및 조회 — 대소문자 혼재 중복 방지
- 로그인 실패 시 이메일 존재/비밀번호 오류를 동일 메시지로 반환 — 사용자 열거 공격 방어
- spots.js에서 /nearby는 /:id보다 먼저 등록 — Express 라우트 매칭 순서 문제 방지
- formatSpot 헬퍼 함수로 현지화+혼잡도 조합 로직 중앙화 — 4개 엔드포인트 재사용
- GET /:id 상세 조회에서 이벤트 위키 만료일 필터(event_end_date >= today)를 SQL에서 처리
- GET /:id/congestion은 명소 존재 확인만 하고 is_active 무관 — 관리 목적 폴링 허용
## Phase 4 — 완료 (2026-05-15)

생성 파일:
- `src/routes/stamps.js` — verify(POST), my(GET), progress(GET)
- `src/routes/reviews.js` — 작성(POST), 명소별(GET), 좋아요(POST), my(GET)

**주요 설계 결정:**
- stamps.js에서 router.use(authenticateToken) 전역 적용 — 3개 엔드포인트 모두 인증 필수이므로 중복 미들웨어 선언 제거
- reviews.js에서 /my와 /spot/:spotId 라우트 순서 주의: /my를 먼저 등록해 Express가 'my'를 spotId로 오해하지 않도록 처리
- GET /api/reviews/spot/:spotId는 optionalAuth 사용 — 비로그인 접근 허용 + 로그인 시 is_liked 필드 추가
- 좋아요 10개 달성 보너스는 reviews.bonus_stamp_given 값을 증가시키는 방식으로 구현 — recalculateUserStamps가 reviews.bonus_stamp_given 합계를 읽으므로 별도 필드 없이 자동 반영
- UNIQUE 제약 충돌(좋아요 중복) catch 블록에서도 409 반환 — 동시 요청 레이스 컨디션 방어
- 24시간 재인증 차단 시 ISO 타임스탬프를 'YYYY-MM-DD HH:MM:SS' 형식으로 변환해 SQLite 문자열 비교와 호환
## Phase 5 — 완료 (2026-05-15)

생성 파일:
- `src/routes/wiki.js` — POST, GET(목록), GET /my, GET /:id, POST /:id/helpful
- `src/routes/rewards.js` — catalog, redeem, my (전체 authenticateToken)
- `src/routes/missions.js` — 목록(optionalAuth + 진행률), /my

**주요 설계 결정:**
- wiki.js에서 helpful_count 100 달성 시 stamp_logs에 verification_method='wiki_milestone'로 보너스 기록 — recalculateUserStamps가 자동 합산
- rewards.js에서 REWARD_CATALOG를 코드 내 상수로 정의 + Map으로 O(1) 조회
- 외국인 사용자는 redeem 시 reward_type을 foreigner_alt로 자동 전환
- missions.js GET /my보다 먼저 GET /를 등록 (/:id 형태 없으므로 순서 무관하나 명시적 처리)

## Phase 6 — 완료 (2026-05-15)

생성 파일:
- `src/routes/admin.js` — wiki/pending, wiki/:id(PATCH), dashboard, users (requireAdmin 전체)
- `src/server.js` — 전체 라우트 연결, 404/에러 핸들러, graceful shutdown

**주요 설계 결정:**
- admin.js dashboard: 인기 명소 TOP 10 + 시간대별 분포(SUBSTR으로 시간 추출, sql.js 호환)
- server.js: db.ready Promise 해소 후 listen() 호출 — sql.js 비동기 초기화 대응
- 글로벌 에러 핸들러에서 JWT 오류 / UNIQUE 제약 위반 개별 처리

## Phase 7 — 완료 (2026-05-15)

생성 파일:
- `src/seeds/seed.js` — 계정 3개, 명소 30곳, 미션 4종, 위키 2건 (멱등)
- `README.md` — 빠른 시작, API 표, curl 예제 8개, 트러블슈팅

**주요 설계 결정:**
- seed.js에서 await db.ready 후 시드 실행 — sql.js fallback 대응
- 명소 order_in_route로 미션 spot_orders → UUID 변환 매핑
- 시드 완료 후 sql.js 모드에서 db.saveToFile() 명시 호출

## 프론트엔드 추가 — 완료 (2026-05-15)

생성 파일:
- `public/index.html` — 사용자 SPA: 로그인, 명소 목록(혼잡도 배지), 진행률, 리워드 카탈로그, 미션
- `public/admin.html` — 관리자 SPA: 대시보드 통계, 위키 심사(승인/거절), 사용자 목록

**주요 설계 결정:**
- express.static(path.join(__dirname, '../public')) 를 라우트 등록 전에 배치 — index.html 자동 서빙
- GET / JSON 핸들러 제거 — express.static이 index.html로 대체
- inline CSS + vanilla JS — 빌드 없이 바로 서빙, Replit 환경 적합
- localStorage에 JWT 토큰 저장 (op_token/admin_token 분리)
- 탭별 첫 활성화 시에만 API 호출 (tabLoaded 플래그) — 불필요한 중복 요청 방지

## Replit 설정 정비 — 완료 (2026-05-18)

수정/생성 파일:
- `.replit` — 최상위 `run = "npm install --prefer-offline && npm start"` 추가, `[env]` PORT=3000 추가, API 헬스체크 워크플로우 추가
- `replit.nix` — 신규 생성: nodejs_20, node-gyp, python3, gcc, curl, jq (better-sqlite3 native 빌드 도구 포함)
- `src/server.js` — PORT parseInt 주석 명확화, 시작 로그에 REPL_SLUG/REPL_OWNER로 Replit 외부 URL 자동 출력
- `package.json` — `"setup": "npm install && npm run seed && npm start"` 스크립트 추가

**주요 확인 사항:**
- better-sqlite3 없어도 sql.js fallback으로 정상 기동 확인
- `server.js`의 `app.listen(PORT, '0.0.0.0', ...)` — 0.0.0.0 바인딩으로 Replit 프록시 접근 가능
- API 헬스체크 `GET /api` 응답 확인: status: healthy, 8개 엔드포인트 그룹 모두 반환

## Phase 8 — 완료 (2026-05-15)

**발견 및 수정된 버그:**
1. sql.js 동기 초기화 방식 타임아웃 — database.js를 sharedDb 단일 객체 + async loadSqlJs() + ready Promise로 재설계
2. spots 테이블 category CHECK 제약 불일치 (harbor/island_lighthouse → port/island/culture/trail/food/hidden)
3. stamp_logs.id가 AUTOINCREMENT인데 UUID를 INSERT하려 했던 문제 — id 컬럼 생략으로 수정
4. 라우트들이 { db } 구조분해로 import하면 Proxy가 아닌 undefined → 직접 대입으로 통일

**테스트 결과 (5개 모두 통과):**
- POST /api/auth/login → success: true, JWT 토큰 발급
- GET /api/spots?lang=ko → 30개 명소 반환
- POST /api/stamps/verify (QR_SPOT_01, 해운대 좌표) → earned_count:2, multiplier:2 (여유 상태), new_total_stamps:17
- POST /api/wiki → pending 상태로 접수, expected_reward_stamps:15
- PATCH /api/admin/wiki/:id (approve) → 승인 완료, author_new_stamps:32
