"""Command-line entry point: python -m sim <command>."""

from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import sys
import threading
import time
import socketserver
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from sim import commands
from sim.alerts import raise_alert
from sim.config import load_config
from sim.db import Database
from sim.llm import LLMClient, StopRequested
from sim.orchestrator import Orchestrator, RunNotActive
from sim.world import REPO_ROOT, load_world

log = logging.getLogger("sim")

# Set by SIGTERM. A scheduler drains a pod by sending it; the worker must finish the month it is
# in or roll it back, never be cut off part-way, so this is checked between months and inside the
# LLM client's stop hook rather than tearing the process down where the signal lands.
_TERMINATING = threading.Event()


def terminating() -> bool:
    return _TERMINATING.is_set()


def _install_shutdown_handlers() -> None:
    def handle(signum: int, _frame: object) -> None:
        log.info("received %s; finishing or rolling back the current month, then exiting",
                 signal.Signals(signum).name)
        _TERMINATING.set()

    for received in (signal.SIGTERM, signal.SIGINT):
        signal.signal(received, handle)


class _HealthHandler(BaseHTTPRequestHandler):
    """Liveness and readiness. 503 while draining, so a probe stops sending work to a dying pod."""

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's spelling
        draining = terminating()
        body = json.dumps({"status": "draining" if draining else "ok"}).encode()
        self.send_response(503 if draining else 200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args: object) -> None:
        return          # probes run every few seconds; they are not worth a log line each


class _HealthServer(ThreadingHTTPServer):
    daemon_threads = True

    def server_bind(self) -> None:
        """Bind without HTTPServer's socket.getfqdn() call.

        That reverse lookup can stall for tens of seconds on a host with slow or absent DNS,
        which in a cluster is exactly when the probe matters most. Nothing here reads
        server_name.
        """
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name, self.server_port = str(host), port


