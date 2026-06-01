# 부산오션패스 (Busan Ocean Pass) — Python/Flask 백엔드

부산 해양 관광 명소를 QR + GPS로 인증하고 스탬프를 적립·교환하는 여행 동반자 서비스의 백엔드 API 서버입니다.

- **언어/프레임워크:** Python 3 + Flask
- **DB:** SQLite (WAL 모드)
- **인증:** JWT (HS256) + bcrypt
- **AI 챗봇:** Google Gemini 1.5-flash

---

## 1. 사전 준비물

| 항목 | 권장 버전 | 비고 |
|---|---|---|
| Python | 3.10 이상 | `python3 --version` 으로 확인 |
| pip | 최신 | `python3 -m pip install --upgrade pip` |
| 운영체제 | Linux / macOS / WSL / Codespaces | Windows 네이티브도 가능 |

---

## 2. 최초 1회 설정 (Setup)

### 2-1. 프로젝트 디렉터리 진입

```bash
cd busan-ocean-pass-python
```

### 2-2. (권장) 가상환경 만들기

```bash
python3 -m venv .venv
source .venv/bin/activate          # macOS / Linux / WSL
# Windows PowerShell 의 경우:  .venv\Scripts\Activate.ps1
```

### 2-3. 의존성 설치

```bash
pip install -r requirements.txt
```

설치되는 패키지: `flask`, `flask-cors`, `PyJWT`, `bcrypt`, `python-dotenv`, `google-genai`

### 2-4. 환경변수 파일 생성

`.env.example` 을 복사해서 `.env` 를 만들고, 본인 값으로 채웁니다.

```bash
cp .env.example .env
```

`.env` 항목 설명:

| 키 | 설명 | 예시 |
|---|---|---|
| `PORT` | 서버가 바인딩할 포트 | `3000` |
| `JWT_SECRET` | JWT 서명 비밀키 (**반드시 변경**) | `my-super-secret-key-32chars` |
| `JWT_EXPIRES_DAYS` | JWT 만료(일) | `7` |
| `DB_PATH` | SQLite 파일 경로 | `./data/busan-ocean-pass.sqlite` |
| `GEMINI_API_KEY` | 챗봇용 Gemini API 키 (없으면 챗봇만 503) | `AIza...` |
| `CONGESTION_WINDOW_MINUTES` | 혼잡도 집계 시간창 (분) | `60` |
| `CONGESTION_HIGH_THRESHOLD` | 혼잡 임계치 (방문수) | `20` |
| `CONGESTION_MID_THRESHOLD` | 보통 임계치 (방문수) | `8` |
| `GPS_VERIFY_RADIUS_METERS` | QR 인증 허용 반경 (m) | `200` |
| `MASTER_ADMIN_EMAIL` | 서버 시작 시 자동 동기화될 마스터 어드민 계정 이메일 | `admin@example.com` |
| `MASTER_ADMIN_PASSWORD` | 위 계정 비밀번호 (서버 시작 시 해시되어 DB에 반영) | `change-me` |

`JWT_SECRET`이 비어 있으면 `middleware.py` 가 부팅 시 `RuntimeError`를 발생시켜 서버가 뜨지 않습니다.

---

## 3. 서버 실행

### 3-1. 가장 단순한 실행

```bash
python app.py
```

성공 시 콘솔 출력 예:

```
========================================
  부산오션패스 API 서버 (Python/Flask)
  DB 초기화 중...
[DB] 초기화 완료: ./data/busan-ocean-pass.sqlite
[마스터 어드민] 동기화 완료 — admin@example.com   ← .env 에 설정한 경우만 출력
  포트: 3000
  환경: development
  헬스체크: http://localhost:3000/api
========================================
 * Running on http://127.0.0.1:3000
 * Running on http://0.0.0.0:3000
```

이 시점부터 `http://localhost:3000` 에서 API 가 응답합니다.

### 3-2. 백그라운드 실행 (로그 파일로)

```bash
python app.py > server.log 2>&1 &
```

종료:

```bash
pkill -f "python app.py"
```

### 3-3. 프로덕션 실행 (gunicorn 권장)

`requirements.txt` 에는 포함되어 있지 않으므로 별도 설치:

```bash
pip install gunicorn
gunicorn --bind 0.0.0.0:3000 --workers 4 "app:create_app()"
```

> 주의: `gunicorn` 으로 띄울 경우 `app.py` 의 `if __name__ == '__main__':` 블록이 실행되지 않으므로 **DB 초기화 / 마스터 어드민 동기화가 일어나지 않습니다.** 최소 1회는 `python app.py` 로 띄우거나, 별도 init 스크립트를 만들어 주세요.

### 3-4. `FLASK_ENV` 로 디버그/프로덕션 모드 전환

```bash
FLASK_ENV=production python app.py    # debug=False 로 가동
FLASK_ENV=development python app.py   # 기본값. 코드 변경 시 자동 리로드
```

---

## 4. 동작 확인 (스모크 테스트)

서버가 떠 있는 상태에서 다른 터미널에서 실행하세요.

