"""Company state (SPEC 3.3): hidden from committee members, advanced only by the reality engine."""

from __future__ import annotations

from typing import Any, Literal, Mapping

from pydantic import BaseModel, ConfigDict

Severity = Literal["low", "medium", "high"]
ProjectStatus = Literal["building", "live", "paused", "retired"]


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class Plan(_Frozen):
    """Sampled parameters for one approved use case."""
    delivery: Literal["vendor_saas", "custom_build"]
    risk_tier: Severity
    estimated_person_weeks: float
    actual_person_weeks: float
    one_time_cost_usd: float
    run_cost_per_month_usd: float
    revenue_per_month_full_usd: float
    adoption_peak: float
    months_to_peak: float
    incident_prob_per_month: float
    severity_mix: Mapping[str, float]
    fair_lending_exposure_change: float
    complaint_rate_change_per_10k: float


class Project(_Frozen):
    use_case_id: str
    title: str
    status: ProjectStatus
    customer_facing: bool
    credit_decision: bool
    staff_genai_tool: bool
    plan: Plan
    person_weeks_done: float = 0.0
    build_months: int = 0
    live_months: int = 0
    one_time_cost_spent: float = 0.0
    revenue_last_month: float = 0.0
    cost_last_month: float = 0.0
    approved_month: str
    live_month: str | None = None


class Incident(_Frozen):
    incident_id: str
    use_case_id: str | None
    sim_month: str
    severity: Severity
    kind: str
    resolved_month: str | None = None


class Financials(_Frozen):
    revenue_monthly_base: float
    revenue_monthly: float = 0.0
    ai_revenue_monthly: float = 0.0
    ai_revenue_to_date: float = 0.0
    ai_budget_annual: float
    ai_budget_remaining: float
    ai_spend_monthly: float = 0.0
    ai_spend_to_date: float = 0.0


class People(_Frozen):
    headcount_by_dept: Mapping[str, int]
    ai_skill_level_by_dept: Mapping[str, int]
    morale_index: float
    shadow_ai_usage_rate: float


class Technology(_Frozen):
    systems: tuple[Mapping[str, Any], ...]
    data_quality_score: float
    engineering_capacity_person_weeks_per_month: float
    capacity_used_last_month: float = 0.0


class Risk(_Frozen):
    customer_complaint_rate_baseline: float
    customer_complaint_rate: float
    complaint_excess: float = 0.0            # short-term complaints from incidents; decays monthly
    fair_lending_exposure_score: float
    incidents: tuple[Incident, ...] = ()
    open_regulatory_findings: tuple[str, ...] = ()
    last_targeted_review_month: str | None = None


class CompanyState(_Frozen):
    sim_month: str
    financials: Financials
    people: People
    technology: Technology
    risk: Risk
    projects: tuple[Project, ...] = ()
    customers: int
    public_sentiment: float

    def project(self, use_case_id: str) -> Project | None:
        return next((p for p in self.projects if p.use_case_id == use_case_id), None)

    def with_project(self, project: Project) -> "CompanyState":
        others = tuple(p for p in self.projects if p.use_case_id != project.use_case_id)
        return self.model_copy(update={"projects": others + (project,)})

    def incidents_in(self, month: str) -> tuple[Incident, ...]:
        return tuple(i for i in self.risk.incidents if i.sim_month == month)


def initial_state(profile: Mapping[str, Any], start_month: str) -> CompanyState:
    fin, people, tech, risk = profile["financials"], profile["people"], profile["technology"], profile["risk"]
    return CompanyState(
        sim_month=start_month,
        financials=Financials(
            revenue_monthly_base=fin["revenue_monthly_base"],
            revenue_monthly=fin["revenue_monthly_base"],
            ai_budget_annual=fin["ai_budget_annual"],
            ai_budget_remaining=fin["ai_budget_remaining"],
            ai_spend_to_date=fin.get("ai_spend_to_date", 0.0),
            ai_revenue_to_date=fin.get("ai_revenue_to_date", 0.0),
        ),
        people=People(
            headcount_by_dept=dict(people["headcount_by_dept"]),
            ai_skill_level_by_dept=dict(people["ai_skill_level_by_dept"]),
            morale_index=people["morale_index"],
            shadow_ai_usage_rate=people["shadow_ai_usage_rate"],
        ),
        technology=Technology(
            systems=tuple(tech["systems"]),
            data_quality_score=tech["data_quality_score"],
            engineering_capacity_person_weeks_per_month=tech["engineering_capacity_person_weeks_per_month"],
        ),
        risk=Risk(
            customer_complaint_rate_baseline=risk["customer_complaint_rate_baseline"],
            customer_complaint_rate=risk["customer_complaint_rate"],
            fair_lending_exposure_score=risk["fair_lending_exposure_score"],
        ),
        customers=profile["customers"],
        public_sentiment=profile["reputation"]["public_sentiment"],
    )
