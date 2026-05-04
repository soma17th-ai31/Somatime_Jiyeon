"""
=============================================================
database.py — SQLite 연결 & 세션 관리
-------------------------------------------------------------
- 기획서 4.1: Storage = SQLite (또는 임시 저장소)
- MVP 기준이라 가볍게 SQLite 파일 1개로 운영합니다.
- FastAPI 의존성 주입(get_db)을 통해 요청 단위 세션을 사용합니다.
=============================================================
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# -------------------------------------------------------------
# [SECTION 1] 엔진 / 세션 팩토리
# -------------------------------------------------------------
# SQLite는 파일 하나에 모든 데이터를 저장합니다.
# check_same_thread=False : FastAPI 비동기 워커에서 같은 connection을
# 여러 스레드에서 쓰는 경우를 허용합니다(SQLite의 기본 제약 해제).
DATABASE_URL = "sqlite:///./somameet.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 모든 ORM 모델이 상속받을 베이스 클래스
Base = declarative_base()


# -------------------------------------------------------------
# [SECTION 2] FastAPI 의존성 — 요청 1건당 세션 1개
# -------------------------------------------------------------
def get_db():
    """라우터에서 Depends(get_db) 형태로 사용합니다."""
    db = SessionLocal()
    try:
        yield db
    finally:
        # 요청이 끝나면 세션을 닫아 커넥션 누수를 방지합니다.
        db.close()


# -------------------------------------------------------------
# [SECTION 3] 초기화 — 앱 시작 시 테이블 생성
# -------------------------------------------------------------
def init_db() -> None:
    # 모델을 미리 import 해야 Base.metadata에 등록됩니다.
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
