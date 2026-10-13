

def test_minutes_accept_action_items_written_as_sentences():
    """A chair that lists action items as plain strings must not crash the review after the vote."""
    from datetime import date
    from govern.decisions import minutes_text
    text = minutes_text(bank_name="Harbor", meeting_date=date(2026, 10, 13), present=["Chair"], decisions=[],
                        minutes={"summary": "Done.", "key_points": ["one"], "action_items": ["CIO to tier both tools", {"owner": "CRO", "action": "validate", "due": "May"}]})
    assert "- CIO to tier both tools" in text and "- CRO: validate (due May)" in text
