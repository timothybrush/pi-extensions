# pi-codex-compaction

> [!WARNING]
> This extension is under active development. Its behavior and configuration may change.

OpenAI Codex native remote compaction integrated into Pi's existing compaction lifecycle.

When the active model uses `openai-codex/openai-codex-responses`, the extension checks context usage before every provider request. At the configured threshold, it sends the finalized Responses history to the normal Codex endpoint with a trailing `compaction_trigger`, persists the returned opaque `compaction` item, replaces the pending request's input, and lets the same agent run continue. No continuation prompt is added.

The extension also intercepts Pi's manual, threshold, and overflow compaction events. Pi requires those events to store a summary string, so they receive a short local checkpoint marker. The marker is filtered from provider context and is never sent to OpenAI.

## Install

```bash
pi install npm:@ogulcancelik/pi-codex-compaction
```

## Behavior

Native compaction activates only for `openai-codex`. Other providers never receive the opaque checkpoint or the local marker; after a provider switch they can see only Pi messages that remain outside the native checkpoint. The extension performs no text-summary model call.

Inline checkpoints are persisted as custom branch entries that do not participate in LLM context. Pi-triggered checkpoints are persisted in `CompactionEntry.details`. Resume, forks, tree navigation, and repeated compaction derive state from the newest checkpoint on the active branch. The request advertises Codex's `remote_compaction_v2` feature on compaction and follow-up calls.

Compaction is fail-closed. If an inline native request fails, the pending model request is aborted. If a Pi-triggered native request fails, Pi's compaction is cancelled and the previous history remains intact. The extension never silently falls back to Pi text summarization. If a persisted native checkpoint is malformed or belongs to another Codex model, the next request is aborted rather than sending Pi's local marker to OpenAI.

## Configuration

The default inline threshold is 90%:

```json
{
  "autoCompact": true,
  "thresholdRatio": 0.9,
  "notify": false
}
```

Save this as `~/.pi/agent/pi-codex-compaction.json` or project-local `.pi/pi-codex-compaction.json`. Project configuration takes precedence. `PI_CODEX_COMPACTION_THRESHOLD_RATIO` overrides the configured ratio.

This threshold controls mid-run provider-boundary compaction. Pi's own `compaction.reserveTokens` setting still controls Pi's post-run threshold event.

## Data handling

The current conversation is sent to the ChatGPT Codex Responses endpoint. OpenAI returns an opaque `encrypted_content` value, which is stored in the local Pi session JSONL and replayed to OpenAI on compatible subsequent requests.

## Limitations

Native checkpoints are model-specific. Switch back to the model that created the checkpoint before continuing. Provider switching is not a portability path because no textual summary is generated.

Pi does not expose a finalized provider payload during `session_before_compact`. The extension mirrors Pi's Codex message conversion and combines it with the latest observed request shape to construct the compaction request. Extensions loaded later that independently rewrite provider payloads can therefore create order-dependent behavior.