def start_health_server(port: int, host: str = "") -> ThreadingHTTPServer:
    """Serve /healthz on a daemon thread. Port 0 picks a free one, which is what the tests use."""
    server = _HealthServer((host, port), _HealthHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def stop_health_server(server: ThreadingHTTPServer) -> None:
    server.shutdown()
    server.server_close()


def _data_dir() -> Path:
    return Path(os.environ.get("SIM_DATA_DIR", REPO_ROOT / "data"))


def _open_db() -> Database:
    target = os.environ.get("DATABASE_URL") or str(_data_dir() / "sim.sqlite")
    if not target.startswith(("postgres://", "postgresql://")):
        Path(target).parent.mkdir(parents=True, exist_ok=True)
    db = Database.connect(target)
    # In a cluster several replicas would race the same CREATE TABLE, so migrations run once as
    # their own step and the workers are told to skip them.
    if os.environ.get("SIM_SKIP_MIGRATIONS") != "1":
        db.migrate(REPO_ROOT / "db" / "migrations")
    return db


def _orchestrator(db: Database, *, demo: bool) -> Orchestrator:
    from sim.storage import SupabaseStorage

    config, world, data_dir = load_config(REPO_ROOT / "config"), load_world(REPO_ROOT / "config"), _data_dir()
    client = None
    if demo:
        from sim.demo_llm import DemoAnthropic
        client = DemoAnthropic()
    elif not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("ANTHROPIC_API_KEY is not set. Use --demo for a free scripted run.")
    llm = LLMClient(db=db, config=config, client=client, sleep=(lambda s: None) if demo else time.sleep,
                    should_stop=lambda: terminating() or commands.stop_requested(db, data_dir),
                    on_failure_streak=lambda n, d: raise_alert(db, "api_failures", "critical", f"{n} consecutive failed API calls: {d}"),
                    price_scale=0.0 if demo else 1.0)
    return Orchestrator(db=db, world=world, config=config, llm=llm, data_dir=data_dir, uploader=SupabaseStorage.from_env())


def _runs_for(db: Database, args: argparse.Namespace) -> list[str]:
    if getattr(args, "run", None):
        return [args.run]
    rows = db.fetch_all("SELECT run_id FROM runs WHERE experiment_id = ? ORDER BY replicate, bank_id", (args.experiment,))
    if not rows:
        sys.exit("no runs found; pass --run or --experiment")
    return [r["run_id"] for r in rows]


def cmd_create(args: argparse.Namespace) -> None:
    from sim.setup import create_experiment

    db = _open_db()
    config, world = load_config(REPO_ROOT / "config"), load_world(REPO_ROOT / "config")
    run_ids = create_experiment(db, world, config, name=args.name, replicates=args.replicates, seed=args.seed,
                                data_dir=_data_dir(), banks=args.banks.split(",") if args.banks else None, notes=args.notes)
    print(json.dumps({"runs": run_ids}, indent=2))


def cmd_advance(args: argparse.Namespace) -> None:
    db = _open_db()
    orch = _orchestrator(db, demo=args.demo)
    run_ids = _runs_for(db, args)
    for _ in range(args.months):
        for run_id in run_ids:
            log.info("%s: completed %s", run_id, orch.advance(run_id))


def cmd_serve(args: argparse.Namespace) -> None:
    """Long-running worker: apply commands, then advance running runs one month at a time, lowest month first."""
    db = _open_db()
    orch = _orchestrator(db, demo=args.demo)
    data_dir = _data_dir()
    _install_shutdown_handlers()
    if args.health_port:
        start_health_server(args.health_port)
        log.info("health endpoint on :%d/healthz", args.health_port)
    log.info("worker started")
    while True:
        if terminating():
            log.info("draining; no further months will be started")
            return
        if os.environ.get("SIM_STOP") == "1" or (data_dir / "STOP").exists():
            log.info("stop flag set; exiting")
            return
        commands.process_pending(db, orch, data_dir)
        running = db.fetch_all("SELECT run_id, current_month FROM runs WHERE status = 'running' "
                               "ORDER BY COALESCE(current_month, ''), replicate, bank_id")
        if not running:
            time.sleep(args.poll_seconds)
            continue
        run_id = running[0]["run_id"]
        try:
            month = orch.advance(run_id)
            log.info("%s completed %s", run_id, month)
        except StopRequested:
            commands.process_pending(db, orch, data_dir)
            log.info("stopped during a month; rolled back and exiting")
            return
        except RunNotActive as error:
            log.warning("%s", error)
            time.sleep(args.poll_seconds)
        except Exception:  # noqa: BLE001 - the run is marked failed and alerted inside advance
            log.exception("run %s failed", run_id)
        if args.once:
            return


def cmd_candidates(args: argparse.Namespace) -> None:
    """The ranked list a human builds an agenda from. Priority is computed, never asked of a model."""
    from datetime import date as _date

    from sim.agenda import candidates
    from sim.config import load_agenda_priority

    db = _open_db()
    ranked = candidates(db, args.run, load_agenda_priority(REPO_ROOT / "config"),
                        today=args.today or _date.today().isoformat())
    print(json.dumps([{"kind": c.kind, "ref_id": c.ref_id, "title": c.title, "priority": c.priority,
                       "reasons": list(c.reasons), "deferrals": c.deferral_count, "escalated": c.escalated}
                      for c in ranked], indent=2))


def _agenda_from(args: argparse.Namespace) -> list:
    from sim.packet import AgendaItem

    items = []
    if args.agenda:
        raw = Path(args.agenda[1:]).read_text() if args.agenda.startswith("@") else args.agenda
        items += [AgendaItem(i["item_id"], i["kind"], i["title"], i.get("ref_id")) for i in json.loads(raw)]
    for n, question in enumerate(args.advisory or [], start=len(items) + 1):
        items.append(AgendaItem(f"ADV-{n:03d}", "advisory", question))
    if not items:
        sys.exit("nothing to discuss; pass --agenda and/or --advisory")
    return items


def cmd_convene(args: argparse.Namespace) -> None:
    """Hold a meeting a human called. Recommendations come back; nothing applies until attested."""
    db = _open_db()
    orch = _orchestrator(db, demo=args.demo)
    result = orch.convene(args.run, agenda=_agenda_from(args), month=args.month)
    print(json.dumps({"meeting_id": result.meeting_id, "date": result.meeting_date.isoformat(),
                      "recommendations": [{"decision_id": d.decision_id, "item_id": d.item.item_id,
                                           "recommended": d.outcome, "yes": d.tally.yes, "no": d.tally.no,
                                           "abstain": d.tally.abstain} for d in result.decisions]}, indent=2))


def cmd_attest(args: argparse.Namespace) -> None:
    """Record a person against one decision, then optionally apply the meeting."""
    from datetime import date as _date

    from sim.attestation import AttestationInvalid, apply_meeting, dissents, record_attestation
    from sim.config import load_attestation
    from sim.decisions import decisions_for_meeting

    db = _open_db()
    orch = _orchestrator(db, demo=args.demo)
    ctx = orch.context(args.run)
    if args.show:
        for d in decisions_for_meeting(ctx, args.show):
            print(json.dumps({"decision_id": d.decision_id, "item_id": d.item.item_id, "recommended": d.outcome,
                              "dissents": [{"agent_id": x.agent_id, "rationale": x.rationale}
                                           for x in dissents(db, d)]}, indent=2))
        return
    try:
        record_attestation(db, args.run, decision_id=args.decision, actor=args.actor, outcome=args.outcome,
                           rationale=args.rationale, responded_to=args.responded_to or (),
                           source="cli_asserted", config=load_attestation(REPO_ROOT / "config"))
    except AttestationInvalid as error:
        sys.exit(str(error))
    print(json.dumps({"attested": args.decision, "outcome": args.outcome}, indent=2))
    if args.apply:
        meeting = db.fetch_one("SELECT meeting_id, sim_month, meeting_date FROM meetings WHERE meeting_id = "
                               "(SELECT meeting_id FROM decisions WHERE decision_id = ?)", (args.decision,))
        problems = apply_meeting(ctx, meeting["meeting_id"], month=meeting["sim_month"],
                                 meeting_date=_date.fromisoformat(meeting["meeting_date"]))
        print(json.dumps({"applied": meeting["meeting_id"], "problems": problems}, indent=2))


def cmd_migrate(args: argparse.Namespace) -> None:
    """Apply pending migrations and stop. This is the step a cluster runs before the workers start."""
    target = os.environ.get("DATABASE_URL") or str(_data_dir() / "sim.sqlite")
    if not target.startswith(("postgres://", "postgresql://")):
        Path(target).parent.mkdir(parents=True, exist_ok=True)
    db = Database.connect(target)
    try:
        print(json.dumps({"applied": db.migrate(REPO_ROOT / "db" / "migrations")}, indent=2))
    finally:
        db.close()


def cmd_control(args: argparse.Namespace) -> None:
    db = _open_db()
    payload = json.loads(args.payload) if args.payload else {}
    command_id = commands.enqueue(db, kind=args.kind, run_id=args.run, reason=args.reason, payload=payload)
    if args.now:
        orch = _orchestrator(db, demo=args.demo)
        commands.process_pending(db, orch, _data_dir())
    row = db.fetch_one("SELECT status, result FROM commands WHERE command_id = ?", (command_id,))
    print(json.dumps({"command_id": command_id, "status": row["status"], "result": row["result"]}, indent=2))


def cmd_status(args: argparse.Namespace) -> None:
    db = _open_db()
    for r in db.fetch_all("SELECT r.run_id, r.bank_id, r.condition, r.replicate, r.status, r.current_month, "
                          "(SELECT COALESCE(SUM(cost_usd), 0) FROM llm_calls c WHERE c.run_id = r.run_id) AS cost "
                          "FROM runs r ORDER BY r.experiment_id, r.replicate, r.bank_id"):
        print(f"{r['run_id']:<60} {r['condition']:<12} {r['status']:<8} month={r['current_month']} cost=${r['cost']:.2f}")


def cmd_export(args: argparse.Namespace) -> None:
    from sim.analysis.exports import export_all

    print(json.dumps(export_all(_open_db(), Path(args.out)), indent=2))


def cmd_leak_check(args: argparse.Namespace) -> None:
    from sim.realism import scan_repo

    leaks = scan_repo(REPO_ROOT)
    for leak in leaks:
        print(f"{leak.source}:{leak.line}: {leak.match!r}")
    sys.exit(1 if leaks else 0)


def cmd_validation_sample(args: argparse.Namespace) -> None:
    from sim.analysis.validation import draw_sample

    print(draw_sample(_open_db(), args.measure, args.n, Path(args.out)))


def cmd_kappa(args: argparse.Namespace) -> None:
    from sim.analysis.validation import kappa_for_file

    print(json.dumps(kappa_for_file(args.measure, Path(args.file)), indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="sim", description="AI governance committee simulation worker")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("create", help="create an experiment with paired runs")
    p.add_argument("--name", required=True)
    p.add_argument("--replicates", type=int, default=1)
    p.add_argument("--seed", type=int, required=True)
    p.add_argument("--banks", help="comma-separated bank ids (default: all)")
    p.add_argument("--notes", default="")
    p.set_defaults(func=cmd_create)

    p = sub.add_parser("advance", help="advance runs by N months now")
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument("--run")
    group.add_argument("--experiment")
    p.add_argument("--months", type=int, default=1)
    p.add_argument("--demo", action="store_true", help="use the scripted client instead of the API")
    p.set_defaults(func=cmd_advance)

    sub.add_parser("migrate", help="apply pending migrations and exit").set_defaults(func=cmd_migrate)

    p = sub.add_parser("serve", help="run the long-lived worker loop")
    p.add_argument("--health-port", type=int, default=int(os.environ.get("SIM_HEALTH_PORT", "0")),
                   help="serve /healthz on this port for liveness and readiness probes")
    p.add_argument("--poll-seconds", type=float, default=15)
    p.add_argument("--demo", action="store_true")
    p.add_argument("--once", action="store_true", help=argparse.SUPPRESS)
    p.set_defaults(func=cmd_serve)

    p = sub.add_parser("candidates", help="ranked items a human can put on an agenda")
    p.add_argument("--run", required=True)
    p.add_argument("--today", help="ISO date the age signal is measured from (default: today)")
    p.set_defaults(func=cmd_candidates)

    p = sub.add_parser("convene", help="hold a meeting on an agenda you set")
    p.add_argument("--run", required=True)
    p.add_argument("--agenda", help='JSON list of agenda items, or @path to a file')
    p.add_argument("--advisory", action="append", help="a question for discussion only, no vote (repeatable)")
    p.add_argument("--month", help="the month to book it under (default: the run's current month)")
    p.add_argument("--demo", action="store_true", help="use the scripted client")
    p.set_defaults(func=cmd_convene)

    p = sub.add_parser("attest", help="put a person on record for a decision")
    p.add_argument("--run", required=True)
    p.add_argument("--show", metavar="MEETING_ID", help="list a meeting's decisions and dissents, then stop")
    p.add_argument("--decision")
    p.add_argument("--actor", help="the accountable person (asserted, not verified: recorded as cli_asserted)")
    p.add_argument("--outcome", choices=("approved", "rejected", "deferred"))
    p.add_argument("--rationale", default="", help="your own reasoning, in your own words")
    p.add_argument("--responded-to", action="append", dest="responded_to",
                   help="agent_id of a dissent you answered (repeatable)")
    p.add_argument("--apply", action="store_true", help="apply the meeting once every item is attested")
    p.add_argument("--demo", action="store_true")
    p.set_defaults(func=cmd_attest)

    p = sub.add_parser("control", help="queue a control command (logged as an intervention)")
    p.add_argument("kind", choices=sorted(commands.KINDS))
    p.add_argument("--run", required=True)
    p.add_argument("--reason", required=True)
    p.add_argument("--payload", help='JSON, e.g. \'{"months": 1}\'')
    p.add_argument("--now", action="store_true", help="apply immediately instead of waiting for the worker")
    p.add_argument("--demo", action="store_true")
    p.set_defaults(func=cmd_control)

    sub.add_parser("status", help="list runs").set_defaults(func=cmd_status)

    p = sub.add_parser("export", help="write CSV and Parquet exports")
    p.add_argument("--out", default=str(REPO_ROOT / "exports"))
    p.set_defaults(func=cmd_export)

    sub.add_parser("leak-check", help="scan agent-facing files for simulation language").set_defaults(func=cmd_leak_check)

    p = sub.add_parser("validation-sample", help="draw a sample for human coding")
    p.add_argument("--measure", required=True)
    p.add_argument("--n", type=int, default=200)
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_validation_sample)

    p = sub.add_parser("kappa", help="agreement between human and model codes")
    p.add_argument("--measure", required=True)
    p.add_argument("--file", required=True)
    p.set_defaults(func=cmd_kappa)
    return parser


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    args = build_parser().parse_args(argv)
    args.func(args)
