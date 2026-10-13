"""Sim clock. Every date an agent sees comes from here, never from the real clock (SPEC 3.4)."""

from __future__ import annotations

import calendar as _calendar
import re
from datetime import date

_MONTH = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")


def parse_month(month: str) -> tuple[int, int]:
    match = _MONTH.match(month)
    if not match:
        raise ValueError(f"sim month must look like YYYY-MM: {month!r}")
    return int(match.group(1)), int(match.group(2))


def add_months(month: str, count: int) -> str:
    year, mon = parse_month(month)
    index = year * 12 + (mon - 1) + count
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def months_between(start: str, end: str) -> int:
    """Whole months from start to end (end - start)."""
    y1, m1 = parse_month(start)
    y2, m2 = parse_month(end)
    return (y2 * 12 + m2) - (y1 * 12 + m1)


def month_index(start: str, month: str) -> int:
    """1-based position of `month` in a run that starts at `start`."""
    return months_between(start, month) + 1


def meeting_date(month: str) -> date:
    """Committee meets on the second Tuesday of each month."""
    year, mon = parse_month(month)
    tuesdays = [
        week[_calendar.TUESDAY] for week in _calendar.monthcalendar(year, mon) if week[_calendar.TUESDAY]
    ]
    return date(year, mon, tuesdays[1])


def day_in_month(month: str, day: int) -> date:
    year, mon = parse_month(month)
    last = _calendar.monthrange(year, mon)[1]
    return date(year, mon, max(1, min(day, last)))


def long_date(value: date) -> str:
    return f"{value.strftime('%B')} {value.day}, {value.year}"


def month_name(month: str) -> str:
    year, mon = parse_month(month)
    return f"{_calendar.month_name[mon]} {year}"


def quarter_of(month: str) -> int:
    return (parse_month(month)[1] - 1) // 3 + 1
