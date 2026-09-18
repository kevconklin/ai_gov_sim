# Kubernetes

Nothing here has been applied to a cluster. The manifests render (`kubectl kustomize deploy/k8s`)
and `worker/tests/test_deploy_manifests.py` checks they still match the code, but no pod has run.

## Order

```bash
kubectl apply -f deploy/k8s/namespace.yaml
# Real secret from a vault. secret.example.yaml is a shape, not a value.
kubectl apply -f my-secret.yaml
kubectl apply -f deploy/k8s/job-migrate.yaml
kubectl wait --for=condition=complete job/govsim-migrate -n govsim --timeout=300s
kubectl apply -k deploy/k8s
```

The migrate Job must finish first. The worker and dashboard both assume the schema exists.

## Images

```bash
docker build -f worker/Dockerfile    -t ghcr.io/OWNER/govsim-worker:0.1.0 .
docker build -f dashboard/Dockerfile -t ghcr.io/OWNER/govsim-dashboard:0.1.0 dashboard
```

The worker image takes the **repo root** as context; it needs `config/`, `db/`, and
`analysis/rubrics`. The dashboard image takes `dashboard/`.

`config/` is baked into the image on purpose, not mounted as a ConfigMap. Model versions are
pinned per run and SPEC §15 requires config changes to be logged as interventions; a mutable
ConfigMap would change agent behaviour mid-run with nothing in the record. A config change means
a new image tag.

## Why the worker is one replica

The Postgres advisory lease makes a second worker *safe* — it cannot take a run another worker
holds — but the serve loop always picks the lowest-month running run, so two workers would
contend for the same one and waste paid calls. Raise `replicas` only once runs are sharded.

The deployment uses `Recreate`, not a rolling update, so a rollout never briefly runs two.

## What is still on disk

Only the policy git repositories, under the `govsim-worker-data` PVC. Every policy version is
also in `policy_versions.policy_text`, so losing the volume loses the git history rather than the
policy text.

Snapshots are in the database and checkpoints upload to object storage, so neither needs the
volume — that is what lets a replacement pod recover a month started by a pod that died.

## Shutdown

SIGTERM asks the worker to finish or roll back the month it is in, then exit.
`terminationGracePeriodSeconds: 900` gives it room; a month cut off part-way is what leaves a
half-written month behind. `/healthz` answers 503 once draining.

## The kill switch degrades here

`SIM_STOP=1` and the `STOP` file are per-pod and reach only the pod that has them. In a cluster
the real kill switch is a **stop command** from the Control page, which every worker sees through
the database. Say so in your runbook.

## Cost

The worker holds a live API key and a crash loop spends money. The hard monthly cap in
`config/budget.yaml` pauses runs at 100%, alerting at 50 and 80. Keep it low until a deploy has
proven itself, and watch `metrics.cost_usd`.

## Not done

- No HPA anywhere, by design for the worker and unnecessary so far for the dashboard.
- Postgres is assumed to exist at `postgres:5432`. Run it yourself, or point the URLs at a
  managed instance. For a managed one, use its connection pooler.
- Egress policy allows 443 to anywhere. Provider IP ranges move, so pinning CIDRs is not
  practical; narrow it with an egress gateway or a Cilium FQDN policy if you have one.
- `secret.example.yaml` is a shape. Use External Secrets or Sealed Secrets for real values.
