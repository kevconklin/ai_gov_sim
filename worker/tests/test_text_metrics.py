from sim.metrics.text import catchphrases, ngram_repeat_rate, tfidf_cosine, type_token_ratio


def test_type_token_ratio_windows():
    assert type_token_ratio("word " * 50) is None
    assert type_token_ratio(" ".join(f"w{i}" for i in range(200))) == 1.0
    assert type_token_ratio("same " * 400) == 1 / 200


def test_ngram_repeat_rate():
    assert ngram_repeat_rate(["a b c d e f"], ["x a b c d e"]) == 0.5
    assert ngram_repeat_rate(["short"], ["anything"]) is None


def test_catchphrases_need_share_volume_and_content():
    msgs = ["let me be clear about the numbers"] * 4 + ["other text entirely here"] * 5
    found = " ".join(catchphrases(msgs))
    assert "clear about the numbers" in found
    assert catchphrases(msgs[:5]) == []                       # too few messages to judge repetition
    assert catchphrases(["i want to"] * 9) == []              # ordinary speech, one content word
    assert catchphrases(["a tested kill switch please"] * 9)  # two content words, repeated


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
