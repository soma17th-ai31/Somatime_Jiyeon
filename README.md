# SomaMeet (소마밋)

> 개인 일정 세부 내용을 공개하지 않고도 여러 사람의 공통 가능 시간을
> 빠르게 찾아 주는 일정 조율 Agentic Workflow — 31조 SW마에스트로 프로젝트.

---

## 1. 빠른 시작

```bash
# Python 3.10+, macOS/Linux 가정
./run.sh
# 브라우저에서 http://localhost:8000 접속
```

`run.sh` 가 하는 일:
1. `backend/.venv` 가상환경 생성
2. `backend/requirements.txt` 설치
3. `uvicorn app.main:app --reload` 실행 (정적 프론트엔드도 함께 서빙)

---

## 2. 프로젝트 구조

```
Somatime_Jiyeon/
├── README.md
├── run.sh                       # 로컬 실행 스크립트
├── sample_data/
│   └── sample.ics               # .ics 업로드 테스트용 샘플
├── frontend/                    # React (CDN + Babel) 단일 페이지
│   ├── index.html
│   ├── styles.css
│   └── app.js                   # 모든 화면을 한 파일에 (섹션 주석으로 구분)
└── backend/                     # FastAPI + SQLite
    ├── requirements.txt
    └── app/
        ├── main.py              # 진입점, CORS, 정적 파일, SPA 라우팅
        ├── database.py          # SQLite 엔진/세션
        ├── models.py            # SQLAlchemy ORM 모델
        ├── schemas.py           # Pydantic 요청/응답 스키마
        ├── routers/
        │   └── meetings.py      # /api/meetings/* 엔드포인트
        └── services/
            ├── ics_parser.py        # .ics → BusyBlock
            ├── manual_input.py      # 직접 입력 정규화
            ├── google_calendar.py   # Google free/busy 어댑터
            ├── availability.py      # 슬롯 생성 + 버퍼 + 가용 인원
            ├── candidate_ranker.py  # 후보 시간 추천
            └── message.py           # 안내 메시지 초안
```

---

## 3. 핵심 흐름 (기획서 3장 매핑)

```
[수집]    회의 조건 → 닉네임 등록 → 일정 입력 3종 → 검증
[계산]    슬롯 그리드 → 버퍼 적용 → 슬롯별 가용 인원
[추천]    슬라이딩 윈도우로 회의 길이 만큼 인원이 모두 가능한 구간 → 점수 → 상위 3개
[확정]    후보 1개 선택 → 메시지 초안 → 사용자가 직접 복사/공유
```

각 단계에 해당하는 코드 위치:

| 기획서 단계 | 코드 |
|---|---|
| 수집 — 회의 조건 | `routers/meetings.py` `POST /api/meetings` |
| 수집 — 닉네임 | `POST /api/meetings/{code}/participants` |
| 수집 — 직접 입력 | `services/manual_input.py` |
| 수집 — .ics | `services/ics_parser.py` |
| 수집 — Google | `services/google_calendar.py` |
| 검증 | `POST /api/meetings/{code}/participants/{pid}/confirm` |
| 계산 — 슬롯 | `services/availability.py: build_slots` |
| 계산 — 버퍼 | `services/availability.py: apply_buffer` |
| 계산 — 가용성 | `services/availability.py: build_timetable` |
| 추천 | `services/candidate_ranker.py: rank_candidates` |
| 확정 | `POST /api/meetings/{code}/confirm` |
| 메시지 초안 | `services/message.py` + `GET /api/meetings/{code}/message` |

---

## 4. 프라이버시 원칙 (기획서 4.4)

- VEVENT의 SUMMARY/LOCATION/DESCRIPTION 등은 **읽지도, 저장하지도 않습니다.**
- DB의 `BusyBlock` 테이블에는 `(participant_id, start, end)` 만 존재합니다.
- Google Calendar는 free/busy 권한만 호출하도록 어댑터를 분리했습니다.
- `.ics` 업로드 파일은 처리 직후 메모리에서 사라집니다 (서버에 저장 X).

---

## 5. API 요약

| Method | Path | 설명 |
|---|---|---|
| POST | `/api/meetings` | 회의(방) 생성 |
| GET  | `/api/meetings/{code}` | 회의 정보 조회 |
| GET  | `/api/meetings/{code}/recommend` | 타임테이블 + 후보 3개 |
| POST | `/api/meetings/{code}/confirm` | 후보 1개 확정 |
| GET  | `/api/meetings/{code}/message` | 안내 메시지 초안 |
| POST | `/api/meetings/{code}/participants` | 닉네임 등록 |
| GET  | `/api/meetings/{code}/participants/{pid}` | 참여자 + 등록 블록 조회 |
| POST | `/api/meetings/{code}/participants/{pid}/manual` | 직접 입력 제출 |
| POST | `/api/meetings/{code}/participants/{pid}/ics` | .ics 업로드 (multipart) |
| POST | `/api/meetings/{code}/participants/{pid}/google` | Google free/busy 제출 |
| POST | `/api/meetings/{code}/participants/{pid}/confirm` | "결과 맞아요" 검증 |

자동 생성 문서: `http://localhost:8000/docs` (Swagger UI)

---

## 6. 시연 시나리오 (기획서 3.1)

1. 브라우저에서 `http://localhost:8000` 접속 → 회의 조건 입력 (오프라인 + 30분 버퍼 등).
2. 발급된 초대 링크를 복사해 새 시크릿 창들로 열기 (참여자 시뮬레이션).
3. 한 명은 `sample_data/sample.ics` 업로드, 다른 한 명은 직접 입력.
4. 결과 화면에서 타임테이블 색상으로 가용 인원을 확인하고 후보 중 1개 확정.
5. 안내 메시지 초안을 복사해 메신저에 붙여넣기.

---

## 7. MVP에 포함하지 않은 것 (기획서 5.2)

- 캘린더 스크린샷 Vision 인식
- 회의 초대장 자동 발송 / 외부 캘린더 자동 등록
- 회원 로그인 / 회원 관리
- 모바일 네이티브 앱 (반응형으로 우선 지원)
- 운영 단계의 OAuth 2.0 화면 (어댑터 인터페이스만 선반영)

---

## 8. 배포 메모 (기획서 5.3)

- AWS Lightsail 4GB 인스턴스 가정.
- `uvicorn` 앞단에 `nginx` 를 두고 `Let's Encrypt` 로 HTTPS.
- SQLite 파일은 별도 볼륨에 마운트해 백업 회전 권장.
