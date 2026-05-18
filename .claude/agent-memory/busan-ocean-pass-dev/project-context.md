---
name: project-context
description: 부산오션패스 프로젝트 목적, 대회 배경, 기술 스택 고정 사항
metadata:
  type: project
---

부산오션패스 백엔드는 2026 부산광역시교육청 주최 「사제동행 프롬프트 엔지니어링 학생경진대회」 출품작의 시연용 프로토타입입니다.

**Why:** 평가 핵심은 앱 자체가 아니라 "프롬프트 엔지니어링 과정"의 가시성이므로, 코드 주석은 한국어로 상세히 작성하고 결정 이유를 명시적으로 설명해야 합니다.

**How to apply:**
- 모든 소스 파일 주석은 한국어로 작성 (JSDoc 포함)
- 각 Phase 완료 시 "왜 이렇게 결정했는지" 간략히 설명
- 에러 메시지는 한국어 우선, 외국인 대응 부분은 영문 병기
- 프로토타입이므로 과도한 최적화보다 가독성/명확성 우선

기술 스택 고정:
- Node.js 20 + Express + SQLite (better-sqlite3)
- Auth: JWT (jsonwebtoken + bcryptjs)
- 환경: Replit 브라우저 기반
- 패키지: cors, dotenv, uuid, sql.js(fallback)

프로젝트 경로: /workspaces/haedap/busan-ocean-pass-backend/