```bash
# 헬스체크 + 엔드포인트 목록
curl http://localhost:3000/api

# 명소 목록
curl "http://localhost:3000/api/spots?lang=ko"

# 회원가입
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"nickname":"홍길동","email":"hong@test.com","password":"abc12345","language":"ko"}'

# 로그인 (토큰 발급)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"hong@test.com","password":"abc12345"}'

# 내 정보 조회 (위에서 받은 token 사용)
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer <TOKEN>"
```

### 웹 UI

| 경로 | 설명 |
|---|---|
| `http://localhost:3000/` | 일반 사용자 페이지 (`public/index.html`) |
| `http://localhost:3000/admin.html` | 관리자 페이지 (`public/admin.html`) |

---

## 5. 주요 API 엔드포인트 요약

상세 명세는 서버 가동 후 **`GET /api`** 로 확인할 수 있습니다.

| 그룹 | 엔드포인트 | 인증 |
|---|---|---|
| 인증 | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` | 일부 🔐 |
| 명소 | `GET /api/spots`, `GET /api/spots/nearby`, `GET /api/spots/:id`, `GET /api/spots/:id/congestion` | — |
| 스탬프 | `POST /api/stamps/verify`, `GET /api/stamps/my`, `GET /api/stamps/progress` | 🔐 |
| 리뷰 | `POST /api/reviews`, `GET /api/reviews/spot/:id`, `POST /api/reviews/:id/like`, `GET /api/reviews/my` | 일부 🔐 |
| 위키 | `POST /api/wiki`, `GET /api/wiki`, `GET /api/wiki/my`, `GET /api/wiki/:id`, `POST /api/wiki/:id/helpful` | 일부 🔐 |
| 리워드 | `GET /api/rewards/catalog`, `POST /api/rewards/redeem`, `GET /api/rewards/my` | 🔐 |
| 미션 | `GET /api/missions`, `GET /api/missions/my` | 일부 🔐 |
| 관리자 | `GET /api/admin/wiki/pending`, `PATCH /api/admin/wiki/:id`, `GET /api/admin/dashboard`, `GET /api/admin/users` | 🛡️ admin |
| QR | `POST /api/qr/generate`, `POST /api/qr/scan` | 🔐 / 🛡️ |
| 챗봇 | `POST /api/chat` | 🔐 |

- 🔐 `Authorization: Bearer <JWT>` 헤더 필수
- 🛡️ JWT 의 `role` 이 `admin` 이어야 함

---

## 6. 디렉터리 구조

```
busan-ocean-pass-python/
├── app.py              # 엔트리포인트 (Flask 앱 생성 / 라우트 등록)
├── db.py               # SQLite 스키마 + 연결 헬퍼
├── helpers.py          # 거리·혼잡도·스탬프 재계산·미션 자동완료
├── middleware.py       # JWT 인증 데코레이터
├── requirements.txt
├── .env.example
├── .env                # (직접 생성, gitignore 됨)
├── data/               # SQLite 파일 보관 (자동 생성)
├── public/             # 정적 HTML (사용자/관리자 페이지)
│   ├── index.html
│   └── admin.html
└── routes/             # 각 도메인별 Blueprint
    ├── auth.py
    ├── spots.py
    ├── stamps.py
    ├── reviews.py
    ├── wiki.py
    ├── rewards.py
    ├── missions.py
    ├── admin.py
    ├── qr.py
    └── chat.py
```

---

## 7. 자주 겪는 문제 (Troubleshooting)

### `RuntimeError: [인증] JWT_SECRET 환경변수가 설정되지 않았습니다.`
→ `.env` 파일의 `JWT_SECRET` 값을 비어 있지 않게 채워주세요. `.env` 가 `app.py` 와 같은 디렉터리에 있어야 합니다.

### `Address already in use` / 포트 충돌
```bash
lsof -i :3000           # 점유 프로세스 확인
pkill -f "python app.py"
# 또는 .env 의 PORT 를 3001 등으로 변경
```

### DB 파일이 잠겨 있다 (`database is locked`)
→ 동시에 여러 인스턴스가 실행 중일 수 있습니다. `pkill -f "python app.py"` 로 전부 정리 후 재실행.

### 챗봇만 503 응답이 옵니다
→ `.env` 의 `GEMINI_API_KEY` 가 비어 있는 경우입니다. 다른 모든 기능은 정상 동작합니다.

### 관리자 페이지로 로그인하고 싶은데 admin 계정이 없습니다
→ `.env` 에 `MASTER_ADMIN_EMAIL` / `MASTER_ADMIN_PASSWORD` 를 설정하고 서버를 **재시작**하세요. `app.py` 의 `sync_master_admin()` 이 자동으로 계정을 생성하거나 기존 계정을 admin 으로 승격시킵니다.

### DB 를 초기 상태로 되돌리고 싶습니다
```bash
rm -f data/busan-ocean-pass.sqlite*
python app.py   # 다시 시작하면 빈 스키마가 자동 생성됨
```

---

## 8. 빠른 시작 한 줄 요약

```bash
cd busan-ocean-pass-python && python3 -m venv .venv && source .venv/bin/activate \
  && pip install -r requirements.txt && cp .env.example .env \
  && sed -i 's/your_jwt_secret_key_here/dev-secret-please-change/' .env \
  && python app.py
```

브라우저에서 `http://localhost:3000` 접속하면 끝입니다.
