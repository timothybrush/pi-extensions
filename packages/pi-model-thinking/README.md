# pi-model-thinking

Auto-set and remember thinking levels per model in pi.

No more `Ctrl+P` → `Shift+Tab` → `Shift+Tab` when switching models. This extension remembers what thinking level you set for each model and restores it automatically.

## Install

```bash
pi install npm:@ogulcancelik/pi-model-thinking
```

For local development:

```bash
pi install ~/Projects/pi-extensions/packages/pi-model-thinking
```

## How it works

The extension uses a single file: `~/.pi/agent/model-thinking.json`.

This file is both your **initial config** and your **live state**. You can seed it manually, or let it grow organically as you use pi.

### If the model is in the file

On `model_select` (Ctrl+P, /model, session restore), the extension automatically applies the stored thinking level.

### If the model is NOT in the file

The extension does nothing. Pi handles thinking natively, exactly as before.

### When you manually change thinking (Shift+Tab)

The extension writes the new level into `model-thinking.json` for that exact model. Next time you use that model — even in a new session — it starts with your chosen level.

If your change matches a provider-level default in the file, the exact model entry is cleaned up automatically.

## Config format

`~/.pi/agent/model-thinking.json`:

```json
{
  "models": {
    "anthropic/claude-sonnet-4-5": "high",
    "openai/gpt-5.2-codex": "medium"
  },
  "providers": {
    "fireworks": "low"
  }
}
```

Resolution order:
1. `models["provider/modelId"]` — exact match
2. `providers["provider"]` — provider-wide fallback
3. Not in file → extension ignores, pi handles natively

You must create the config file. Only models explicitly listed (exact or by provider) are **managed** by the extension. For unmanaged models, pi handles thinking natively and the extension does not interfere.

## Commands

**`/model-thinking`** — shows current resolution and whether the active model is managed.

**`/model-thinking reset`** — deletes `model-thinking.json`, clearing all remembered levels.

## Example flow

Create `~/.pi/agent/model-thinking.json` with your defaults:

```json
{
  "providers": {
    "anthropic": "high",
    "openai-codex": "medium"
  }
}
```

1. `Ctrl+P` to Claude → thinking is `high` (provider default).
2. `Shift+Tab` change thinking to `low`. Extension writes `"anthropic/claude-sonnet-4-5": "low"`.
3. Quit pi, start a new session, `Ctrl+P` back to Claude. Thinking is automatically `low`.
4. `Shift+Tab` back to `high`. Extension removes the exact-model override (matches provider default).
5. Switch to GPT (managed via `openai-codex` provider). Thinking is `medium`.
6. `Shift+Tab` on GPT to `high`. Extension writes `"openai/gpt-5.2-codex": "high"`.
7. Switch back to Claude → `high`. Switch to GPT → `high`. No manual tweaking needed.
