"""
=============================================================
candidate_ranker.py — 후보 시간 추천기
-------------------------------------------------------------
[입력]
- timetable cells (30분 단위, 슬롯별 가용 인원)
- duration_minutes (회의 길이)
- max_candidates (최대 후보 수, 기획서에선 3개)

[알고리즘]
1) 회의 길이를 30분 단위 슬롯 수(span)로 환산
   - 잘 맞아떨어지지 않으면 천장값(올림) 사용. 즉, 60분이면 2슬롯.
2) 연속한 span 슬롯 모두에서 '같은 인원이 가능'한 구간을 찾는다.
3) 점수 계산:
   - 우선 인원 수가 많을수록 좋음 (전원 가능 = 최고)
   - 동률이면 더 이른 시각이 우선
4) 동일 시작점이 후보 여러 개로 겹치지 않게 NMS 비슷한 처리(겹치면 점수 높은 것만 유지).
5) 상위 N개 반환.

[추천 이유 — 기획서 4.3]
- "참여자 전원이 가능함" / "요청한 회의 길이를 만족함"
- "입력한 날짜 범위 안에 있음" 같이 검증 가능한 사실만 사용.
- 일정 제목/장소/설명은 어디에도 등장하지 않음.
=============================================================
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from typing import List

from .availability import SLOT_MINUTES, TimetableCell


@dataclass
class CandidateSlot:
    start: datetime
    end: datetime
    available_nicknames: List[str]
    reasons: List[str]


# -------------------------------------------------------------
# [SECTION 1] 메인 진입점
# -------------------------------------------------------------
def rank_candidates(
    timetable: List[TimetableCell],
    duration_minutes: int,
    total_participants: int,
    max_candidates: int = 3,
) -> List[CandidateSlot]:
    if not timetable or duration_minutes <= 0 or total_participants <= 0:
        return []

    span = max(1, math.ceil(duration_minutes / SLOT_MINUTES))
    n = len(timetable)

    raw: List[CandidateSlot] = []

    # 슬라이딩 윈도우로 (start..start+span) 구간 검사
    for i in range(0, n - span + 1):
        window = timetable[i : i + span]

        # 윈도우 내 슬롯이 시간상 인접해야 함 (날짜 경계 등에서 깨질 수 있음)
        if not _is_continuous(window):
            continue

        # 윈도우 전체에서 '동시 가능'한 닉네임 = 각 슬롯 가용자 집합의 교집합
        common: set = set(window[0].available_nicknames)
        for cell in window[1:]:
            common &= set(cell.available_nicknames)
            if not common:
                break
        if not common:
            continue

        start = window[0].start
        end = window[-1].end
        reasons = _build_reasons(
            common_count=len(common),
            total=total_participants,
            duration_minutes=duration_minutes,
            actual_minutes=int((end - start).total_seconds() // 60),
        )
        raw.append(
            CandidateSlot(
                start=start,
                end=end,
                available_nicknames=sorted(common),
                reasons=reasons,
            )
        )

    if not raw:
        return []

    # [SECTION 2] 점수 정렬: 인원 많을수록 ↑, 같으면 이른 시각 ↑
    raw.sort(key=lambda c: (-len(c.available_nicknames), c.start))

    # [SECTION 3] 겹침 제거 — 같은 시간대를 여러 후보로 채우지 않음
    picked: List[CandidateSlot] = []
    for c in raw:
        if all(not _overlap(c, p) for p in picked):
            picked.append(c)
        if len(picked) >= max_candidates:
            break
    return picked


# -------------------------------------------------------------
# [SECTION 4] 보조 함수
# -------------------------------------------------------------
def _is_continuous(window: List[TimetableCell]) -> bool:
    for a, b in zip(window, window[1:]):
        if a.end != b.start:
            return False
    return True


def _overlap(a: CandidateSlot, b: CandidateSlot) -> bool:
    return a.start < b.end and b.start < a.end


def _build_reasons(
    common_count: int,
    total: int,
    duration_minutes: int,
    actual_minutes: int,
) -> List[str]:
    """검증 가능한 이유 문장만 생성 (기획서 4.3 — 일정 세부 내용 언급 금지)."""
    reasons: List[str] = []
    if common_count == total:
        reasons.append("참여자 전원이 가능함")
    else:
        reasons.append(f"참여자 {common_count}/{total}명 가능")
    if actual_minutes >= duration_minutes:
        reasons.append("요청한 회의 길이를 만족함")
    reasons.append("입력한 날짜 범위 안에 있음")
    return reasons
