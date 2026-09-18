"""The manifests must keep matching the code they run. Drift here is only found in a cluster."""

from __future__ import annotations

from pathlib import Path

import pytest

yaml = pytest.importorskip("yaml")

from conftest import REPO_ROOT  # noqa: E402

K8S = REPO_ROOT / "deploy" / "k8s"


def docs():
    for path in sorted(K8S.glob("*.yaml")):
        if path.name == "kustomization.yaml":
            continue
        for doc in yaml.safe_load_all(path.read_text()):
            if doc:
                yield path.name, doc


def by_kind(kind: str, name: str):
    return next(d for _, d in docs() if d["kind"] == kind and d["metadata"]["name"] == name)


def pod_spec(doc):
    return doc["spec"]["template"]["spec"]


def test_every_secret_reference_exists_in_the_example():
    keys = set(by_kind("Secret", "govsim")["stringData"])
    for _, doc in docs():
        if doc["kind"] not in ("Deployment", "Job"):
            continue
        for container in pod_spec(doc)["containers"]:
            for env in container.get("env", []):
                ref = (env.get("valueFrom") or {}).get("secretKeyRef")
                if ref:
                    assert ref["key"] in keys, f"{doc['metadata']['name']} wants missing secret key {ref['key']}"


def test_the_worker_command_is_one_the_cli_accepts():
    from sim.cli import build_parser

    command = pod_spec(by_kind("Deployment", "govsim-worker"))["containers"][0]["command"]
    assert command[:3] == ["python", "-m", "sim"]
    args = build_parser().parse_args(command[3:])
    assert args.health_port == 8080


def test_the_migrate_job_runs_the_migrate_command():
    command = pod_spec(by_kind("Job", "govsim-migrate"))["containers"][0]["command"]
    assert command[3:] == ["migrate"]


def test_the_worker_is_told_not_to_migrate():
    """Migrations are the Job's job; replicas racing the same CREATE TABLE collide."""
    env = {e["name"]: e.get("value") for e in pod_spec(by_kind("Deployment", "govsim-worker"))["containers"][0]["env"]}
    assert env["SIM_SKIP_MIGRATIONS"] == "1"


def test_the_worker_never_rolls_two_copies_at_once():
    """A rolling update would briefly run two workers competing for the same run."""
    worker = by_kind("Deployment", "govsim-worker")
    assert worker["spec"]["replicas"] == 1
    assert worker["spec"]["strategy"]["type"] == "Recreate"


def test_the_worker_is_given_time_to_finish_or_roll_back_a_month():
    assert pod_spec(by_kind("Deployment", "govsim-worker"))["terminationGracePeriodSeconds"] >= 600


def test_containers_run_unprivileged_with_a_read_only_root():
    for _, doc in docs():
        if doc["kind"] not in ("Deployment", "Job"):
            continue
        assert pod_spec(doc)["securityContext"]["runAsNonRoot"] is True
        for container in pod_spec(doc)["containers"]:
            security = container["securityContext"]
            assert security["readOnlyRootFilesystem"] is True
            assert security["allowPrivilegeEscalation"] is False
            assert security["capabilities"]["drop"] == ["ALL"]


def test_the_example_secret_carries_no_real_values():
    for key, value in by_kind("Secret", "govsim")["stringData"].items():
        assert value == "" or "REPLACE" in value or key == "SUPABASE_STORAGE_BUCKET", f"{key} looks real"


def test_the_dashboard_probes_the_one_unauthenticated_route():
    """Every other path redirects to /login, which a probe would read as unhealthy."""
    container = pod_spec(by_kind("Deployment", "govsim-dashboard"))["containers"][0]
    assert container["livenessProbe"]["httpGet"]["path"] == "/login"
