"""
=============================================================
google_calendar.py — Google Calendar Adapter
-------------------------------------------------------------
[원칙 — 기획서 4.4]
- free/busy 조회 권한만 사용. 이벤트 제목/장소/설명은 절대 읽지 않음.
- OAuth 토큰 장기 저장 금지. 호출 시 받은 토큰을 메모리에서만 사용.

[MVP 구현 전략]
- 실제 OAuth 2.0 플로우는 배포 단계 작업이므로,
  여기서는 "어댑터 인터페이스"만 정의하고
  토큰 / 캘린더 ID 가 주어지면 표준 free/busy 엔드포인트를 호출합니다.
- 토큰이 비어 있으면(개발 모드) 빈 리스트를 반환해
  프론트가 '직접 입력' 또는 '.ics' 흐름으로 폴백할 수 있게 합니다.

[참고 엔드포인트]
- POST https://www.googleapis.com/calendar/v3/freeBusy
- 요청 본문: { timeMin, timeMax, items: [{id: <calendarId>}] }
=============================================================
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Tuple

import httpx


GOOGLE_FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy"


def fetch_freebusy(
    access_token: str,
    calendar_id: str,
    time_min: datetime,
    time_max: datetime,
    timeout: float = 10.0,
) -> List[Tuple[datetime, datetime]]:
    """
    [입력]
      - access_token: OAuth 2.0 액세스 토큰
      - calendar_id : 보통 'primary' 또는 사용자의 이메일
      - time_min/max: 조회 범위
    [출력]
      - busy 구간 리스트 [(start, end), ...] (naive datetime, 로컬 가정)
    [실패]
      - 토큰 누락 → 빈 리스트(폴백 가능 신호)
      - HTTP 오류 → 예외로 던져 라우터에서 400 처리
    """
    if not access_token:
        return []

    payload = {
        "timeMin": _to_rfc3339(time_min),
        "timeMax": _to_rfc3339(time_max),
        "items": [{"id": calendar_id}],
    }
    headers = {"Authorization": f"Bearer {access_token}"}

    with httpx.Client(timeout=timeout) as client:
        resp = client.post(GOOGLE_FREEBUSY_URL, json=payload, headers=headers)
    if resp.status_code != 200:
        raise RuntimeError(
            f"Google Calendar free/busy 호출 실패: {resp.status_code} {resp.text[:200]}"
        )

    data = resp.json()
    busy_raw = (
        data.get("calendars", {}).get(calendar_id, {}).get("busy", [])
    )

    # Google이 ISO 8601 (UTC, 'Z' suffix)로 반환합니다.
    # MVP에서는 시간대 일치 가정(로컬=UTC가 아님에 유의) — 실제 배포 시
    # 사용자 timezone 옵션을 받아 정밀 변환하세요.
    blocks: List[Tuple[datetime, datetime]] = []
    for item in busy_raw:
        s = _from_rfc3339(item["start"])
        e = _from_rfc3339(item["end"])
        if e > s:
            blocks.append((s, e))
    return blocks


# -------------------------------------------------------------
# RFC3339 (ISO 8601) <-> naive datetime 변환 헬퍼
# -------------------------------------------------------------
def _to_rfc3339(dt: datetime) -> str:
    # naive datetime을 'Z' 접미사로 보내면 UTC로 해석됩니다.
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _from_rfc3339(s: str) -> datetime:
    # 끝의 Z를 제거하고 마이크로초 무시
    s = s.rstrip("Z").split(".")[0]
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%S")
