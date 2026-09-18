#!/usr/bin/env python3
"""Checks on the rendered Kubernetes manifests that a schema validator will not make.

Run against the output of `kubectl kustomize deploy/k8s`. The deeper checks — that the worker's
command parses as a real CLI invocation, that it is told not to migrate — live in
worker/tests/test_deploy_manifests.py, where they can import the code they are checking against.
"""

from __future__ import annotations

import pathlib
import sys

import yaml

EXAMPLE_SECRET = pathlib.Path(__file__).resolve().parents[2] / "deploy" / "k8s" / "secret.example.yaml"
# A bucket name is not a credential.
PLACEHOLDER_EXEMPT = {"SUPABASE_STORAGE_BUCKET"}


def main(rendered: pathlib.Path) -> int:
    secret = yaml.safe_load(EXAMPLE_SECRET.read_text())
    keys = set(secret["stringData"])
    problems: list[str] = []

    for key, value in secret["stringData"].items():
        if value and "REPLACE" not in value and key not in PLACEHOLDER_EXEMPT:
            problems.append(f"secret.example.yaml: {key} looks like a real value")

    docs = [d for d in yaml.safe_load_all(rendered.read_text()) if d]
    for doc in docs:
        spec = doc.get("spec", {}).get("template", {}).get("spec")
        if not spec:
            continue
        for container in spec.get("containers", []):
            where = f"{doc['kind']}/{doc['metadata']['name']}/{container['name']}"
            ports = {p.get("name") for p in container.get("ports", [])}
            for env in container.get("env", []):
                ref = (env.get("valueFrom") or {}).get("secretKeyRef")
                if ref and ref["key"] not in keys:
                    problems.append(f"{where}: secretKeyRef {ref['key']} is not in secret.example.yaml")
            for probe in ("livenessProbe", "readinessProbe"):
                port = (container.get(probe, {}).get("httpGet") or {}).get("port")
                if isinstance(port, str) and port not in ports:
                    problems.append(f"{where}: {probe} targets port {port!r}, which the container does not declare")

    print(f"checked {len(docs)} resources")
    for problem in problems:
        print(f"  FAIL {problem}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(pathlib.Path(sys.argv[1])))
