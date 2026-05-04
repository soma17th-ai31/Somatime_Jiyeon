"""
=============================================================
routers/meetings.py — 회의 / 참여자 / 추천 / 확정 엔드포인트
-------------------------------------------------------------
[REST 디자인 — 기획서 3.3 워크플로우와 1:1 매칭]

  주최자
   POST   /api/meetings                    회의(방) 생성
   GET    /api/meetings/{code}             회의 정보 + 참여자 수 조회
   GET    /api/meetings/{code}/recommend   타임테이블 + 후보 3개
   POST   /api/meetings/{code}/confirm     후보 1개 확정
   GET    /api/meetings/{code}/message     안내 메시지 초안

  참여자
   POST   /api/meetings/{code}/participants                  닉네임 등록
   POST   /api/meetings/{code}/participants/{pid}/manual     직접 입력 제출
   POST   /api/meetings/{code}/participants/{pid}/ics        .ics 업로드 제출
   POST   /api/meetings/{code}/participants/{pid}/google     Google free/busy 제출
   POST   /api/meetings/{code}/participants/{pid}/confirm    "결과 맞아요" 검증
   GET    /api/meetings/{code}/participants/{pid}            현재 등록된 블록 확인

[누락 입력 안내 — 기획서 2.3 / 3.2-9]
- 누락된 필드가 있으면 400 + "되묻기 메시지 1개"만 반환합니다.
  (Pydantic 단일 검증 실패 메시지 정책)
=============================================================
"""

from __future__ import annotations

from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services import availability, candidate_ranker, ics_parser, manual_input, message
from ..services.google_calendar import fetch_freebusy

router = APIRouter(prefix="/api/meetings", tags=["meetings"])


