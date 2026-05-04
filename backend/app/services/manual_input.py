"""
=============================================================
manual_input.py — '직접 입력' 정규화기
-------------------------------------------------------------
- 사용자가 폼에서 입력한 (start, end) 블록 리스트를 받아
  서로 겹치는 구간을 합쳐 깨끗한 BusyBlock 으로 만듭니다.
- 단순 함수지만, 입력 경로 3종이 모두 같은 형태로 정규화되도록
  ics_parser._merge_overlaps 와 동일한 책임을 명시적으로 분리합니다.
=============================================================
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Tuple


def normalize_manual_blocks(
    blocks: List[Tuple[datetime, datetime]],
) -> List[Tuple[datetime, datetime]]:
    """직접 입력 블록 정규화: 잘못된 순서 제거 + 겹침 병합."""
    cleaned = [(s, e) for s, e in blocks if e > s]
    if not cleaned:
        return []

    cleaned.sort()
    merged = [cleaned[0]]
    for s, e in cleaned[1:]:
        ms, me = merged[-1]
        if s <= me:
            merged[-1] = (ms, max(me, e))
        else:
            merged.append((s, e))
    return merged
