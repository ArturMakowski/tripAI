"""Model selection. `TRIPAI_MODEL` is any pydantic-ai model string ("provider:model").
Agents run only when the provider's API key is present; otherwise callers fall back to
deterministic templates so the demo never depends on the network."""

import os

DEFAULT_MODEL = "openai:gpt-6-luna"

# provider prefix -> env var holding its key (providers not listed are assumed configured)
PROVIDER_KEYS = {
    "openai": "OPENAI_API_KEY",
    "openai-responses": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "google-gla": "GEMINI_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "groq": "GROQ_API_KEY",
    "mistral": "MISTRAL_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}


def model_name() -> str:
    return os.getenv("TRIPAI_MODEL") or DEFAULT_MODEL


def llm_enabled() -> bool:
    if os.getenv("TRIPAI_LLM", "1") == "0":
        return False
    provider = model_name().split(":", 1)[0] if ":" in model_name() else ""
    key = PROVIDER_KEYS.get(provider)
    return bool(os.getenv(key)) if key else bool(provider)
