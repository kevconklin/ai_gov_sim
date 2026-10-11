"""Cost computation from API usage fields. Pure functions; prices come from config/models.yaml."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from govern.config import ModelsConfig

_PER_MILLION = 1_000_000


@dataclass(frozen=True)
class TokenUsage:
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    web_searches: int = 0            # server-side web searches the call made (the librarian's)

    @classmethod
    def from_api(cls, usage: Any) -> "TokenUsage":
        server = getattr(usage, "server_tool_use", None)
        return cls(
            input_tokens=usage.input_tokens or 0,
            output_tokens=usage.output_tokens or 0,
            cache_read_tokens=usage.cache_read_input_tokens or 0,
            cache_write_tokens=usage.cache_creation_input_tokens or 0,
            web_searches=int(getattr(server, "web_search_requests", 0) or 0) if server is not None else 0,
        )


def compute_cost(models: ModelsConfig, model: str, usage: TokenUsage, *, batch: bool) -> float:
    """USD cost of one call. `input_tokens` from the API already excludes cached tokens."""
    if model not in models.prices:
        raise KeyError(f"no price configured for model {model!r}")
    price = models.prices[model]
    input_cost = price.input * (
        usage.input_tokens
        + usage.cache_read_tokens * models.cache_read_multiplier
        + usage.cache_write_tokens * models.cache_write_multiplier
    )
    total = (input_cost + price.output * usage.output_tokens) / _PER_MILLION
    total = total * models.batch_multiplier if batch else total
    if usage.web_searches:
        if not models.web_search_per_1000:
            raise KeyError("a web search was made but models.yaml prices none (server_tools.web_search_per_1000)")
        total += usage.web_searches * models.web_search_per_1000 / 1000      # searches are never discounted
    return total
