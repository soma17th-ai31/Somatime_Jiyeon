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

import hashlib
from datetime import datetime
from typing import List, Optional

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
def register_or_login_participant(
    code: str, payload: schemas.ParticipantCreate, db: Session = Depends(get_db)
):
    """
    [동작 규칙 — When2Meet 스타일]
    - 닉네임이 처음 보면 → 새 참여자 생성. (PIN이 있으면 함께 저장)
    - 닉네임이 이미 있으면 → "재진입" 시도:
        * 기존 등록에 PIN 이 있다 → 입력 PIN 이 일치해야 통과.
        * 기존 등록에 PIN 이 없다 → 입력 PIN 도 비어 있어야 통과
          (안 그러면 누군가가 닉을 선점한 상태에서 새 PIN 으로 덮어쓰는 사고 방지).
    - 위 규칙에 어긋나면 409 + 친절한 안내 메시지 반환.
    """
    m = _require_meeting(db, code)

    incoming_hash = _hash_pin(payload.pin)

    existing = (
        db.query(models.Participant)
        .filter(models.Participant.meeting_id == m.id)
        .filter(models.Participant.nickname == payload.nickname)
        .first()
    )

    if existing:
        # 재진입 케이스 — PIN 일치 검사
        if existing.pin_hash != incoming_hash:
            if existing.pin_hash is None:
                raise HTTPException(
                    409,
                    "이미 같은 닉네임이 PIN 없이 등록돼 있습니다. "
                    "PIN을 비우고 다시 시도하거나 다른 닉네임을 사용해 주세요.",
                )
            raise HTTPException(
                409,
                "닉네임은 등록돼 있지만 PIN이 일치하지 않습니다. "
                "PIN을 확인하거나 다른 닉네임을 사용해 주세요.",
            )
        # PIN 일치 → 기존 참여자로 재진입(로그인)
        # 입장 시 새로 입력된 buffer_minutes 가 있으면 갱신해 준다(본인이 바꿀 수 있게).
        if payload.buffer_minutes != existing.buffer_minutes:
            existing.buffer_minutes = payload.buffer_minutes
            db.commit()
            db.refresh(existing)
        return _to_participant_out(existing)

    # 신규 등록
    p = models.Participant(
        meeting_id=m.id,
        nickname=payload.nickname,
        pin_hash=incoming_hash,
        buffer_minutes=payload.buffer_minutes,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _to_participant_out(p)


def _hash_pin(pin: Optional[str]) -> Optional[str]:
    """평문 PIN → SHA-256 hex. None이면 None."""
    if not pin:
        return None
    return hashlib.sha256(pin.encode("utf-8")).hexdigest()


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

    # 회의 모드와 스위치 가능 여부
    is_any = m.location_type == "any"
    primary_mode = "online" if is_any else m.location_type  # 기본은 online (any일 때도)

    # 참여자가 0명이면 의미가 없으니 안내만 반환
    if not participants:
        return schemas.RecommendationOut(
            timetable=[], candidates=[], total_participants=0,
            note="아직 참여자가 없습니다. 초대 링크를 공유해 주세요.",
            mode=primary_mode, switchable=is_any,
            alt_mode="offline" if is_any else None,
            alt_timetable=[] if is_any else None,
            alt_candidates=[] if is_any else None,
        )

    # 1) 슬롯 만들기 (15분 단위)
    start_date = datetime.fromisoformat(m.start_date).date()
    end_date = datetime.fromisoformat(m.end_date).date()
    slots = availability.build_slots(
        start_date, end_date, m.work_start_hour, m.work_end_hour
    )

    # 2) 참여자별 BusyBlock + 본인 버퍼 모으기
    pbs: List[availability.ParticipantBusy] = []
    for p in participants:
        pbs.append(
            availability.ParticipantBusy(
                nickname=p.nickname,
                busy=[(b.start, b.end) for b in p.busy_blocks],
                buffer_minutes=p.buffer_minutes or 0,
            )
        )

    # 3) 모드별 계산 함수 — primary, (any인 경우) offline 둘 다 동일 로직
    #    버퍼는 ParticipantBusy 안에 들어 있으므로 build_timetable 인자에서 제거됨.
    def calc(mode_str: str):
        cells = availability.build_timetable(pbs, slots, mode_str)
        cand = candidate_ranker.rank_candidates(
            cells, m.duration_minutes, len(participants), max_candidates=3
        )
        return cells, cand

    p_cells, p_cands = calc(primary_mode)

    alt_mode = None
    alt_cells = None
    alt_cands = None
    if is_any:
        alt_mode = "offline"
        alt_cells, alt_cands = calc("offline")

    note = None
    if not p_cands and not (alt_cands or []):
        # 기획서 4.5: 후보가 없으면 조건 완화 제안
        note = (
            "조건을 모두 만족하는 후보가 없습니다. "
            "회의 길이를 줄이거나 후보 기간을 넓혀 주세요."
        )

    def _cells(cs):
        return [
            schemas.TimetableCell(
                start=c.start, end=c.end,
                available_count=c.available_count,
                available_nicknames=c.available_nicknames,
            ) for c in cs
        ]

    def _cands(cs):
        return [
            schemas.CandidateSlot(
                start=c.start, end=c.end,
                available_nicknames=c.available_nicknames,
                reasons=c.reasons,
            ) for c in cs
        ]

    return schemas.RecommendationOut(
        timetable=_cells(p_cells),
        candidates=_cands(p_cands),
        total_participants=len(participants),
        note=note,
        mode=primary_mode,
        switchable=is_any,
        alt_mode=alt_mode,
        alt_timetable=_cells(alt_cells) if alt_cells is not None else None,
        alt_candidates=_cands(alt_cands) if alt_cands is not None else None,
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
        buffer_minutes=p.buffer_minutes or 0,
        busy_blocks=[
            schemas.TimeRange(start=b.start, end=b.end) for b in p.busy_blocks
        ],
    )
