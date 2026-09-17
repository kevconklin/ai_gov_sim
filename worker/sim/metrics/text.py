"""Deterministic text statistics for repetition metrics (SPEC 9.2, Andon-style measures)."""

from __future__ import annotations

import math
import re
from collections import Counter
from typing import Iterable, Sequence

_WORD = re.compile(r"[a-z0-9]+(?:['-][a-z0-9]+)*")
STOPWORDS = frozenset(
    "a an the and or but if of to in on for with at by from as is are was were be been being it its this that these those "
    "we our us i my me you your he she they them their not no do does did so than then there here have has had will would "
    "can could should may might must also just about into over more most very what which who whom how when where why".split())


def words(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def type_token_ratio(text: str, window: int = 200) -> float | None:
    """Mean unique/total over consecutive fixed-size windows; None if shorter than one window."""
    tokens = words(text)
    chunks = [tokens[i:i + window] for i in range(0, len(tokens) - window + 1, window)]
    if not chunks:
        return None
    return sum(len(set(c)) / window for c in chunks) / len(chunks)


def ngrams(tokens: Sequence[str], n: int) -> list[tuple[str, ...]]:
    return [tuple(tokens[i:i + n]) for i in range(len(tokens) - n + 1)]


def ngram_repeat_rate(current: Iterable[str], history: Iterable[str], n: int = 5) -> float | None:
    seen = {g for text in history for g in ngrams(words(text), n)}
    grams = [g for text in current for g in ngrams(words(text), n)]
    if not grams:
        return None
    return sum(g in seen for g in grams) / len(grams)


def catchphrases(messages: Sequence[str], *, min_n: int = 3, max_n: int = 6, share: float = 0.3,
                 min_messages: int = 8, min_occurrences: int = 3, min_content_words: int = 2) -> list[str]:
    """Phrases a speaker reuses: in more than `share` of their messages, at least `min_occurrences` times.

    Thresholds keep early months quiet: with a handful of messages, "in over 30%" would mean "said twice", and
    phrases carrying fewer than `min_content_words` non-stopwords ("i want to") are ordinary speech, not catchphrases.
    """
    if len(messages) < min_messages:
        return []
    counts: Counter[tuple[str, ...]] = Counter()
    for text in messages:
        tokens = words(text)
        counts.update({g for n in range(min_n, max_n + 1) for g in ngrams(tokens, n)
                       if sum(t not in STOPWORDS for t in g) >= min_content_words})
    threshold = max(share * len(messages), min_occurrences)
    frequent = [g for g, c in counts.items() if c >= threshold]
    # keep maximal phrases only
    maximal = [g for g in frequent if not any(len(o) > len(g) and " ".join(g) in " ".join(o) for o in frequent)]
    return sorted(" ".join(g) for g in maximal)


def tfidf_cosine(a: str, b: str) -> float | None:
    docs = [Counter(t for t in words(a) if t not in STOPWORDS), Counter(t for t in words(b) if t not in STOPWORDS)]
    if not docs[0] or not docs[1]:
        return None
    vocab = set(docs[0]) | set(docs[1])
    idf = {t: math.log((1 + 2) / (1 + sum(t in d for d in docs))) + 1 for t in vocab}
    vecs = [{t: d[t] * idf[t] for t in d} for d in docs]
    dot = sum(vecs[0].get(t, 0) * vecs[1].get(t, 0) for t in vocab)
    norms = [math.sqrt(sum(v * v for v in vec.values())) for vec in vecs]
    return dot / (norms[0] * norms[1])


def estimate_tokens(text: str) -> float:
    return len(words(text)) * 1.33
