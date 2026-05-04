"""
=============================================================
main.py — FastAPI 진입점
-------------------------------------------------------------
[기능]
- 앱 초기화 + DB 테이블 생성
- CORS 허용(개발 편의를 위해 *)
- /api/* 라우터 등록
- /static/* 으로 React 정적 파일 서빙 (frontend 폴더)
- /  → index.html 반환
- /m/{code} → index.html (SPA 라우팅 진입점)
=============================================================
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .database import init_db
from .routers import meetings


# -------------------------------------------------------------
# [SECTION 1] 앱 생성
# -------------------------------------------------------------
app = FastAPI(
    title="SomaMeet (소마밋)",
    description="개인 일정 노출 없이 공통 가능 시간을 찾아주는 일정 조율 Agent",
    version="0.1.0",
)

# 개발 단계에서는 모든 출처 허용. 배포 시엔 도메인 화이트리스트로 좁히세요.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -------------------------------------------------------------
# [SECTION 2] 시작 훅 — DB 초기화
# -------------------------------------------------------------
@app.on_event("startup")
def _startup() -> None:
    init_db()


# -------------------------------------------------------------
# [SECTION 3] API 라우터
# -------------------------------------------------------------
app.include_router(meetings.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "somameet"}


# -------------------------------------------------------------
# [SECTION 4] 정적 파일 + SPA 라우팅
# -------------------------------------------------------------
# 디렉토리 구조:
#   Somatime_Jiyeon/
#     backend/
#       app/main.py   ← 우리는 여기
#     frontend/
#       index.html
#       app.js
FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"

if FRONTEND_DIR.exists():
    app.mount(
        "/static",
        StaticFiles(directory=str(FRONTEND_DIR)),
        name="static",
    )

    @app.get("/")
    def index():
        return FileResponse(FRONTEND_DIR / "index.html")

    @app.get("/m/{code}")
    def meeting_page(code: str):  # noqa: ARG001  (code는 프론트가 location.pathname에서 읽음)
        return FileResponse(FRONTEND_DIR / "index.html")
else:
    @app.get("/")
    def index_missing():
        return JSONResponse(
            {"detail": "frontend 폴더를 찾지 못했습니다. README.md 참고"},
            status_code=500,
        )
