"""
=============================================================
ics_parser.py — .ics 파일 → 익명화된 BusyBlock 리스트
-------------------------------------------------------------
[원칙 — 기획서 4.4]
- VEVENT의 SUMMARY/LOCATION/DESCRIPTION 등은 절대 읽지 않습니다.
- 우리에게 필요한 건 (시작, 종료) 두 값뿐.

[지원 범위]
- 단일/반복 이벤트 모두 DTSTART/DTEND를 그대로 인정합니다.
- TRANSP=TRANSPARENT (예: '한가함' 표시 일정)는 busy 아님으로 간주해 제외합니다.
  (Google Calendar에서 "Free"로 표시한 이벤트와 동일 의미)
- DTEND가 없으면 기본 1시간으로 가정합니다(.ics 사양 허용).
- 시간대 정보가 있으면 naive(local-naive)로 변환해 통일합니다.
=============================================================
"""

from __future__ import annotations

from datetime import datetime, timedelta, date as _date
from typing import List, Tuple

from icalendar import Calendar


# -------------------------------------------------------------
# [SECTION 1] 진입점 — 바이트 → BusyBlock 튜플 리스트
# -------------------------------------------------------------
def parse_ics_to_busy(content: bytes) -> List[Tuple[datetime, datetime]]:
    """
    .ics 파일 바이트를 받아 (start, end) 튜플 리스트를 반환.
    실패 시 ValueError 를 발생시킵니다(라우터에서 400으로 변환).
    """
    try:
        cal = Calendar.from_ical(content)
    except Exception as e:
        raise ValueError(f"잘못된 .ics 파일입니다: {e}")

    blocks: List[Tuple[datetime, datetime]] = []

    for component in cal.walk():
        if component.name != "VEVENT":
            continue

        # TRANSP가 TRANSPARENT면 free, 아니면 busy로 본다.
        transp = str(component.get("transp", "OPAQUE")).upper()
        if transp == "TRANSPARENT":
            continue

        dtstart = component.get("dtstart")
        dtend = component.get("dtend")
        if dtstart is None:
            continue

        start = _to_naive_dt(dtstart.dt)
        if dtend is not None:
            end = _to_naive_dt(dtend.dt)
        else:
            # DTEND 없으면 1시간 기본값(.ics 사양에서 허용)
            end = start + timedelta(hours=1)

        # all-day 이벤트면 자정~다음날 자정으로 두되, busy 처리는 포함
        if end <= start:
            continue

        blocks.append((start, end))

    return _merge_overlaps(blocks)


# -------------------------------------------------------------
# [SECTION 2] 보조 함수 — 시간대 통일, 겹침 병합
# -------------------------------------------------------------
def _to_naive_dt(value) -> datetime:
    """
    datetime/date 모두 들어올 수 있음.
    - datetime이면 tz를 떼고 naive로.
    - date(=하루 종일 일정)이면 그날 00:00으로.
    """
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            # 타임존이 있으면 UTC 기준으로 떼지 말고, 그냥 좌표만 유지(local-naive로 사용).
            # 더 엄밀히 하려면 사용자 시간대 옵션을 받아 변환해야 합니다.
            value = value.replace(tzinfo=None)
        return value
    if isinstance(value, _date):
        return datetime(value.year, value.month, value.day, 0, 0, 0)
    raise ValueError(f"지원하지 않는 시간 값: {value!r}")


def _merge_overlaps(
    blocks: List[Tuple[datetime, datetime]],
) -> List[Tuple[datetime, datetime]]:
    """겹치거나 인접한 블록을 합쳐 후속 계산을 단순하게 만듭니다."""
    if not blocks:
        return []
    blocks = sorted(blocks)
    merged = [blocks[0]]
    for s, e in blocks[1:]:
        ms, me = merged[-1]
        if s <= me:                       # 겹침/인접
            merged[-1] = (ms, max(me, e))
        else:
            merged.append((s, e))
    return merged
