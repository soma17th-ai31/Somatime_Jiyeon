"""
=============================================================
availability.py — 가용성 엔진 (Intersection + Travel Buffer)
-------------------------------------------------------------
[책임]
1) 30분 단위 슬롯으로 시간 축을 만든다 (기획서 3.4).
2) 참여자별 BusyBlock에 '버퍼'를 붙여 effective busy 로 확장한다
   - 오프라인: 회의 길이만큼이 아니라 '슬롯 양옆'에 buffer_minutes 적용 (기획서 3.2-6, 5.2)
   - 온라인 / any : 버퍼 없음 (any 는 온라인 기준)
3) 각 슬롯에서 "가능한 닉네임 집합"을 계산한다 (= 인원 카운트).
4) 위 결과를 timetable cell 리스트로 반환한다.

[정의 — 가능 슬롯]
"슬롯 [s, s+SLOT_MINUTES) 가 사용자 X에게 가능하다" ⇔
  X의 effective-busy 어떤 블록도 [s, s+SLOT_MINUTES) 와 겹치지 않는다.

[효율성 메모]
- MVP 인원(3-7명) × 일주일 × 30분 슬롯 = 수백 셀 수준.
  단순 O(N*B)로도 충분히 빠릅니다. 가독성을 우선합니다.
=============================================================
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Dict, List, Sequence, Tuple


SLOT_MINUTES = 30  # 기획서 3.4: "Intersection Engine ... 30분 단위"


# -------------------------------------------------------------
# [SECTION 1] 입력 컨테이너
# -------------------------------------------------------------
@dataclass
class ParticipantBusy:
    nickname: str
    busy: List[Tuple[datetime, datetime]]   # 합쳐진(merged) 바쁜 블록


@dataclass
class TimetableCell:
    start: datetime
    end: datetime
    available_nicknames: List[str]

    @property
    def available_count(self) -> int:
        return len(self.available_nicknames)


# -------------------------------------------------------------
# [SECTION 2] 슬롯 그리드 만들기
# -------------------------------------------------------------
def build_slots(
    start_date: date,
    end_date: date,
    work_start_hour: int,
    work_end_hour: int,
) -> List[Tuple[datetime, datetime]]:
    """후보 기간 × 일과 시간(work hours)을 30분 단위로 잘라 슬롯 리스트로 반환."""
    slots: List[Tuple[datetime, datetime]] = []
    day = start_date
    one_slot = timedelta(minutes=SLOT_MINUTES)
    while day <= end_date:
        cur = datetime(day.year, day.month, day.day, work_start_hour, 0)
        end_of_day = datetime(day.year, day.month, day.day, work_end_hour, 0)
        while cur + one_slot <= end_of_day:
            slots.append((cur, cur + one_slot))
            cur += one_slot
        day += timedelta(days=1)
    return slots


# -------------------------------------------------------------
# [SECTION 3] 버퍼 적용 — Travel Buffer Applier
# -------------------------------------------------------------
def apply_buffer(
    busy: Sequence[Tuple[datetime, datetime]],
    buffer_minutes: int,
    location_type: str,
) -> List[Tuple[datetime, datetime]]:
    """
    오프라인 회의일 때만 각 busy 블록의 양옆을 buffer_minutes 만큼 확장합니다.
    예: 13:00-14:00 일정 + 30분 버퍼 → 12:30-14:30 가 'busy로 간주'됨.
    온라인/any 는 그대로 반환합니다(기획서 3.2-6).
    """
    if location_type != "offline" or buffer_minutes <= 0 or not busy:
        # 그래도 정렬/병합은 한번 해 둡니다.
        return _merge(list(busy))

    delta = timedelta(minutes=buffer_minutes)
    expanded = [(s - delta, e + delta) for s, e in busy]
    return _merge(expanded)


def _merge(blocks: List[Tuple[datetime, datetime]]) -> List[Tuple[datetime, datetime]]:
    if not blocks:
        return []
    blocks.sort()
    out = [blocks[0]]
    for s, e in blocks[1:]:
        ms, me = out[-1]
        if s <= me:
            out[-1] = (ms, max(me, e))
        else:
            out.append((s, e))
    return out


# -------------------------------------------------------------
# [SECTION 4] 타임테이블 빌드 — 슬롯별 가용 인원
# -------------------------------------------------------------
def build_timetable(
    participants: List[ParticipantBusy],
    slots: List[Tuple[datetime, datetime]],
    buffer_minutes: int,
    location_type: str,
) -> List[TimetableCell]:
    """슬롯마다 어떤 닉네임이 가능한지를 채워 셀 목록을 반환."""

    # 1) 참여자별 effective-busy 미리 계산
    effective: Dict[str, List[Tuple[datetime, datetime]]] = {}
    for p in participants:
        effective[p.nickname] = apply_buffer(p.busy, buffer_minutes, location_type)

    cells: List[TimetableCell] = []
    for s_start, s_end in slots:
        avail: List[str] = []
        for nick, busy in effective.items():
            if not _overlaps_any(s_start, s_end, busy):
                avail.append(nick)
        cells.append(TimetableCell(s_start, s_end, avail))
    return cells


def _overlaps_any(
    s: datetime, e: datetime, busy: List[Tuple[datetime, datetime]]
) -> bool:
    """선형 스캔: busy 중 [s, e) 와 겹치는 게 하나라도 있으면 True.
    O(N) — busy가 정렬돼 있다면 이진탐색도 가능하지만 MVP에선 충분."""
    for bs, be in busy:
        if bs < e and s < be:   # 표준 구간 겹침 판정
            return True
    return False
