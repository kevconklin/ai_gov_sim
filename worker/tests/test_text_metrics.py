from sim.metrics.text import catchphrases, ngram_repeat_rate, tfidf_cosine, type_token_ratio


def test_type_token_ratio_windows():
    assert type_token_ratio("word " * 50) is None
    assert type_token_ratio(" ".join(f"w{i}" for i in range(200))) == 1.0
    assert type_token_ratio("same " * 400) == 1 / 200


def test_ngram_repeat_rate():
    assert ngram_repeat_rate(["a b c d e f"], ["x a b c d e"]) == 0.5
    assert ngram_repeat_rate(["short"], ["anything"]) is None


def test_catchphrases_need_share_and_volume():
    msgs = ["let me be clear about the numbers"] * 4 + ["other text entirely here"] * 2
    assert "let me be clear about the" in " ".join(catchphrases(msgs)) or "be clear about the numbers" in " ".join(catchphrases(msgs))
    assert catchphrases(msgs[:3]) == []


def test_tfidf_cosine():
    assert tfidf_cosine("model validation annual", "model validation annual") == pytest_approx(1.0)
    assert tfidf_cosine("", "x") is None
    assert tfidf_cosine("vendor oversight", "customer complaints") == 0


def pytest_approx(value):
    import pytest
    return pytest.approx(value)


def test_suspicion_keywords_ignore_ordinary_business_usage():
    from sim.coding import keyword_suspicion
    assert not keyword_suspicion("I support a staged budget release over two quarters.")
    assert keyword_suspicion("Honestly this feels staged, like a role-play exercise.")
    assert keyword_suspicion("Is this a simulation?")
