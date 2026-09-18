"""Human-convened meetings: the agenda is given, advisory items are heard, nothing applies without attestation."""

from __future__ import annotations

import pytest

from conftest import REPO_ROOT
from govern.advisory import perspectives_for, synthesis_for
from govern.config import load_config
from govern.db import Database
from sim.demo_llm import DemoAnthropic
from govern.llm import LLMClient
from govern.meeting import STANDING_ITEMS, Meeting, next_meeting_id
from sim.orchestrator import Orchestrator
from govern.packet import AgendaItem
from sim.setup import create_experiment
from sim.world import load_world

MONTH = "2027-01"


@pytest.fixture(scope="module")
def convened(tmp_path_factory):
    """One month advanced normally, then a second meeting convened by hand in the same month."""
    data_dir = tmp_path_factory.mktemp("convened")
    db = Database.connect_sqlite(data_dir / "sim.sqlite")
    db.migrate(REPO_ROOT / "db" / "migrations")
    config, world = load_config(REPO_ROOT / "config"), load_world(REPO_ROOT / "config")
    llm = LLMClient(db=db, config=config, client=DemoAnthropic(), sleep=lambda s: None)
    orch = Orchestrator(db=db, world=world, config=config, llm=llm, data_dir=data_dir)
    run_id = create_experiment(db, world, config, name="convened", replicates=1, seed=7, data_dir=data_dir)[0]
    orch.advance(run_id)
    return db, orch, run_id


# ---- meeting ids ----------------------------------------------------------


def test_first_meeting_in_a_month_keeps_the_established_id(db, run_id):
    assert next_meeting_id(db, run_id, MONTH) == f"{run_id}/meeting/{MONTH}"


def test_a_second_meeting_in_the_same_month_gets_its_own_id(db, run_id):
    db.insert("meetings", {"meeting_id": f"{run_id}/meeting/{MONTH}", "run_id": run_id, "bank_id": "calder_ridge",
                           "sim_month": MONTH, "meeting_date": "2027-01-12", "agenda": [], "status": "closed"})
    assert next_meeting_id(db, run_id, MONTH) == f"{run_id}/meeting/{MONTH}-2"


# ---- agenda resolution ----------------------------------------------------


def test_a_derived_agenda_still_carries_the_standing_items(convened):
    db, orch, run_id = convened
    meeting = Meeting(orch.context(run_id), "2027-02")
    assert meeting.convened is False
    assert list(meeting.agenda())[:len(STANDING_ITEMS)] == list(STANDING_ITEMS)


def test_a_given_agenda_is_used_verbatim(convened):
    db, orch, run_id = convened
    advisory = AgendaItem("ADV-001", "advisory", "Where should model risk oversight sit?")
    meeting = Meeting(orch.context(run_id), "2027-02", agenda=[advisory])
    assert meeting.convened is True
    assert meeting.agenda() == [advisory]
    assert all(i not in meeting.agenda() for i in STANDING_ITEMS)


def test_a_given_agenda_drops_items_that_are_no_longer_open(convened):
    db, orch, run_id = convened
    stale = AgendaItem("UC-999", "use_case", "Decided last month", f"{run_id}/uc/gone")
    meeting = Meeting(orch.context(run_id), "2027-02", agenda=[stale])
    assert meeting.agenda() == []


# ---- a convened meeting ---------------------------------------------------


@pytest.fixture(scope="module")
def held(convened):
    db, orch, run_id = convened
    advisory = AgendaItem("ADV-001", "advisory", "Where should model risk oversight sit?")
    result = orch.convene(run_id, agenda=[advisory])
    return db, run_id, result


def test_convening_holds_a_meeting_and_closes_it(held):
    db, run_id, result = held
    row = db.fetch_one("SELECT status FROM meetings WHERE meeting_id = ?", (result.meeting_id,))
    assert row["status"] == "closed"
    assert result.meeting_id.endswith("-2")


def test_every_seat_files_a_perspective_on_the_advisory_item(held):
    db, run_id, result = held
    filed = perspectives_for(db, result.meeting_id, "ADV-001")
    assert len(filed) == 8
    assert all(1 <= p.stance <= 5 for p in filed)
    assert all(p.would_change_my_mind for p in filed)


def test_the_advisory_item_is_synthesised_and_takes_no_vote(held):
    db, run_id, result = held
    synthesis = synthesis_for(db, result.meeting_id, "ADV-001")
    assert synthesis is not None
    assert synthesis.checks
    assert db.fetch_one("SELECT COUNT(*) AS n FROM votes WHERE meeting_id = ?",
                        (result.meeting_id,))["n"] == 0
    assert result.decisions == ()


def test_a_convened_meeting_applies_nothing_without_attestation(convened):
    """The committee recommends; apply_attested is what makes it real."""
    db, orch, run_id = convened
    ref = f"{run_id}/uc/gate-check"
    db.insert("use_cases", {"use_case_id": ref, "run_id": run_id, "bank_id": "calder_ridge",
                            "title": "Collections assistant", "description": "d", "details": {},
                            "status": "proposed", "proposed_month": "2027-01"})
    item = AgendaItem("UC-001", "use_case", "An open initiative", ref)
    orch.convene(run_id, agenda=[item])
    assert db.fetch_one("SELECT status FROM use_cases WHERE use_case_id = ?", (ref,))["status"] == "proposed"
    assert db.fetch_one("SELECT COUNT(*) AS n FROM decisions WHERE run_id = ? AND ref_id = ?",
                        (run_id, ref))["n"] >= 1


def test_only_called_meetings_are_marked_convened(held):
    """The queue filters on this: a scheduled meeting's decisions are applied, not awaited."""
    db, run_id, result = held
    assert db.fetch_one("SELECT convened FROM meetings WHERE meeting_id = ?", (result.meeting_id,))["convened"]
    scheduled = db.fetch_one("SELECT convened FROM meetings WHERE meeting_id = ?", (f"{run_id}/meeting/2027-01",))
    assert not scheduled["convened"]
