# AI architecture

## Role of AI
AI never touches the rules path. The engine decides legality; AI provides
*language and guidance*: live commentary, post-game review, coaching hints,
bot chatter. If every provider is down, games continue with AI quietly off.

## Provider abstraction
```ts
interface AIProvider {
  name: string;
  chat(prompt: ChatPrompt, opts?: CallOpts): Promise<string>;
  analyse(game: GameReplay, opts?: CallOpts): Promise<AnalysisReport>;
  isAvailable(): Promise<boolean>;
}
```
- Backend resolves `AI_PROVIDER` → concrete class; failures fall through
  the ordered fallback chain (primary → secondary → cached → off).
- Every call carries `{ gameId?, userId?, budgetTag }` for metering.
- Prompts are versioned templates (`prompts/vN/*.md`); outputs are
  validated (JSON schema) before display to block prompt-injection spill.

## Graceful fallback
1. Primary provider (`AI_PROVIDER`).
2. Secondary (cheapest configured key).
3. Deterministic canned summary (template + engine features, no LLM).
4. Silent disable + `ai_degraded` banner. Users always see *which* tier
   produced the text.

## Cost protection
- Per-request token caps; per-user daily quota; global
  `AI_MONTHLY_BUDGET_USD` kill-switch middleware (returns tier-3 canned
  output at 90 %, hard-off at 100 %).
- Reviews run async on a job queue, never inline on the move path.
- All spend logged per provider/model/day for the admin AI-ops panel.
