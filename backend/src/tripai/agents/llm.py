"""Model selection. Agents run only when an Anthropic key is present; otherwise callers fall back
to deterministic templates so the demo never depends on the network."""

import os

DEFAULT_MODEL = "anthropic:claude-sonnet-5-5"


def model_name() -> str:
    name = os.getenv("TRIPAI_MODEL", DEFAULT_MODEL)
    return name if ":" in name else f"anthropic:{name}"


def llm_enabled() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY")) and os.getenv("TRIPAI_LLM", "1") != "0"
