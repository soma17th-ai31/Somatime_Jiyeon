"""
=============================================================
schemas.py — Pydantic 스키마 (요청 / 응답 DTO)
-------------------------------------------------------------
ORM 모델(models.py)은 DB 표현,
이 파일의 스키마는 "API 경계에서 주고받는 데이터 형태"입니다.
둘을 분리해 두면 내부 구조 변경이 외부 API에 새지 않습니다.
=============================================================
"""

from __future__ import annotations

from datetime import date, datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator


# -------------------------------------------------------------
# [SECTION 1] 회의(Meeting) 생성/조회
# -------------------------------------------------------------
LocationType = Literal["online", "offline", "any"]


class MeetingCreate(BaseModel):
    """주최자가 회의(방)를 만들 때 보내는 페이로드.
    기획서 3.2의 회의 조건 5종 + 버퍼 옵션."""

    title: str = Field(..., min_length=1, max_length=80)
    start_date: date
    end_date: date
    duration_minutes: int = Field(..., ge=15, le=8 * 60)
    headcount: int = Field(..., ge=2, le=30)
    location_type: LocationType = "any"

    # 기획서 5.2: 15/30/45/75분 단위로 늘릴 수 있도록 함
    buffer_minutes: int = Field(0, ge=0, le=120)

    work_start_hour: int = Field(9, ge=0, le=23)
    work_end_hour: int = Field(22, ge=1, le=24)

    @field_validator("end_date")
    @classmethod
    def _end_after_start(cls, v: date, info):
        s = info.data.get("start_date")
        if s and v < s:
            raise ValueError("end_date must be on/after start_date")
        return v

    @field_validator("buffer_minutes")
    @classmethod
    def _buffer_step(cls, v: int):
        # 0/15/30/45/60/75 만 허용 (기획서 예시 단위)
        allowed = {0, 15, 30, 45, 60, 75}
        if v not in allowed:
            raise ValueError(f"buffer_minutes must be one of {sorted(allowed)}")
        return v


class MeetingOut(BaseModel):
    """회의 정보 응답. invite_code 가 곧 초대 링크의 일부."""

    id: int
    title: str
    start_date: date
    end_date: date
    duration_minutes: int
    headcount: int
    location_type: LocationType
    buffer_minutes: int
    work_start_hour: int
    work_end_hour: int
    invite_code: str
    confirmed_start: Optional[datetime] = None
    confirmed_end: Optional[datetime] = None
    participants_count: int = 0

    class Config:
        from_attributes = True


# -------------------------------------------------------------
# [SECTION 2] 참여자(Participant) — 닉네임 등록 / 일정 제출
# -------------------------------------------------------------
class ParticipantCreate(BaseModel):
    nickname: str = Field(..., min_length=1, max_length=20)


class TimeRange(BaseModel):
    """단일 시간 블록. 직접 입력/파싱 결과를 표현하는 공통 형태."""

    start: datetime
    end: datetime

    @field_validator("end")
    @classmethod
    def _end_after_start(cls, v: datetime, info):
        s = info.data.get("start")
        if s and v <= s:
            raise ValueError("end must be after start")
        return v


class ManualBusySubmit(BaseModel):
    """직접 입력 방식 — 사용자가 바쁜 시간 블록 목록을 보냅니다."""

    busy_blocks: List[TimeRange]


class GoogleFreeBusySubmit(BaseModel):
    """Google Calendar free/busy API 결과를 그대로 받는 형태(어댑터 출력)."""

    busy_blocks: List[TimeRange]


class ParticipantOut(BaseModel):
    id: int
    nickname: str
    input_method: Optional[str] = None
    confirmed: bool = False
    busy_blocks: List[TimeRange] = []

    class Config:
        from_attributes = True


# -------------------------------------------------------------
# [SECTION 3] 추천 결과 — 타임테이블 + 후보 3개
# -------------------------------------------------------------
class TimetableCell(BaseModel):
    """한 슬롯(예: 30분 칸)의 가용성 정보."""

    start: datetime
    end: datetime
    available_count: int       # 그 시간에 가능한 인원 수
    available_nicknames: List[str]


class CandidateSlot(BaseModel):
    """추천 후보 1개. 이유는 검증 가능한 사실 위주(기획서 4.3)."""

    start: datetime
    end: datetime
    available_nicknames: List[str]
    reasons: List[str]


class RecommendationOut(BaseModel):
    timetable: List[TimetableCell]
    candidates: List[CandidateSlot]
    total_participants: int
    note: Optional[str] = None     # 후보가 없을 때 등의 안내


# -------------------------------------------------------------
# [SECTION 4] 확정 / 메시지 초안
# -------------------------------------------------------------
class ConfirmRequest(BaseModel):
    start: datetime
    end: datetime


class MessageDraftOut(BaseModel):
    text: str
