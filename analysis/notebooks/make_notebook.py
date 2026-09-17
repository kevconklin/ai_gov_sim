"""Writes 01_reproduce_charts.ipynb, which rebuilds the main charts from exports/ alone (SPEC 9.3)."""

import json
from pathlib import Path

CELLS = [
    ("markdown", "# Reproduce charts from exports\nRun `python -m sim export` first. Simulated outcomes depend on `config/engine_params.yaml`."),
    ("code", "import pandas as pd, numpy as np, matplotlib.pyplot as plt\nEXPORTS = '../../exports'\n"
             "metrics = pd.read_parquet(f'{EXPORTS}/metrics.parquet')\nruns = pd.read_parquet(f'{EXPORTS}/runs.parquet')\n"
             "metrics = metrics[metrics.parent_run_id.isna()]  # exclude forks from condition comparisons\nmetrics.head()"),
    ("code", "def bootstrap_ci(values, n=2000, seed=0):\n    rng = np.random.default_rng(seed)\n    values = np.asarray(values, dtype=float)\n"
             "    if len(values) < 2:\n        return (np.nan, np.nan)\n    means = rng.choice(values, (n, len(values))).mean(axis=1)\n"
             "    return tuple(np.percentile(means, [2.5, 97.5]))\n\n"
             "def by_condition(metric, dimension=''):\n    d = metrics[(metrics.metric == metric) & (metrics.dimension == dimension)]\n"
             "    rows = []\n    for (cond, month), g in d.groupby(['condition', 'sim_month']):\n        lo, hi = bootstrap_ci(g.value.dropna())\n"
             "        rows.append({'condition': cond, 'sim_month': month, 'mean': g.value.mean(), 'lo': lo, 'hi': hi})\n    return pd.DataFrame(rows)"),
    ("code", "fig, axes = plt.subplots(2, 3, figsize=(15, 8))\n"
             "for ax, (metric, dim) in zip(axes.flat, [('use_cases_live', 'total'), ('ai_revenue_monthly', ''), ('control_count', ''),\n"
             "                                          ('policy_word_count', ''), ('complaint_rate', ''), ('policy_similarity_cross_bank', '')]):\n"
             "    t = by_condition(metric, dim)\n    for cond, g in t.groupby('condition'):\n        ax.plot(g.sim_month, g['mean'], label=cond)\n"
             "        ax.fill_between(g.sim_month, g.lo, g.hi, alpha=0.2)\n    ax.set_title(f'{metric} {dim}'.strip()); ax.tick_params(axis='x', rotation=45)\n"
             "axes.flat[0].legend(); plt.tight_layout()"),
    ("code", "# Kaplan-Meier: months to first MRA-or-worse finding, by condition\nfindings = pd.read_parquet(f'{EXPORTS}/findings.parquet')\n"
             "def km(durations, observed):\n    order = np.argsort(durations); d, o = np.asarray(durations)[order], np.asarray(observed)[order]\n"
             "    s, out, at_risk = 1.0, [(0, 1.0)], len(d)\n    for t in np.unique(d):\n        events = o[d == t].sum()\n"
             "        if events: s *= 1 - events / at_risk; out.append((t, s))\n        at_risk -= (d == t).sum()\n    return out\n"
             "base = runs[runs.parent_run_id.isna()].copy()\nfirst = metrics[metrics.metric == 'first_mra_month_index'].groupby('run_id').value.min()\n"
             "months_run = metrics.groupby('run_id').sim_month.nunique()\nbase['observed'] = base.run_id.map(first).notna()\n"
             "base['duration'] = base.run_id.map(first).fillna(base.run_id.map(months_run))\n"
             "for cond, g in base.groupby('condition'):\n    steps = km(g.duration, g.observed)\n    plt.step([x for x, _ in steps], [y for _, y in steps], where='post', label=cond)\n"
             "plt.legend(); plt.xlabel('months'); plt.ylabel('share without MRA')"),
    ("code", "# H4: distance of seat stance from committee median over time (mixed model needs statsmodels)\n"
             "s = metrics[metrics.metric == 'stance_score'].dropna(subset=['value'])\n"
             "s['median'] = s.groupby(['run_id', 'sim_month']).value.transform('median')\ns['distance'] = (s.value - s['median']).abs()\n"
             "try:\n    import statsmodels.formula.api as smf\n    s['t'] = s.groupby('run_id').sim_month.rank(method='dense')\n"
             "    print(smf.mixedlm('distance ~ t + condition', s, groups=s['replicate']).fit().summary())\n"
             "except ImportError:\n    print('pip install statsmodels for the mixed model'); print(s.groupby('sim_month').distance.mean())"),
]


def main() -> None:
    notebook = {"nbformat": 4, "nbformat_minor": 5, "metadata": {"kernelspec": {"name": "python3", "display_name": "Python 3"}},
                "cells": [{"cell_type": kind, "metadata": {}, "source": text, **({"outputs": [], "execution_count": None} if kind == "code" else {})}
                          for kind, text in CELLS]}
    Path(__file__).with_name("01_reproduce_charts.ipynb").write_text(json.dumps(notebook, indent=1))


if __name__ == "__main__":
    main()
