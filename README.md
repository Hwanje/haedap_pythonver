# haedap
# 부산오션패스 (Busan Ocean Pass)


---

### 주요 기능

| 기능 | 설명 |
|------|------|
| QR + GPS 스탬프 인증 | 명소 현장에서 QR 코드 스캔 + 200m 이내 위치 검증 |
| 실시간 혼잡도 | 최근 방문 수 기반 여유/보통/혼잡 등급 자동 산출, 혼잡도가 낮을수록 스탬프 2배 지급 |
| 인터랙티브 지도 | OpenStreetMap 기반 부산 지도에 30개 명소를 카테고리별 아이콘으로 표시 |
| 위키 제보 시스템 | 사용자가 명소 정보를 제보하면 관리자가 심사 후 승인, 보상 스탬프 지급 |
| 리워드 교환 | 스탬프 → 동백전 / 부산 굿즈 / QR 쿠폰(외국인 전용) 교환 |
| 테마 미션 | 해안선 완주, 야경 투어 등 미션 완료 시 보너스 스탬프 |
| 다국어 지원 | 명소 정보 한/영/일/중 4개 언어 제공 (`?lang=ko\|en\|ja\|zh`) |
| 관리자 대시보드 | 위키 심사, 사용자 통계, 실시간 현황 |

---

## 빠른 시작

### 로컬 실행

```bash
git clone https://github.com/Hwanje/haedap
cd haedap/busan-ocean-pass-backend

npm install
cp .env.example .env   # JWT_SECRET 등 설정

npm run seed           # 초기 데이터 30개 명소 + 테스트 계정 삽입
npm start              # http://localhost:3000
```

개발 모드 (파일 변경 시 자동 재시작):

```bash
npm run dev
```

### Replit에서 실행

1. Secrets 탭에서 `JWT_SECRET` 설정
2. Shell에서 `npm install && npm run seed`
3. Run 버튼 클릭

서버 기동 후 `http://localhost:3000` 에서 웹 UI, `http://localhost:3000/api` 에서 전체 엔드포인트 목록을 확인할 수 있습니다.

---

## 테스트 계정

| 역할 | 이메일 | 비밀번호 | 비고 |
|------|--------|----------|------|
| 관리자 | admin@busan-ocean.kr | admin1234 | 위키 심사·통계 접근 가능 |
| 일반 사용자 | test@example.com | test1234 | 한국어 사용자 |
| 외국인 사용자 | john@example.com | test1234 | 동백전 대신 QR 쿠폰 자동 전환 |

---

## 웹 UI

로그인 후 4개 탭으로 구성된 대시보드에서 모든 기능을 사용할 수 있습니다.

| 탭 | 설명 |
|----|------|
| 명소 목록 | 30개 명소 카드 + 실시간 혼잡도 배지 + 상세 모달 |
| 🗺 지도 | OpenStreetMap 위에 명소별 카테고리 마커 표시, 마커 클릭 시 팝업 및 상세보기 |
| 내 진행률 | 방문한 명소 수 / 완료율 / 명소별 방문 현황 |
| 리워드 카탈로그 | 스탬프 교환 가능 리워드 목록 및 즉시 교환 |
| 미션 | 테마별 미션 진행률 및 보너스 스탬프 현황 |

관리자 페이지(`/admin.html`)에서 위키 심사 및 통계 대시보드를 확인할 수 있습니다.

---

## API 엔드포인트

### 인증 (`/api/auth`)

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| POST | /api/auth/register | 회원가입 | 불필요 |
| POST | /api/auth/login | 로그인 (JWT 발급) | 불필요 |
| GET | /api/auth/me | 내 정보 조회 | 필요 |

### 명소 (`/api/spots`)

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | /api/spots | 전체 명소 목록 + 혼잡도 | 불필요 |
| GET | /api/spots/nearby | 주변 명소 (`?lat=&lng=&radius=`) | 불필요 |
| GET | /api/spots/:id | 명소 상세 (리뷰·위키·통계 포함) | 불필요 |
| GET | /api/spots/:id/congestion | 실시간 혼잡도 폴링 | 불필요 |

### 스탬프 (`/api/stamps`)

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| POST | /api/stamps/verify | QR + GPS 스탬프 인증 | 필요 |
| GET | /api/stamps/my | 내 스탬프 내역 | 필요 |
| GET | /api/stamps/progress | 명소별 방문 진행률 | 필요 |

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
| POST | /api/rewards/redeem | 스탬프 → 리워드 교환 | 필요 |
| GET | /api/rewards/my | 내 교환 내역 | 필요 |

### 미션 (`/api/missions`)

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | /api/missions | 미션 목록 + 진행률 | 불필요 (로그인 시 진행률 포함) |
| GET | /api/missions/my | 완료한 미션 목록 | 필요 |

