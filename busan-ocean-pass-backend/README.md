# 부산오션패스 백엔드 API

> 부산광역시교육청 주최 「사제동행 2026 프롬프트 엔지니어링 학생경진대회」 출품작
> 테마: 해양수도 부산
> 한 줄 정의: "부산 해안선을 따라 도장을 찍고, 동백전으로 돌려받는 해양수도 여행 동반자"

---

## 빠른 시작

### Replit에서 실행

1. Replit에서 이 저장소를 fork 또는 import합니다.
2. Secrets 탭에서 환경변수를 설정합니다:
   - `JWT_SECRET` = `busan-ocean-pass-secret-2026`
3. Shell에서 의존성 설치:
   ```
   npm install
   ```
4. 초기 데이터 시드:
   ```
   npm run seed
   ```
5. Run 버튼을 클릭하거나 Shell에서:
   ```
   npm start
   ```

### 로컬에서 실행

```bash
# 저장소 클론
git clone <repo-url>
cd busan-ocean-pass-backend

# 의존성 설치
npm install

# 환경변수 설정
cp .env.example .env
# .env 파일에서 JWT_SECRET 등 필요한 값 설정

# 초기 데이터 시드
npm run seed

# 서버 시작
npm start

# 개발 모드 (파일 변경 시 자동 재시작)
npm run dev
```

서버가 시작되면 `http://localhost:3000/api`에서 전체 엔드포인트 목록을 확인할 수 있습니다.

---

## 테스트 계정

| 역할 | 이메일 | 비밀번호 | 특이사항 |
|------|--------|----------|----------|
| 관리자 | admin@busan-ocean.kr | admin1234 | role=admin, 위키 심사 가능 |
| 일반 사용자 | test@example.com | test1234 | 한국어 사용자 |
| 외국인 사용자 | john@example.com | test1234 | is_foreigner=1, 동백전 대신 QR쿠폰 |

---

## 전체 API 엔드포인트

### 인증 (`/api/auth`)

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| POST | /api/auth/register | 회원가입 | 불필요 |
| POST | /api/auth/login | 로그인 (JWT 발급) | 불필요 |
| GET | /api/auth/me | 내 정보 조회 | 필요 |

### 명소 (`/api/spots`)

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | /api/spots | 명소 목록 + 혼잡도 (`?lang=ko\|en\|ja\|zh`) | 불필요 |
| GET | /api/spots/nearby | 주변 명소 (`?lat=&lng=&radius=`) | 불필요 |
| GET | /api/spots/:id | 명소 상세 | 불필요 |
| GET | /api/spots/:id/congestion | 실시간 혼잡도 | 불필요 |

### 스탬프 (`/api/stamps`)

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| POST | /api/stamps/verify | QR + GPS 스탬프 인증 | 필요 |
| GET | /api/stamps/my | 내 스탬프 내역 | 필요 |
| GET | /api/stamps/progress | 전체 명소 방문 진행률 | 필요 |

### 리뷰 (`/api/reviews`)

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| POST | /api/reviews | 리뷰 작성 | 필요 |
| GET | /api/reviews/spot/:spotId | 명소별 리뷰 목록 | 불필요 |
| POST | /api/reviews/:id/like | 리뷰 좋아요 | 필요 |
| GET | /api/reviews/my | 내 리뷰 목록 | 필요 |

### 위키 (`/api/wiki`)

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| POST | /api/wiki | 위키 제보 작성 | 필요 |
| GET | /api/wiki | 승인된 위키 목록 (`?category=&spot_id=&sort=helpful\|recent`) | 불필요 |
| GET | /api/wiki/my | 내 제보 목록 (전체 상태) | 필요 |
| GET | /api/wiki/:id | 위키 상세 조회 | 불필요 |
| POST | /api/wiki/:id/helpful | 도움됨 투표 | 필요 |

### 리워드 (`/api/rewards`)

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | /api/rewards/catalog | 리워드 카탈로그 | 필요 |
| POST | /api/rewards/redeem | 스탬프로 리워드 교환 | 필요 |
| GET | /api/rewards/my | 내 교환 내역 | 필요 |

### 미션 (`/api/missions`)

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | /api/missions | 미션 목록 + 진행률 | 불필요 (로그인 시 진행률 포함) |
| GET | /api/missions/my | 완료한 미션 목록 | 필요 |

### 관리자 (`/api/admin`) — 관리자 전용

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | /api/admin/wiki/pending | 심사 대기 위키 목록 | 관리자 |
| PATCH | /api/admin/wiki/:id | 위키 승인 또는 거절 | 관리자 |
| GET | /api/admin/dashboard | 통계 대시보드 | 관리자 |
| GET | /api/admin/users | 사용자 목록 | 관리자 |

---

## curl 테스트 예제

아래 예제는 서버가 `http://localhost:3000`에서 실행 중일 때 사용할 수 있습니다.

### 1. 로그인

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test1234"}'
```

응답에서 `token` 값을 복사해두세요. 이후 요청에서 `TOKEN` 자리에 붙여넣으세요.

### 2. 명소 목록 조회 (한국어)

```bash
curl http://localhost:3000/api/spots?lang=ko
```

### 3. 스탬프 인증 (해운대해수욕장, GPS 검증 포함)

```bash
# 먼저 QR 코드 확인: 해운대 = QR_SPOT_01
curl -X POST http://localhost:3000/api/stamps/verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "qr_code": "QR_SPOT_01",
    "user_lat": 35.1587,
    "user_lng": 129.1604
  }'
