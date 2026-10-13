"""Monthly outcome report for the committee (SPEC 6.1 step 6): partial, sometimes delayed, sometimes wrong."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from govern import prompts
from govern.calendar import add_months, month_name, quarter_of
from sim.engine.rng import RNG
from sim.engine.state import CompanyState

STATUS_LABELS = {"building": "In delivery", "live": "In production", "paused": "Paused", "retired": "Retired"}


@dataclass(frozen=True)
class OutcomeReport:
    text: str
    reported: Mapping[str, Any]


def _money(value: float) -> str:
    return f"${value:,.0f}"


def _delay(rng: RNG, month: str, key: str, params: Mapping[str, Any]) -> int:
    weights = [params["report_delay_months"][k] for k in ("p0", "p1", "p2")]
    return int(rng.draw("report_delay", "choice", {"weights": weights}, sim_month=month, key=(key,)))


def build_report(history: Mapping[str, CompanyState], *, report_month: str, rng: RNG,
                 params: Mapping[str, Any], bank_name: str) -> OutcomeReport:
    """history must contain the month before report_month; earlier months are used for delayed figures."""
    latest_month = add_months(report_month, -1)
    latest = history[latest_month]
    noise = params["report_noise"]
    rows, lines = [], []
    for project in sorted(latest.projects, key=lambda p: p.approved_month):
        delay = _delay(rng, report_month, project.use_case_id, noise)
        as_of = add_months(latest_month, -delay)
        snapshot = history.get(as_of)
        source = snapshot.project(project.use_case_id) if snapshot else None
        revenue = source.revenue_last_month if source else 0.0
        factor = rng.draw("report_revenue_error", "normal", {"mean": 1.0, "sd": noise["revenue_estimate_error_sd"]},
                          sim_month=report_month, key=(project.use_case_id,))
        reported_revenue = max(0.0, revenue * factor)
        progress = min(100.0, 100.0 * project.person_weeks_done / project.plan.estimated_person_weeks)
        row = {
            "use_case_id": project.use_case_id, "title": project.title, "status": project.status,
            "reported_revenue_month": round(reported_revenue, -2), "revenue_as_of": as_of if source else None,
            "effort_spent_pct_of_estimate": round(progress), "cost_last_month": round(project.cost_last_month, -2),
        }
        rows.append(row)
        detail = f"{STATUS_LABELS[project.status]}"
        if project.status == "building":
            detail += f"; effort to date {row['effort_spent_pct_of_estimate']}% of original estimate"
        if project.status == "live":
            revenue_note = "not yet available" if not source else f"{_money(row['reported_revenue_month'])} ({month_name(as_of)} figures)"
            detail += f"; attributed revenue {revenue_note}"
        lines.append(f"- {project.title}: {detail}; cost last month {_money(row['cost_last_month'])}")

    fin, risk = latest.financials, latest.risk
    incidents = latest.incidents_in(latest_month)
    reported = {
        "use_cases": rows,
        "ai_spend_last_month": round(fin.ai_spend_monthly, -2),
        "ai_spend_to_date": round(fin.ai_spend_to_date, -2),
        "ai_budget_remaining": round(fin.ai_budget_remaining, -2),
        "complaint_rate_per_10k": round(risk.customer_complaint_rate, 1),
        "incidents_last_month": [{"use_case_id": i.use_case_id, "severity": i.severity, "kind": i.kind} for i in incidents],
        "engineering_capacity_used_pct": round(100 * latest.technology.capacity_used_last_month
                                               / latest.technology.engineering_capacity_person_weeks_per_month),
    }
    if quarter_of(report_month) != quarter_of(latest_month):
        survey = latest.people.shadow_ai_usage_rate * rng.draw("survey_error", "normal", {"mean": 1.0, "sd": 0.2},
                                                               sim_month=report_month)
        reported["staff_survey_unapproved_ai_tool_use"] = round(max(0.0, survey) * 100)

    incident_lines = [f"- {i['kind'].replace('_', ' ')} ({i['severity']} severity) linked to "
                      f"{next((r['title'] for r in rows if r['use_case_id'] == i['use_case_id']), 'an AI initiative')}"
                      for i in reported["incidents_last_month"]] or ["- None reported"]
    survey_line = (f"\nQuarterly staff technology survey: {reported['staff_survey_unapproved_ai_tool_use']}% of respondents "
                   f"report using AI tools the bank has not approved." if "staff_survey_unapproved_ai_tool_use" in reported else "")
    text = prompts.render(
        "committee/outcome_report.md",
        bank_name=bank_name,
        period=month_name(latest_month),
        initiatives="\n".join(lines) or "- No approved AI initiatives yet",
        spend_last_month=_money(reported["ai_spend_last_month"]),
        spend_to_date=_money(reported["ai_spend_to_date"]),
        budget_remaining=_money(reported["ai_budget_remaining"]),
        capacity_used=reported["engineering_capacity_used_pct"],
        complaint_rate=reported["complaint_rate_per_10k"],
        incidents="\n".join(incident_lines),
        survey=survey_line,
    )
    return OutcomeReport(text=text, reported=reported)
