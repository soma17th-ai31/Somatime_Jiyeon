"""
=============================================================
models.py — SQLAlchemy ORM 모델
-------------------------------------------------------------
[저장 원칙 — 기획서 4.4]
- 일정의 "제목/장소/설명"은 절대 저장하지 않습니다.
- 시작/종료 시간 + busy 여부만 보관합니다.
- 즉, 어떤 입력 경로(.ics / Google Calendar / 직접 입력)로 들어와도
  최종 형태는 "익명화된 BusyBlock" 입니다.

[엔티티 구조]
- Meeting          : 회의(방). 주최자가 만드는 단위.
- Participant      : 회의 안의 참여자(닉네임 기준, 익명).
- BusyBlock        : 참여자별 바쁜 시간 블록.
=============================================================
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.orm import relationship

from .database import Base


# -------------------------------------------------------------
# [SECTION 1] Meeting — 회의(방)
# -------------------------------------------------------------
class Meeting(Base):
    """
    주최자가 생성하는 '조율방' 1개를 의미합니다.
    초대 링크는 invite_code 로 만들어집니다 (/m/{invite_code}).
    """

    __tablename__ = "meetings"

    id = Column(Integer, primary_key=True, index=True)

    # 회의 메타 (기획서 3.2 - 회의 조건 5종)
    title = Column(String, nullable=False)               # 회의 제목
    start_date = Column(String, nullable=False)          # 후보 기간 시작 (YYYY-MM-DD)
    end_date = Column(String, nullable=False)            # 후보 기간 끝 (YYYY-MM-DD)
    duration_minutes = Column(Integer, nullable=False)   # 회의 길이(분)
    headcount = Column(Integer, nullable=False)          # 예정 인원
    location_type = Column(String, nullable=False)       # online | offline | any
    buffer_minutes = Column(Integer, nullable=False, default=0)
    # ↑ 오프라인일 때 슬롯 양옆에 적용할 이동시간(분).
    #   기획서 5.2: 15/30/45/75분 단위로 늘릴 수 있도록 함.

    # 일과 시간(타임테이블 표시 범위) — 너무 새벽/심야는 후보에서 자동 제외
    work_start_hour = Column(Integer, nullable=False, default=9)   # 09:00
    work_end_hour = Column(Integer, nullable=False, default=22)    # 22:00

    # 초대 링크용 토큰. URL 안전 16바이트.
    invite_code = Column(String, unique=True, index=True, nullable=False)

    # 확정된 후보 시간(있을 경우) — 주최자가 후보 중 1개를 고른 결과
    confirmed_start = Column(DateTime, nullable=True)
    confirmed_end = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    participants = relationship(
        "Participant",
        back_populates="meeting",
        cascade="all, delete-orphan",
    )

    @staticmethod
    def make_invite_code() -> str:
        """충돌 가능성이 낮은 짧은 초대 코드(URL-safe)."""
        return secrets.token_urlsafe(8)


# -------------------------------------------------------------
# [SECTION 2] Participant — 익명 닉네임 단위 참여자
# -------------------------------------------------------------
class Participant(Base):
    """
    회의 안에서의 1명. 로그인이 없으므로 닉네임이 식별자입니다.
    같은 회의 안에서 닉네임은 유일해야 합니다(라우터 단계에서 검증).
    """

    __tablename__ = "participants"

    id = Column(Integer, primary_key=True, index=True)

    meeting_id = Column(Integer, ForeignKey("meetings.id"), nullable=False)
    nickname = Column(String, nullable=False)

    # 어떤 입력 방식으로 일정을 제출했는지 — UI에서 표시용으로도 사용
    # values: "ics" | "google" | "manual"
    input_method = Column(String, nullable=True)

    # 사용자가 "이 결과 맞아요" 버튼을 눌렀는지(기획서 3.2 - 추출 결과 확인)
    confirmed = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    meeting = relationship("Meeting", back_populates="participants")
    busy_blocks = relationship(
        "BusyBlock",
        back_populates="participant",
        cascade="all, delete-orphan",
    )


# -------------------------------------------------------------
# [SECTION 3] BusyBlock — 익명화된 바쁜 시간 1블록
# -------------------------------------------------------------
class BusyBlock(Base):
    """
    가장 작은 단위의 데이터. (참여자, 시작, 종료)만 가집니다.
    여기에 절대 일정 제목/장소/설명을 넣지 않습니다 — 프라이버시 원칙.
    """

    __tablename__ = "busy_blocks"

    id = Column(Integer, primary_key=True, index=True)
    participant_id = Column(Integer, ForeignKey("participants.id"), nullable=False)

    start = Column(DateTime, nullable=False)  # UTC-naive (로컬 시간으로 통일)
    end = Column(DateTime, nullable=False)

    participant = relationship("Participant", back_populates="busy_blocks")