```

### 4. 위키 제보 작성

```bash
curl -X POST http://localhost:3000/api/wiki \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "title": "광안리 야경 최고 포인트",
    "content": "광안리 해수욕장 동쪽 끝 방파제에서 바라보는 광안대교 야경이 정말 아름답습니다. 삼각대 가져오시면 멋진 사진 찍으실 수 있어요!",
    "category": "hidden_spot"
  }'
```

### 5. 관리자 로그인 후 위키 승인

```bash
# 관리자 로그인
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@busan-ocean.kr","password":"admin1234"}' | \
  grep -o '"token":"[^"]*"' | cut -d'"' -f4)

# 대기 중인 위키 목록 확인
curl http://localhost:3000/api/admin/wiki/pending \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 위키 승인 (WIKI_ID를 실제 ID로 교체)
curl -X PATCH http://localhost:3000/api/admin/wiki/WIKI_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"action":"approve","reward_stamps":15,"admin_note":"훌륭한 정보입니다!"}'
```

### 6. 리워드 카탈로그 조회 및 교환

```bash
# 카탈로그 조회 (외국인 모드 확인 포함)
curl http://localhost:3000/api/rewards/catalog \
  -H "Authorization: Bearer TOKEN"

# 동백전 3,000원 교환 (10스탬프 필요)
curl -X POST http://localhost:3000/api/rewards/redeem \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"reward_type":"dongbaekjeon_3000"}'
```

### 7. 미션 목록 + 진행률 조회

```bash
curl http://localhost:3000/api/missions \
  -H "Authorization: Bearer TOKEN"
```

### 8. 대시보드 통계

```bash
curl http://localhost:3000/api/admin/dashboard \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## 핵심 비즈니스 로직

### 혼잡도 계산

| 최근 60분 방문 수 | 등급 | 스탬프 배율 |
|-----------------|------|------------|
| 20건 이상 | 혼잡 (빨강) | 1.0x |
| 8건 이상 | 보통 (노랑) | 1.5x |
| 8건 미만 | 여유 (초록) | 2.0x |

혼잡도가 낮을수록 더 많은 스탬프를 지급하여 방문객 분산을 유도합니다.

### GPS 인증

- 명소 좌표와 사용자 좌표의 거리를 Haversine 공식으로 계산합니다.
- 반경 200m 초과 시 인증 거부 (403)
- 같은 명소 24시간 내 재인증 차단

### 스탬프 잔액 계산

```
잔액 = 스탬프 인증 합계
      + 리뷰 보너스 합계
      + 승인된 위키 보상 합계
      + 미션 완료 보너스 합계
      - 리워드 교환 소모 합계
```

### 외국인 사용자 처리

`is_foreigner=1` 사용자는 동백전/상품권 교환 시 자동으로 가맹점 QR 쿠폰으로 전환됩니다.

---

## 트러블슈팅

### better-sqlite3 빌드 실패 (Replit 환경)

Replit의 네이티브 빌드 환경에서 better-sqlite3 컴파일이 실패하는 경우,
**sql.js로 자동 전환**됩니다. 별도 설정 없이 동일하게 동작합니다.

확인 방법:
```
[DB] better-sqlite3 로드 실패, sql.js로 전환: ...
[DB] sql.js를 사용합니다.
```
위 로그가 출력되면 sql.js로 정상 동작 중입니다.

### 포트 충돌

```bash
# 사용 중인 포트 확인
lsof -i :3000

# .env에서 포트 변경
PORT=3001
```

### 데이터베이스 초기화

```bash
# SQLite 파일 삭제 후 다시 시드
rm data/busan-ocean-pass.sqlite
npm run seed
```

### JWT_SECRET 미설정

서버 시작 시 다음과 같은 경고가 나타나면 `.env` 파일의 `JWT_SECRET`을 설정하세요:

```
[경고] JWT_SECRET 환경변수가 설정되지 않았습니다.
```

---

## 기술 스택

| 항목 | 기술 |
|------|------|
| Runtime | Node.js 20 |
| Framework | Express 4 |
| DB | SQLite (better-sqlite3 / sql.js fallback) |
| 인증 | JWT (jsonwebtoken + bcryptjs) |
| 환경 | Replit (브라우저 기반) |

---

## 데이터베이스 스키마 (10개 테이블)

- `users` — 사용자 계정 및 스탬프 잔액
- `spots` — 부산 해양 명소 30곳 (GPS 좌표, 다국어 정보)
- `stamp_logs` — 스탬프 인증 기록 (GPS 검증 결과 포함)
- `reviews` — 명소 리뷰 (사진, 별점, 다국어)
- `rewards` — 스탬프 교환 내역
- `wiki_posts` — 사용자 위키 제보 (승인 흐름)
- `missions` — 테마 미션 정의
- `mission_completions` — 미션 완료 기록
- `review_likes` — 리뷰 좋아요 (중복 방지)
- `wiki_helpful_votes` — 위키 도움됨 투표 (중복 방지)

---

*2026 프롬프트 엔지니어링 학생경진대회 — 해양수도 부산*