# =============================================================
# [SECTION A] 회의 생성/조회
# =============================================================
@router.post("", response_model=schemas.MeetingOut)
def create_meeting(payload: schemas.MeetingCreate, db: Session = Depends(get_db)):
    """주최자: 회의 조건을 입력하고 초대 코드(=링크)를 받습니다."""
    m = models.Meeting(
        title=payload.title,
        start_date=payload.start_date.isoformat(),
        end_date=payload.end_date.isoformat(),
        duration_minutes=payload.duration_minutes,
        headcount=payload.headcount,
        location_type=payload.location_type,
        buffer_minutes=payload.buffer_minutes,
        work_start_hour=payload.work_start_hour,
        work_end_hour=payload.work_end_hour,
        invite_code=models.Meeting.make_invite_code(),
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return _to_meeting_out(m)


@router.get("/{code}", response_model=schemas.MeetingOut)
def get_meeting(code: str, db: Session = Depends(get_db)):
    m = _require_meeting(db, code)
    return _to_meeting_out(m)


# =============================================================
# [SECTION B] 참여자 등록 + 일정 제출 (3종 입력)
# =============================================================
@router.post(
    "/{code}/participants", response_model=schemas.ParticipantOut
)
def register_participant(
    code: str, payload: schemas.ParticipantCreate, db: Session = Depends(get_db)
):
    m = _require_meeting(db, code)

    # 같은 회의 안에서 닉네임 중복 불허
    existing = (
        db.query(models.Participant)
        .filter(models.Participant.meeting_id == m.id)
        .filter(models.Participant.nickname == payload.nickname)
        .first()
    )
    if existing:
        raise HTTPException(409, "이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.")

    p = models.Participant(meeting_id=m.id, nickname=payload.nickname)
    db.add(p)
    db.commit()
    db.refresh(p)
    return _to_participant_out(p)


@router.get(
    "/{code}/participants/{pid}", response_model=schemas.ParticipantOut
)
def get_participant(code: str, pid: int, db: Session = Depends(get_db)):
    p = _require_participant(db, code, pid)
    return _to_participant_out(p)


# ----- B-1) 직접 입력 ------------------------------------------------
@router.post(
    "/{code}/participants/{pid}/manual", response_model=schemas.ParticipantOut
)
def submit_manual(
    code: str,
    pid: int,
    payload: schemas.ManualBusySubmit,
    db: Session = Depends(get_db),
):
    p = _require_participant(db, code, pid)

    blocks = manual_input.normalize_manual_blocks(
        [(b.start, b.end) for b in payload.busy_blocks]
    )
    _replace_busy_blocks(db, p, blocks, input_method="manual")
    return _to_participant_out(p)


# ----- B-2) .ics 업로드 ----------------------------------------------
@router.post(
    "/{code}/participants/{pid}/ics", response_model=schemas.ParticipantOut
)
async def submit_ics(
    code: str, pid: int, file: UploadFile = File(...), db: Session = Depends(get_db)
):
    p = _require_participant(db, code, pid)

    raw = await file.read()
    try:
        blocks = ics_parser.parse_ics_to_busy(raw)
    except ValueError as e:
        # 기획서 4.5: 형식 오류 시 사용자가 직접 입력 또는 재업로드 하도록 안내
        raise HTTPException(
            400,
            f"{e} — .ics 형식을 확인하시거나 직접 입력으로 등록해 주세요.",
        )

    _replace_busy_blocks(db, p, blocks, input_method="ics")
    return _to_participant_out(p)


# ----- B-3) Google Calendar free/busy --------------------------------
@router.post(
    "/{code}/participants/{pid}/google", response_model=schemas.ParticipantOut
)
def submit_google(
    code: str,
    pid: int,
    payload: schemas.GoogleFreeBusySubmit,
    db: Session = Depends(get_db),
):
    """
    프론트(또는 별도 OAuth 모듈)에서 Google free/busy 호출 결과를
    가공해 보내주는 형태의 엔드포인트입니다.

    서버에서 직접 OAuth + free/busy 호출이 필요한 경우는
    services.google_calendar.fetch_freebusy 를 사용하세요.
    """
    p = _require_participant(db, code, pid)
    blocks = manual_input.normalize_manual_blocks(
        [(b.start, b.end) for b in payload.busy_blocks]
    )
    _replace_busy_blocks(db, p, blocks, input_method="google")
    return _to_participant_out(p)


# ----- B-4) 사용자 검증 토글 ----------------------------------------
@router.post(
    "/{code}/participants/{pid}/confirm", response_model=schemas.ParticipantOut
)
def confirm_participant(code: str, pid: int, db: Session = Depends(get_db)):
    """기획서 3.2-4 '추출 결과 확인' — 사용자가 '맞아요' 버튼을 눌렀을 때."""
    p = _require_participant(db, code, pid)
    p.confirmed = True
    db.commit()
    db.refresh(p)
    return _to_participant_out(p)


# =============================================================
# [SECTION C] 추천 — 타임테이블 + 후보 3개
# =============================================================
@router.get("/{code}/recommend", response_model=schemas.RecommendationOut)
def recommend(code: str, db: Session = Depends(get_db)):
    m = _require_meeting(db, code)
    participants = m.participants

    # 참여자가 0명이면 의미가 없으니 안내만 반환
    if not participants:
        return schemas.RecommendationOut(
            timetable=[], candidates=[], total_participants=0,
            note="아직 참여자가 없습니다. 초대 링크를 공유해 주세요.",
        )

    # 1) 슬롯 만들기
    start_date = datetime.fromisoformat(m.start_date).date()
    end_date = datetime.fromisoformat(m.end_date).date()
    slots = availability.build_slots(
        start_date, end_date, m.work_start_hour, m.work_end_hour
    )

    # 2) 참여자별 BusyBlock 모으기
    pbs: List[availability.ParticipantBusy] = []
    for p in participants:
        pbs.append(
            availability.ParticipantBusy(
                nickname=p.nickname,
                busy=[(b.start, b.end) for b in p.busy_blocks],
            )
        )

    # 3) 타임테이블 계산 (버퍼는 오프라인일 때만 적용)
    cells = availability.build_timetable(
        pbs, slots, m.buffer_minutes, m.location_type
    )

    # 4) 후보 추천
    cand = candidate_ranker.rank_candidates(
        cells, m.duration_minutes, len(participants), max_candidates=3
    )

    note = None
    if not cand:
        # 기획서 4.5: 후보가 없으면 조건 완화 제안
        note = (
            "조건을 모두 만족하는 후보가 없습니다. "
            "회의 길이를 줄이거나 후보 기간을 넓혀 주세요."
        )

    return schemas.RecommendationOut(
        timetable=[
            schemas.TimetableCell(
                start=c.start,
                end=c.end,
                available_count=c.available_count,
                available_nicknames=c.available_nicknames,
            )
            for c in cells
        ],
        candidates=[
            schemas.CandidateSlot(
                start=c.start,
                end=c.end,
                available_nicknames=c.available_nicknames,
                reasons=c.reasons,
            )
            for c in cand
        ],
        total_participants=len(participants),
        note=note,
    )


# =============================================================
# [SECTION D] 확정 + 메시지 초안
# =============================================================
@router.post("/{code}/confirm", response_model=schemas.MeetingOut)
def confirm_meeting(
    code: str, payload: schemas.ConfirmRequest, db: Session = Depends(get_db)
):
    m = _require_meeting(db, code)
    m.confirmed_start = payload.start
    m.confirmed_end = payload.end
    db.commit()
    db.refresh(m)
    return _to_meeting_out(m)


@router.get("/{code}/message", response_model=schemas.MessageDraftOut)
def get_message(code: str, db: Session = Depends(get_db)):
    m = _require_meeting(db, code)
    if not (m.confirmed_start and m.confirmed_end):
        raise HTTPException(400, "아직 확정된 시간이 없습니다. 후보를 먼저 선택해 주세요.")
    text = message.build_invite_message(
        title=m.title,
        start=m.confirmed_start,
        end=m.confirmed_end,
        location_type=m.location_type,
        nicknames=[p.nickname for p in m.participants],
    )
    return schemas.MessageDraftOut(text=text)


# =============================================================
# [SECTION E] 내부 헬퍼
# =============================================================
def _require_meeting(db: Session, code: str) -> models.Meeting:
    m = db.query(models.Meeting).filter(models.Meeting.invite_code == code).first()
    if not m:
        raise HTTPException(404, "해당 회의(초대 코드)를 찾을 수 없습니다.")
    return m


def _require_participant(db: Session, code: str, pid: int) -> models.Participant:
    m = _require_meeting(db, code)
    p = (
        db.query(models.Participant)
        .filter(models.Participant.id == pid)
        .filter(models.Participant.meeting_id == m.id)
        .first()
    )
    if not p:
        raise HTTPException(404, "해당 참여자를 찾을 수 없습니다.")
    return p


def _replace_busy_blocks(
    db: Session,
    p: models.Participant,
    blocks: list[tuple[datetime, datetime]],
    input_method: str,
) -> None:
    """기존 블록을 비우고 새 블록으로 교체. (참여자가 다시 제출하는 경우 대비)"""
    # 1) 기존 BusyBlock 삭제
    for b in list(p.busy_blocks):
        db.delete(b)
    # 2) 새 블록 추가
    for s, e in blocks:
        db.add(models.BusyBlock(participant_id=p.id, start=s, end=e))
    p.input_method = input_method
    # 입력이 바뀌면 사용자 검증 상태도 초기화 — 다시 확인을 받기 위함
    p.confirmed = False
    db.commit()
    db.refresh(p)


def _to_meeting_out(m: models.Meeting) -> schemas.MeetingOut:
    return schemas.MeetingOut(
        id=m.id,
        title=m.title,
        start_date=datetime.fromisoformat(m.start_date).date(),
        end_date=datetime.fromisoformat(m.end_date).date(),
        duration_minutes=m.duration_minutes,
        headcount=m.headcount,
        location_type=m.location_type,
        buffer_minutes=m.buffer_minutes,
        work_start_hour=m.work_start_hour,
        work_end_hour=m.work_end_hour,
        invite_code=m.invite_code,
        confirmed_start=m.confirmed_start,
        confirmed_end=m.confirmed_end,
        participants_count=len(m.participants),
    )


def _to_participant_out(p: models.Participant) -> schemas.ParticipantOut:
    return schemas.ParticipantOut(
        id=p.id,
        nickname=p.nickname,
        input_method=p.input_method,
        confirmed=p.confirmed,
        busy_blocks=[
            schemas.TimeRange(start=b.start, end=b.end) for b in p.busy_blocks
        ],
    )