### 관리자 (`/api/admin`) — 관리자 전용

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | /api/admin/wiki/pending | 심사 대기 위키 목록 |
| PATCH | /api/admin/wiki/:id | 위키 승인 / 거절 |
| GET | /api/admin/dashboard | 전체 통계 대시보드 |
| GET | /api/admin/users | 사용자 목록 |

---

## curl 테스트 예제

### 로그인

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test1234"}'
```

응답의 `token` 값을 이후 요청 `TOKEN` 자리에 사용하세요.

### 스탬프 인증 (해운대, GPS 포함)

```bash
curl -X POST http://localhost:3000/api/stamps/verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"qr_code":"QR_SPOT_01","user_lat":35.1587,"user_lng":129.1604}'
```

### 주변 명소 검색

```bash
curl "http://localhost:3000/api/spots/nearby?lat=35.1587&lng=129.1604&radius=2000"
```

### 위키 제보

```bash
curl -X POST http://localhost:3000/api/wiki \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"title":"광안리 야경 포인트","content":"동쪽 방파제가 광안대교 뷰 최고!","category":"hidden_spot"}'
```

### 관리자: 위키 승인

```bash
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@busan-ocean.kr","password":"admin1234"}' | \
  grep -o '"token":"[^"]*"' | cut -d'"' -f4)

curl -X PATCH http://localhost:3000/api/admin/wiki/WIKI_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"action":"approve","reward_stamps":15,"admin_note":"훌륭한 정보입니다!"}'
```

### 리워드 교환

```bash
curl -X POST http://localhost:3000/api/rewards/redeem \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"reward_type":"dongbaekjeon_3000"}'
```

---

## 핵심 비즈니스 로직

### 혼잡도 계산

| 최근 60분 방문 수 | 등급 | 스탬프 배율 |
|-----------------|------|------------|
| 20건 이상 | 혼잡 🔴 | ×1.0 |
| 8건 이상 | 보통 🟡 | ×1.5 |
| 8건 미만 | 여유 🟢 | ×2.0 |

혼잡도가 낮을수록 스탬프를 더 많이 지급해 방문객 분산을 유도합니다.

### GPS 인증

- Haversine 공식으로 명소 좌표 ↔ 사용자 좌표 거리 계산
- 반경 200m 초과 시 인증 거부 (403)
- 동일 명소 24시간 내 재인증 차단

### 스탬프 잔액 계산

```
잔액 = 스탬프 인증 합계
      + 리뷰 보너스 합계
      + 승인된 위키 보상 합계
      + 미션 완료 보너스 합계
      - 리워드 교환 소모 합계
```

### 외국인 사용자

`is_foreigner=1` 계정은 동백전·상품권 교환 시 자동으로 가맹점 QR 쿠폰으로 전환됩니다.

---

## 기술 스택

| 항목 | 기술 |
|------|------|
| Runtime | Node.js 20 |
| Framework | Express 4 |
| DB | SQLite (better-sqlite3 / sql.js fallback) |
| 인증 | JWT (jsonwebtoken + bcryptjs) |
| 지도 | Leaflet.js 1.9 + OpenStreetMap |
| 환경 | Replit / 로컬 Node |

---

## 데이터베이스 스키마 (10개 테이블)

| 테이블 | 설명 |
|--------|------|
| `users` | 사용자 계정 및 스탬프 잔액 |
| `spots` | 부산 해양 명소 30곳 (GPS 좌표, 다국어) |
| `stamp_logs` | 스탬프 인증 기록 (GPS 검증 결과 포함) |
| `reviews` | 명소 리뷰 (사진, 별점, 다국어) |
| `rewards` | 스탬프 교환 내역 |
| `wiki_posts` | 사용자 위키 제보 (승인 흐름) |
| `missions` | 테마 미션 정의 |
| `mission_completions` | 미션 완료 기록 |
| `review_likes` | 리뷰 좋아요 (중복 방지) |
| `wiki_helpful_votes` | 위키 도움됨 투표 (중복 방지) |

---

## 트러블슈팅

### better-sqlite3 빌드 실패 (Replit)

Replit 환경에서 네이티브 빌드 실패 시 **sql.js로 자동 전환**됩니다. 별도 설정 불필요.

```
[DB] better-sqlite3 로드 실패 — sql.js로 대체합니다.
```

위 로그가 출력되면 정상입니다.

### 포트 충돌

```bash
lsof -i :3000   # 사용 중인 프로세스 확인
# .env에서 PORT=3001 로 변경
```

### 데이터베이스 초기화

```bash
rm data/busan-ocean-pass.sqlite
npm run seed
```

---

*2026 부산광역시교육청 사제동행 프롬프트 엔지니어링 학생경진대회 — 해양수도 부산*
