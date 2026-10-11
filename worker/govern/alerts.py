"""Alerts (SPEC 11.3): stored for the dashboard and optionally posted to a Slack-compatible webhook."""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any

from govern import ids
from govern.db import Database, utc_now_iso

log = logging.getLogger(__name__)


def raise_alert(db: Database, kind: str, severity: str, message: str, *, run_id: str | None = None,
                sim_month: str | None = None, dedupe_key: str | None = None) -> bool:
    """Record an alert. With dedupe_key, an alert of the same kind and message key is only raised once."""
    if dedupe_key and db.fetch_one("SELECT 1 FROM alerts WHERE kind = ? AND dedupe_key = ?", (kind, dedupe_key)):
        return False
    text = message
    db.insert("alerts", {"alert_id": ids.global_id(), "run_id": run_id, "sim_month": sim_month, "kind": kind,
                         "severity": severity, "message": text, "dedupe_key": dedupe_key, "created_at": utc_now_iso(),
                         "acknowledged": False})
    log.log(logging.ERROR if severity == "critical" else logging.WARNING if severity == "warning" else logging.INFO,
            "alert %s: %s", kind, text)
    _post_webhook(f"[{severity}] {kind}: {text}")
    _send_email(severity, kind, text)
    return True


def _post_webhook(text: str) -> None:
    url = os.environ.get("ALERT_WEBHOOK_URL")
    if not url or severity_filtered(text):
        return
    request = urllib.request.Request(url, data=json.dumps({"text": text}).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=10):
            pass
    except (urllib.error.URLError, TimeoutError) as error:
        log.error("alert webhook failed: %s", error)


def severity_filtered(text: str) -> bool:
    return text.startswith("[info]") and os.environ.get("ALERT_WEBHOOK_INFO", "0") != "1"


def _send_email(severity: str, kind: str, text: str) -> None:
    """Email for warning and critical alerts when SMTP is configured: ALERT_EMAIL_TO, SMTP_HOST, SMTP_PORT,
    SMTP_USER, SMTP_PASSWORD, SMTP_FROM. Silent when not configured; a failure is logged, never raised."""
    if severity == "info":
        return
    to, host = os.environ.get("ALERT_EMAIL_TO"), os.environ.get("SMTP_HOST")
    if not to or not host:
        return
    import smtplib
    from email.message import EmailMessage
    msg = EmailMessage()
    msg["Subject"] = f"[AI governance] {severity}: {kind}"
    msg["From"] = os.environ.get("SMTP_FROM", os.environ.get("SMTP_USER", "governance@localhost"))
    msg["To"] = to
    msg.set_content(f"{text}\n\nOpen the dashboard to acknowledge it.")
    try:
        with smtplib.SMTP(host, int(os.environ.get("SMTP_PORT", "587")), timeout=10) as smtp:
            smtp.starttls()
            user, password = os.environ.get("SMTP_USER"), os.environ.get("SMTP_PASSWORD")
            if user and password:
                smtp.login(user, password)
            smtp.send_message(msg)
    except Exception as error:  # noqa: BLE001 - alerting must never take the worker down
        log.error("alert email failed: %s", error)


def open_alerts(db: Database, run_id: str | None = None) -> list[Any]:
    where, params = ("AND run_id = ?", (run_id,)) if run_id else ("", ())
    return db.fetch_all(f"SELECT * FROM alerts WHERE NOT acknowledged {where} ORDER BY created_at DESC", params)
