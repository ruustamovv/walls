# AI providers

| Provider | `AI_PROVIDER` value | Key | Strengths | Watch-outs |
|----------|--------------------|-----|-----------|------------|
| Groq | `groq` (default) | `GROQ_API_KEY` | low latency, cheap inference for live hints | model churn; pin `AI_MODEL_CHAT` |
| OpenAI | `openai` | `OPENAI_API_KEY` | strong reasoning + embeddings for review | highest unit cost; set quotas |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` | long-context deep analysis | latency; larger bills |
| Gemini | `gemini` | `GEMINI_API_KEY` | generous free tier, multimodal later | region availability varies |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | one key, many models, fast swaps | extra hop; per-model pricing |

## Selection guidance
- Live hints (latency-sensitive): Groq → OpenRouter fallback.
- Post-game deep review (quality-sensitive): Anthropic/OpenAI, async.
- Budget mode: OpenRouter cheapest-model route + canned tier-3.

## Configuration
- `AI_MODEL_CHAT` / `AI_MODEL_ANALYSIS` / `AI_MODEL_TTS` pin exact model
  ids per deployment; never hardcode — models retire quarterly.
- `TTS_ENABLED=false` default; enabling needs `AI_MODEL_TTS` + a voice
  allowlist (Phase 10).
- Missing key ⇒ provider is skipped at boot with a loud log line, not a
  crash. Zero keys ⇒ AI subsystem reports `disabled`, games unaffected.

## Safety
- Never send passwords, tokens, or emails to providers; prompts carry only
  game data + display names.
- Cap + redact: truncate replays to last N plies for chat calls; full
  replays only for async analysis with explicit user consent.
