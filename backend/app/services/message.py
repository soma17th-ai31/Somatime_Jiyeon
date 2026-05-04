"""
=============================================================
message.py — 회의 안내 메시지 초안 생성
-------------------------------------------------------------
[원칙 — 기획서 3.2-11, 2.4]
- '초안'만 만들고 외부 발송은 절대 하지 않습니다.
- 사용자가 복사 버튼을 눌러 직접 메신저/이메일에 공유합니다.
- 일정 세부 내용(제목 외)은 메시지에 포함되지 않습니다.
=============================================================
"""

from __future__ import annotations

from datetime import datetime


WEEKDAY_KO = ["월", "화", "수", "목", "금", "토", "일"]


def build_invite_message(
    title: str,
    start: datetime,
    end: datetime,
    location_type: str,
    nicknames: list[str],
) -> str:
    loc = {"online": "온라인", "offline": "오프라인", "any": "온/오프라인 무관"}.get(
        location_type, location_type
    )
    when = _format_kr_time(start, end)
    who = ", ".join(nicknames) if nicknames else "참여자"

    return (
        f"[{title}] 회의 시간이 확정되었습니다.\n"
        f"- 일시: {when}\n"
        f"- 형태: {loc}\n"
        f"- 참여: {who}\n"
        f"\n"
        f"※ 본 메시지는 소마밋(SomaMeet)에서 자동 생성된 초안입니다. "
        f"확인 후 직접 공유해 주세요."
    )


def _format_kr_time(start: datetime, end: datetime) -> str:
    """예: 2026-05-12(화) 14:00 ~ 15:30"""
    weekday = WEEKDAY_KO[start.weekday()]
    same_day = start.date() == end.date()
    if same_day:
        return (
            f"{start.strftime('%Y-%m-%d')}({weekday}) "
            f"{start.strftime('%H:%M')} ~ {end.strftime('%H:%M')}"
        )
    return (
        f"{start.strftime('%Y-%m-%d %H:%M')} ~ {end.strftime('%Y-%m-%d %H:%M')}"
    )
