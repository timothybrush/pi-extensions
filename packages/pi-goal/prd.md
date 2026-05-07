 # pi-goal PRD: Codex-Style Long-Running Goals for Pi

 ## Purpose

 Rewrite `@ogulcancelik/pi-goal` from a task/worker orchestration extension into a Codex-style long-running goal runtime for Pi.

 The new extension should keep the main agent working on one explicit user goal across turns and, when context approaches exhaustion, automatically produce a handoff summary and
 continue in a linked new Pi session. It should not spawn worker agents in v1. It should not inject into or mutate the system prompt. It should not edit prior session history. It
 should work entirely through the current Pi extension API by appending messages, storing extension state, registering tools/commands, and using TUI affordances.

 The target behavior is conceptually close to Codex `/goal`, but adapted to Pi extension constraints.

 ## Background

 The current `packages/pi-goal/index.ts` is a file-backed goal/task runner. It exposes one `goal` tool with `create`, `add_task`, `run`, and `status`, writes state under `.pi/goals/`,
 and spawns isolated `pi` worker subprocesses per task. This is useful for parallel fanout, but it is not how Codex goal mode works.

 Codex goal mode is simpler and more runtime-oriented. It persists one active objective for the current thread, tracks budget/accounting, and keeps the same main agent moving by
 injecting continuation prompts when the thread is idle. The model can mark the goal complete, but user/system logic owns pause, resume, budget limiting, and clearing.

 This rewrite should copy that runtime shape first. Worker fanout can be revisited later as a separate optional feature.

 ## Goals

 The extension should support one active goal per Pi session lineage.

 The extension should keep the same main agent working by appending hidden continuation messages when the current turn finishes and the goal remains active.

 The extension should watch model context usage and treat 95% of the active model context window as the goal budget limit.

 The extension should automatically request a goal handoff summary when the context budget is reached, then start a linked new session and continue the goal there.

 The extension should use Pi’s session lineage by creating new sessions with `parentSession`, so consecutive budget handoffs remain connected to prior sessions in metadata.

 The extension should provide a small TUI HUD for current goal status, context usage, and handoff state.

 The extension should avoid broad dashboards, worker rows, and task-state UI in v1.

 ## Non-Goals

 Do not spawn sub-agents or worker `pi` subprocesses in v1.

 Do not maintain `.pi/goals/<slug>/tasks` as the primary state model.

 Do not mutate Pi’s system prompt through `before_agent_start`.

 Do not patch provider payloads through `before_provider_request`.

 Do not edit or rewrite existing session history.

 Do not require the user to manually run `/continue`, `/handoff`, or similar commands after the initial goal starts.

 Do not implement a full task planner or task execution dashboard in v1.

 ## Key Constraints

 Pi extensions can append messages and custom entries, but they cannot create true Codex-style `developer` role pending input through the public extension API.

 Pi `pi.sendMessage()` creates a `custom` message. In Pi’s `convertToLlm()`, custom messages are converted to LLM `user` messages.

 Pi `pi.sendUserMessage()` also creates normal user input.

 Pi command contexts can start new sessions with `ctx.newSession()`. Normal event contexts and tool contexts do not cleanly expose `newSession()` through the documented API.

 Therefore the v1 design must use a captured command context from the initial `/goal <objective>` command as the automation controller for later linked-session handoffs.

 ## Reference Findings

 ### Codex Goal Runtime

 Codex goal core is implemented in:

 - `/home/can/Projects/codex/codex-rs/core/src/goals.rs`
 - `/home/can/Projects/codex/codex-rs/core/templates/goals/continuation.md`
 - `/home/can/Projects/codex/codex-rs/core/templates/goals/budget_limit.md`
 - `/home/can/Projects/codex/codex-rs/core/src/tools/handlers/goal.rs`
 - `/home/can/Projects/codex/codex-rs/tools/src/goal_tool.rs`

 The important runtime event enum is `GoalRuntimeEvent` in `core/src/goals.rs`. It handles turn start, tool completion, goal-tool completion, turn finish, idle continuation, task
 abort, external mutation, external set/clear, and thread resume.

 Codex continuation is created by `continuation_prompt()` in `core/src/goals.rs`, using `core/templates/goals/continuation.md`. The prompt tells the model to continue toward the
 active objective, audit real evidence before declaring completion, and call `update_goal` only when the goal is actually complete.

 Codex budget-limit steering is created by `budget_limit_prompt()` in `core/src/goals.rs`, using `core/templates/goals/budget_limit.md`. The prompt tells the agent the active thread
 goal has reached its token budget, instructs it not to start new substantive work, and asks it to wrap up with progress, remaining work, blockers, and next step.

 Codex injects both continuation and budget-limit prompts as `ResponseInputItem::Message { role: "developer", ... }`, not as normal user messages.

 The relevant injection paths are:

 - `core/src/goals.rs`: continuation candidate contains `ResponseInputItem::Message { role: "developer", ... }`.
 - `core/src/goals.rs`: budget steering uses `budget_limit_steering_item()` returning `ResponseInputItem::Message { role: "developer", ... }`.
 - `core/src/session/mod.rs`: `inject_response_items()` pushes injected items into active turn pending input.
 - `core/src/session/turn.rs`: pending input is drained, inspected, recorded, and included in the next model request.
 - `core/src/hook_runtime.rs`: `record_pending_input()` records accepted pending input as conversation items.

 Codex does not use sub-agents for `/goal`. The same main agent continues normal turns until the goal completes, pauses, clears, or becomes budget-limited.

 ### Codex Goal State

 Codex persists one goal per thread in SQLite.

 Reference paths:

 - `/home/can/Projects/codex/codex-rs/state/migrations/0029_thread_goals.sql`
 - `/home/can/Projects/codex/codex-rs/state/src/model/thread_goal.rs`
 - `/home/can/Projects/codex/codex-rs/state/src/runtime/goals.rs`
 - `/home/can/Projects/codex/codex-rs/protocol/src/protocol.rs`

 The `thread_goals` table has:

 ```sql
 CREATE TABLE thread_goals (
     thread_id TEXT PRIMARY KEY NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
     goal_id TEXT NOT NULL,
     objective TEXT NOT NULL,
     status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'budget_limited', 'complete')),
     token_budget INTEGER,
     tokens_used INTEGER NOT NULL DEFAULT 0,
     time_used_seconds INTEGER NOT NULL DEFAULT 0,
     created_at_ms INTEGER NOT NULL,
     updated_at_ms INTEGER NOT NULL
 );
 ```

 Codex protocol shape is `ThreadGoal` with `thread_id`, `objective`, `status`, optional `token_budget`, `tokens_used`, `time_used_seconds`, `created_at`, and `updated_at`.

 For Pi v1, replace this DB row with append-only custom session entries and an in-memory reconstructed state.

 ### Codex User-Facing TUI

 Codex TUI goal command and UI are implemented in:

 - `/home/can/Projects/codex/codex-rs/tui/src/slash_command.rs`
 - `/home/can/Projects/codex/codex-rs/tui/src/chatwidget/slash_dispatch.rs`
 - `/home/can/Projects/codex/codex-rs/tui/src/app/thread_goal_actions.rs`
 - `/home/can/Projects/codex/codex-rs/tui/src/chatwidget/goal_status.rs`
 - `/home/can/Projects/codex/codex-rs/tui/src/chatwidget/goal_menu.rs`

 The Codex slash command behavior is:

 - `/goal` shows a goal summary or usage.
 - `/goal <objective>` sets an active objective.
 - `/goal clear` clears the current goal.
 - `/goal pause` pauses.
 - `/goal resume` resumes.

 Codex shows compact status-line state: active, paused, budget-limited, complete, plus token/time usage.

 For Pi v1, replicate the small status/UI shape, not the current `pi-goal` worker dashboard.

 ### Pi Extension APIs

 Relevant Pi docs:

 - `/home/can/Projects/pi-mono/packages/coding-agent/docs/extensions.md`
 - `/home/can/Projects/pi-mono/packages/coding-agent/docs/sessions.md`
 - `/home/can/Projects/pi-mono/packages/coding-agent/docs/session-format.md`

 Relevant Pi implementation paths:

 - `/home/can/Projects/pi-mono/packages/coding-agent/src/core/agent-session.ts`
 - `/home/can/Projects/pi-mono/packages/coding-agent/src/core/messages.ts`
 - `/home/can/Projects/pi-mono/packages/coding-agent/src/core/extensions/types.ts`
 - `/home/can/Projects/pi-mono/packages/coding-agent/src/core/extensions/runner.ts`
 - `/home/can/Projects/pi-mono/packages/coding-agent/src/core/session-manager.ts`

 Important facts:

 - `pi.sendMessage()` appends a custom message and can trigger a turn.
 - `pi.sendMessage(..., { triggerTurn: true, deliverAs: "followUp" })` is the extension-safe way to queue an agent-visible hidden follow-up.
 - `CustomMessage` is converted to LLM role `user` in `core/messages.ts` through `convertToLlm()`.
 - `ctx.getContextUsage()` exposes current context usage and percent.
 - `ctx.ui.setStatus()` can render compact footer state.
 - `ctx.ui.setWidget()` can render a small goal HUD.
 - `ctx.ui.custom()` can render richer overlays.
 - `ctx.newSession()` is available on `ExtensionCommandContext`, not plain `ExtensionContext`.
 - `newSession({ parentSession })` records the parent session path in the new session header.

 ### pi-handoff Reference

 Current local handoff implementation:

 - `/home/can/Projects/pi-extensions/packages/pi-handoff/handoff.ts`

 Upstream handoff example referenced by README:

 - `/home/can/Projects/pi-mono/packages/coding-agent/examples/extensions/handoff.ts`

 `pi-handoff` uses `ctx.getContextUsage()` in `turn_end`. When context crosses its threshold, it appends a hidden custom message asking the agent to use the handoff tool. The hidden
 message is sent with:

 ```ts
 pi.sendMessage(
   {
     customType: "context-guard-handoff",
     content: "...",
     display: false,
   },
   { triggerTurn: true, deliverAs: "followUp" },
 );
 ```

 This is the right primitive for `pi-goal` continuation and budget-limit messages under the append-only constraint.

 The existing `pi-handoff` tool uses a command context type to call `ctx.newSession()`. That works but is not the clean documented shape for normal tools. For `pi-goal`, use the
 captured `/goal` command context as the session-switching controller.

 ## Product Behavior

 ### Starting a Goal

 The canonical entrypoint is:

 ```text
 /goal <objective>
 ```

 When this runs, the extension should:

 1. Capture the `ExtensionCommandContext` for future automated handoffs.
 2. Persist a state entry with the active objective.
 3. Mark the goal `active`.
 4. Record the current session file as the first session in the goal lineage.
 5. Set a readable session name, for example `goal: <short objective>`.
 6. Update footer/status TUI.
 7. Append an initial hidden custom message to begin goal pursuit.

 The initial hidden message should be model-visible and display-hidden. It should tell the agent this is an active goal and instruct it to work until completion or budget handoff. It
 must be concise enough not to pollute context.

 Example initial message:

 ```text
 Active goal started.

 Objective:
 <objective>

 Work toward this objective. Before declaring completion, audit the actual current state: files, command output, tests, and other concrete evidence. If the goal is achieved and no
 required work remains, call update_goal with status "complete". If not complete, continue with the next concrete action.
 ```

 Use:

 ```ts
 pi.sendMessage({ customType: "pi-goal:continue", content, display: false }, { triggerTurn: true, deliverAs: "followUp" })
 ```

 ### Continuing a Goal

 After an agent turn ends, if the goal is still `active`, the extension should decide whether to continue or hand off.

 At `turn_end` or `agent_end`, inspect `ctx.getContextUsage()`.

 If usage is below the threshold and no handoff is in progress, append a hidden continuation message with `triggerTurn: true` and `deliverAs: "followUp"`.

 Continuation message should include:

 - Objective.
 - Current context usage percentage if known.
 - Instruction to avoid repeating completed work.
 - Completion audit requirements.
 - Instruction to call `update_goal({ status: "complete" })` only when complete.

 It should not include large state dumps. Conversation history already contains prior work and cache relies on stable history.

 ### Budget Limit

 Budget is not a separate user-supplied token budget in v1. Budget is the active model context window. The extension should treat 95% context usage as the hard budget limit.

 When `ctx.getContextUsage().percent >= 95`, transition the goal to `budget_limited` and append a hidden budget-limit message.

 Budget-limit message should ask the current agent to stop substantive work and produce a self-contained handoff prompt for the next session.

 The preferred implementation is to expose a `goal_handoff` tool and ask the agent to call it with a complete prompt. This gives structured capture and avoids needing to parse the
 assistant’s prose.

 Example budget-limit message:

 ```text
 The active goal has reached the context budget limit at <pct>% of the model context window.

 Do not start new substantive work in this session. Prepare a complete handoff for the next session and call goal_handoff.

 The handoff must include:
 - The active objective.
 - What has been completed.
 - Important decisions and constraints.
 - Files and commands that matter.
 - Known blockers or risks.
 - The exact next action the next session should take.

 Do not call update_goal unless the goal is actually complete.
 ```

 This mirrors Codex `budget_limit.md`, but changes the wrap-up target from “tell the user” to “call `goal_handoff` so the extension can continue automatically.”

 ### Automated Handoff

 When the agent calls `goal_handoff({ prompt })`, the extension should:

 1. Persist the handoff prompt in goal state.
 2. Mark the current session state as `handoff_started` or `budget_limited`.
 3. Defer session switching until the tool result is recorded in the old session.
 4. Call the captured command context’s `newSession({ parentSession, withSession })`.
 5. In the new session, set a readable session name with incremented sequence.
 6. Rehydrate active goal state for the new session.
 7. Send the handoff prompt as the first user message in the new session.
 8. Resume normal active goal continuation from there.

 The new session should be linked using:

 ```ts
 await capturedGoalCommandContext.newSession({
   parentSession: currentSessionFile,
   withSession: async (nextCtx) => {
     await nextCtx.sendUserMessage(finalPrompt);
   },
 });
 ```

 The new session header will include:

 ```json
 {"parentSession":"/path/to/original/session.jsonl"}
 ```

 This is not `/tree` branching inside one file. It is linked session lineage, like fork/clone/newSession parent metadata. That is correct because the purpose is to reset context.

 ### Completing a Goal

 The model should complete the goal only by calling:

 ```ts
 update_goal({ status: "complete" })
 ```

 The tool should reject any status other than `complete`.

 When complete, the extension should:

 1. Persist state `complete`.
 2. Stop automatic continuation.
 3. Clear or update TUI status.
 4. Append a visible concise completion message or tool result.
 5. Preserve lineage metadata for future inspection.

 The model must not mark complete simply because budget was reached.

 ### Pause, Resume, Clear

 User command controls should exist:

 ```text
 /goal pause
 /goal resume
 /goal clear
 /goal
 ```

 `/goal pause` sets state `paused` and stops automatic continuation.

 `/goal resume` sets state `active` and appends a hidden continuation message.

 `/goal clear` sets state `cleared` and removes active TUI status.

 Bare `/goal` opens or prints the goal summary.

 ## State Model

 State should be append-only through `pi.appendEntry()` so it respects session branching and survives reload.

 Use custom entry type:

 ```ts
 const STATE_ENTRY = "pi-goal:state";
 ```

 Suggested shape:

 ```ts
 interface GoalStateEntry {
   version: 1;
   event:
     | "created"
     | "status_changed"
     | "continued"
     | "budget_limited"
     | "handoff_requested"
     | "handoff_completed"
     | "completed"
     | "cleared";
   goalId: string;
   objective?: string;
   status?: "active" | "paused" | "budget_limited" | "handoff_started" | "complete" | "cleared";
   thresholdPercent?: number;
   contextPercent?: number | null;
   contextTokens?: number | null;
   contextWindow?: number | null;
   sessionIndex?: number;
   parentSession?: string;
   currentSession?: string;
   handoffPrompt?: string;
   timestamp: number;
 }
 ```

 Runtime reconstructed state:

 ```ts
 interface GoalRuntimeState {
   goalId: string;
   objective: string;
   status: "active" | "paused" | "budget_limited" | "handoff_started" | "complete" | "cleared";
   thresholdPercent: number;
   sessionIndex: number;
   sessions: string[];
   lastContextPercent: number | null;
   lastContextTokens: number | null;
   contextWindow: number | null;
   lastHandoffPrompt?: string;
   continuationInFlight: boolean;
   handoffInFlight: boolean;
   capturedCommandContext?: ExtensionCommandContext;
 }
 ```

 Rebuild state on `session_start` by scanning `ctx.sessionManager.getBranch()` for `custom` entries with `customType === "pi-goal:state"`.

 Do not put state into system prompt. Only append a model-visible hidden custom message when the runtime needs the agent to act.

 ## Tools

 ### `get_goal`

 Returns current reconstructed state, context usage, and lineage summary.

 This is safe for the model to call whenever it needs to re-ground.

 ### `create_goal`

 Creates a goal only if explicitly requested by the user or an existing command flow.

 Because automated handoff depends on captured command context, the preferred user-facing entrypoint should remain `/goal <objective>`. `create_goal` can exist for compatibility, but
 if it is used without captured command context, automated new-session handoff may not be available. In that case the tool result should say so.

 ### `update_goal`

 Accepts only:

 ```ts
 { status: "complete" }
 ```

 Reject pause, resume, budget-limit, handoff, and clear. Those are controlled by user command or runtime.

 ### `goal_handoff`

 Accepts:

 ```ts
 { prompt: string }
 ```

 The prompt must be complete and self-contained. The tool starts the new session through the captured command context if available.

 If no command context is available, the tool should persist the prompt and return a clear error explaining that automatic session switching requires the goal to be started via `/goal
 <objective>`.

 ## Commands

 ### `/goal <objective>`

 Start a new active goal and begin work.

 If a goal already exists and is non-terminal, prompt the user through `ctx.ui.confirm()` or `ctx.ui.select()` to replace or cancel.

 ### `/goal`

 Show current goal summary.

 Summary should include:

 - Objective.
 - Status.
 - Context usage.
 - Threshold.
 - Current session index.
 - Parent session if available.
 - Last handoff if available.
 - Available controls.

 ### `/goal pause`

 Pause current goal.

 ### `/goal resume`

 Resume current goal and append hidden continuation message.

 ### `/goal clear`

 Clear current goal.

 ### `/goal handoff`

 Optional manual control. It should ask the current agent to produce a `goal_handoff` prompt now. This is useful for testing and user-directed handoff, but not required for automatic
 budget flow.

 ## TUI Design

 The new UI should be minimal and Codex-like.

 ### Footer Status

 Use `ctx.ui.setStatus("goal", text)`.

 Examples:

 ```text
 goal: active 72%
 goal: budget 95%
 goal: paused
 goal: handoff 2
 goal: complete
 ```

 If no active goal exists, clear the status.

 ### Widget

 Use `ctx.ui.setWidget("goal", ...)` only while active, budget-limited, or handing off.

 Widget content should be compact:

 ```text
 Goal: Port Codex-style goal mode to pi-goal
 Status: active · context 72% / 95% · session 1
 Next: continuing automatically
 ```

 When budget-limited:

 ```text
 Goal: Port Codex-style goal mode to pi-goal
 Status: budget-limited · context 96% / 95% · handoff pending
 Next: waiting for goal_handoff
 ```

 When paused, either hide widget or show one small paused state depending on user preference.

 ### Overlay or Detail View

 Bare `/goal` can use either simple history output or `ctx.ui.custom()` overlay.

 The overlay can show:

 - Full objective.
 - Status.
 - Context usage.
 - Threshold.
 - Session index.
 - Parent/current session files.
 - Last handoff prompt preview.
 - Controls: pause, resume, clear, handoff now.

 Do not show worker task rows.

 ### Notifications

 Use sparse notifications for major transitions:

 - Goal started.
 - Goal paused.
 - Goal resumed.
 - Context budget reached.
 - Handoff started.
 - New session started.
 - Goal completed.

 Avoid frequent notifications on every continuation.

 ## Automation State Machine

 ```text
 none
   -> active                 /goal <objective>
 active
   -> active                 turn ends under 95%, continuation queued
 active
   -> budget_limited         turn ends at >= 95%, budget prompt queued
 budget_limited
   -> handoff_started        model calls goal_handoff
 handoff_started
   -> active                 new linked session starts and receives prompt
 active
   -> complete               model calls update_goal complete
 active
   -> paused                 user /goal pause
 paused
   -> active                 user /goal resume
 any non-none
   -> cleared                user /goal clear
 ```

 Continuation must be guarded to prevent duplicate follow-up turns.

 Use booleans like `continuationInFlight` and `handoffInFlight`, or persist event timestamps and inspect recent state.

 ## Context Budget Logic

 Use `ctx.getContextUsage()`.

 If usage is unavailable or `usage.percent === null`, continue conservatively but do not trigger budget handoff. In that case, the footer can show `goal: active ctx ?`, and the runtime can continue with normal continuation messages.

 Budget threshold should default to 95% of the current model context window.

 Suggested constants:

 ```ts
 const DEFAULT_CONTEXT_THRESHOLD_PERCENT = 95;
 const STATE_ENTRY = "pi-goal:state";
 const CONTINUE_MESSAGE_TYPE = "pi-goal:continue";
 const BUDGET_MESSAGE_TYPE = "pi-goal:budget-limit";
 const HANDOFF_MESSAGE_TYPE = "pi-goal:handoff";
 ```

 The budget check should run after each completed turn, preferably in `turn_end` because that is when `ctx.getContextUsage()` reflects the latest assistant usage plus trailing context estimation.

 Pseudocode:

 ```ts
 pi.on("turn_end", async (_event, ctx) => {
   const state = getRuntimeState(ctx);
   if (!state || state.status !== "active") return;
   if (state.continuationInFlight || state.handoffInFlight) return;

   const usage = ctx.getContextUsage();
   updateRuntimeUsage(state, usage);
   updateGoalTui(ctx, state);

   if (usage?.percent != null && usage.percent >= state.thresholdPercent) {
     await requestBudgetHandoff(ctx, state, usage);
     return;
   }

   queueContinuation(state);
 });
 ```

 The extension should avoid firing on every intermediate event. It should not check budget on every streamed token. The check at turn boundary is enough and matches the goal of stable, cache-friendly conversation history.

 ## Message Strategy

 The extension must not mutate the system prompt. All model-visible control happens through appended custom messages.

 Custom messages should use `display: false` for control-plane messages so the user does not see noisy internal steering.

 The continuation message should be short and stable. Avoid embedding large summaries. The conversation history is already the memory.

 The budget-limit message should be explicit and should request a structured tool call to `goal_handoff`.

 The new-session first message should be visible as a normal user message because it is the starting point of the next session. It should contain the handoff prompt created by the previous agent plus a short wrapper that states this is an automatic continuation of the active goal.

 Example new-session kickoff:

 ```text
 Continue this active goal from the previous session.

 Goal:
 <objective>

 Handoff from previous session:
 <agent-produced handoff prompt>

 Continue from the exact next action. If the goal is complete, call update_goal with status "complete". Otherwise keep working until completion or the next context-budget handoff.
 ```

 ## Session Lineage

 Pi sessions are JSONL files with a session header and tree entries.

 In-file branching through `/tree` uses entry `id` and `parentId` inside one session file. That is not appropriate for context-budget handoff because the whole point is to reset model context.

 New-session handoff should use `newSession({ parentSession })`. Pi records `parentSession` in the new session header. This is the same lineage field used for sessions created from `/fork`, `/clone`, or extension `newSession({ parentSession })`.

 Relevant references:

 - `/home/can/Projects/pi-mono/packages/coding-agent/docs/sessions.md`
 - `/home/can/Projects/pi-mono/packages/coding-agent/docs/session-format.md`
 - `/home/can/Projects/pi-mono/packages/coding-agent/src/core/session-manager.ts`
 - `/home/can/Projects/pi-mono/packages/coding-agent/src/core/agent-session-runtime.ts`

 `session-format.md` documents this header:

 ```json
 {"type":"session","version":3,"id":"uuid","timestamp":"...","cwd":"/path/to/project","parentSession":"/path/to/original/session.jsonl"}
 ```

 The goal runtime should also persist lineage events in `pi-goal:state`, because Pi's selector may expose parent metadata differently across UIs. Extension state should know the session index and parent/current file explicitly.

 ## Command Context Capture

 Automatic new-session handoff requires `ExtensionCommandContext` because `ctx.newSession()` is documented on command contexts.

 Normal events like `turn_end` receive `ExtensionContext`. Extension tools are wrapped with `runner.createContext()`, so they also receive normal `ExtensionContext` in the documented API. The current local `pi-handoff` casts tool ctx as `ExtensionCommandContext`, but `pi-goal` should not rely on that as a primary design.

 Therefore `/goal <objective>` is the canonical start path. It captures the command context and stores it in memory as the automation controller.

 Important lifecycle caveat: Pi warns that old contexts become stale after session replacement or reload. The handoff implementation must use the `withSession` callback's fresh context for post-switch actions. It should not use old `pi` or old command-context session-bound objects after `newSession()` resolves.

 Safe pattern:

 ```ts
 const currentSessionFile = ctx.sessionManager.getSessionFile();
 await capturedCommandCtx.newSession({
   parentSession: currentSessionFile,
   withSession: async (nextCtx) => {
     await nextCtx.sendUserMessage(kickoffPrompt);
   },
 });
 ```

 The captured command context is only for initiating `newSession()`. All work in the replacement session must use `nextCtx`.

 ## Handoff Tool Contract

 `goal_handoff` is a model-facing tool used only after budget-limit steering or optional manual `/goal handoff`.

 Tool description should be direct:

 ```text
 Prepare and start an automatic handoff for the active goal. Use only when pi-goal has told you the context budget is reached or the user explicitly requested a handoff. The prompt must be self-contained because the next session will not have this conversation history.
 ```

 Parameters:

 ```ts
 Type.Object({
   prompt: Type.String({
     description: "Complete handoff prompt for the next session. Include objective, completed work, decisions, files, commands, blockers, and exact next action."
   })
 })
 ```

 Tool behavior:

 1. Validate an active goal exists.
 2. Validate status is `budget_limited` or handoff was user-requested.
 3. Persist `handoff_requested` with prompt preview and context usage.
 4. Return a tool result immediately so the old session records the tool call.
 5. Use `setTimeout(..., 0)` or an equivalent deferred microtask to start the new session after the tool result is recorded.
 6. In the new session, persist a `handoff_completed` or `created` state event for the active goal.
 7. Send the kickoff user message.

 If captured command context is unavailable:

 - Persist the handoff prompt.
 - Return an error result saying automatic session switching requires starting the goal with `/goal <objective>`.
 - Do not silently drop the prompt.

 ## Completion Tool Contract

 `update_goal` should accept only `status: "complete"`.

 Parameters:

 ```ts
 Type.Object({
   status: StringEnum(["complete"] as const, {
     description: "Set to complete only when the objective is actually achieved and no required work remains."
   })
 })
 ```

 The tool result should include the final goal state and final context usage.

 The tool should persist a `completed` event and set `continuationInFlight = false`, `handoffInFlight = false`.

 It should clear the widget and update the footer to `goal: complete` briefly, or clear after a short delay.

 ## Current Extension Replacement

 The current `packages/pi-goal/index.ts` should be rewritten rather than incrementally patched.

 Remove or quarantine these v0 concepts from the default v1 path:

 - `.pi/goals/ACTIVE`
 - `.pi/goals/<slug>/STATE.json`
 - `.pi/goals/<slug>/tasks`
 - `.pi/goals/<slug>/results`
 - worker subprocess spawning
 - `goal add_task`
 - `goal run`
 - worker dashboard
 - learnings extraction

 If backward compatibility matters, add a legacy command later, for example `/goal-legacy`, but do not keep the old `goal` tool shape active in v1. The old tool shape conflicts with the Codex-style runtime because it encourages planning/task fanout instead of continuous main-agent execution.

 ## Implementation Plan

 ### Phase 1: State and Commands

 Implement append-only state events and runtime reconstruction.

 Add `/goal` command parser with:

 - bare summary
 - `pause`
 - `resume`
 - `clear`
 - `handoff`
 - objective creation/replacement

 Capture `ExtensionCommandContext` when starting or resuming via command.

 Add status/footer update helpers.

 ### Phase 2: Tools

 Register:

 - `get_goal`
 - `create_goal`
 - `update_goal`
 - `goal_handoff`

 Keep tool descriptions tight. If strict “no system prompt pollution” is interpreted to include custom tool prompt snippets/guidelines, omit `promptSnippet` and `promptGuidelines`. Tool descriptions themselves are necessary for tool schemas and are acceptable.

 ### Phase 3: Continuation Runtime

 Add `turn_end` handler.

 On active goal under threshold, append hidden continuation message with `pi.sendMessage(..., { triggerTurn: true, deliverAs: "followUp" })`.

 Guard against duplicate continuations.

 Update TUI after each turn.

 ### Phase 4: Budget-Limit Runtime

 Add context usage threshold check at 95%.

 On threshold crossing:

 - persist `budget_limited`
 - update TUI
 - append hidden budget-limit message asking for `goal_handoff`
 - set `handoffInFlight`

 Do not continue normal work after budget-limit.

 ### Phase 5: Automated Session Handoff

 Implement `goal_handoff` deferred new-session switch.

 Use `parentSession` to link the new session.

 Use `withSession` and `nextCtx.sendUserMessage()` for kickoff.

 Persist lineage state in the new session.

 Set session name with session index.

 ### Phase 6: TUI Detail View

 Add simple `/goal` summary first.

 Then optionally add `ctx.ui.custom()` overlay for richer controls.

 Keep this small. Do not rebuild old dashboard.

 ## Edge Cases

 ### User Sends Input During Active Goal

 If the user sends normal input while goal mode is active, the extension should treat that as user steering. It should not block it. After the turn ends, continuation logic resumes unless the goal was paused, completed, cleared, or budget-limited.

 ### Agent Stops Without Tool Call

 If the agent returns a final answer but does not call `update_goal`, and state remains active, the extension should continue. This matches Codex: completion requires explicit goal update.

 ### Agent Claims Completion in Text Only

 Do not mark complete from prose. Require `update_goal({ status: "complete" })`.

 ### Budget Reached Before Goal Starts

 If context is already above threshold when `/goal <objective>` starts, immediately request budget handoff rather than starting substantive work. The hidden message should ask for a handoff prompt, not continuation.

 ### No UI Mode

 If `ctx.hasUI` is false, TUI calls should be skipped. Core behavior can still run if sessions are persistent and model/auth are available. Automatic new-session handoff may be less useful outside interactive mode; return clear tool errors if `newSession()` cannot operate.

 ### Reload

 On `session_start` with reason `reload`, rebuild state from branch entries and update TUI. Captured command context will be lost on reload. If an active goal is found but no command context exists, continuation can still happen, but automated new-session handoff should report that `/goal resume` is needed to restore automatic handoff control.

 ### Session Switch

 On session switch/resume, rebuild from that session’s branch. Do not carry active in-memory goal state across unrelated sessions unless the state entries exist in the new branch.

 ### Stale Captured Context

 After handoff, the old captured context may become stale. The new session must capture a fresh command context if possible. Since the kickoff is a normal user message, not a command, the extension may not automatically have a new command context. To solve this, the handoff path should set a runtime controller during `withSession` using `nextCtx`, which is itself an `ExtensionCommandContext`/`ReplacedSessionContext` and can be retained for the next handoff in that new session.

 ### Multiple Goals

 V1 supports one active goal. If the user starts a new goal while one is active, ask to replace or cancel.

 ### Branching

 Because state is reconstructed from the active branch, `/tree` navigation can naturally expose different goal states if the branch includes different `pi-goal:state` entries. This is a benefit of append-only custom entries.

 ## Acceptance Criteria

 A user can run `/goal implement X` and the agent starts working without any further manual command.

 When the agent finishes a turn without completing the goal, the extension appends a hidden continuation message and triggers another turn automatically.

 When context usage reaches 95%, the extension stops normal continuation and asks the agent to call `goal_handoff`.

 When `goal_handoff` is called, the extension starts a new session linked with `parentSession` and sends the handoff prompt as the first user message.

 The new session continues the same active goal automatically.

 The model cannot mark goals paused, resumed, budget-limited, or cleared through `update_goal`.

 The model can mark complete only with `update_goal({ status: "complete" })`.

 The extension does not use `before_agent_start` to alter the system prompt.

 The extension does not use `before_provider_request` to patch provider payloads.

 The extension does not rewrite existing session history.

 Footer status shows active/paused/budget/handoff/complete state.

 Bare `/goal` shows objective, status, context usage, and session lineage.

 Old worker dashboard behavior is not present in the v1 default path.

 ## Testing Plan

 Manual tests:

 1. Start `/goal write a short file and verify it` in a small repo. Confirm a hidden continuation triggers if the agent stops without `update_goal`.
 2. Ask the agent to call `update_goal` only after completion. Confirm continuation stops.
 3. Temporarily set threshold to a low value like 1% for testing. Confirm budget-limit message is appended.
 4. Confirm model calls `goal_handoff` and a new linked session starts.
 5. Confirm new session receives the handoff prompt and continues.
 6. Confirm `/goal pause` stops continuation.
 7. Confirm `/goal resume` restarts continuation.
 8. Confirm `/goal clear` clears status and prevents continuation.
 9. Reload extensions during an active goal. Confirm state reconstructs and UI updates.
 10. Use `/tree` to navigate before goal creation. Confirm reconstructed state follows active branch.

 Automated tests are limited unless the extension repo has a harness for Pi extension runtime. If no harness exists, add pure unit tests for state reconstruction and command parsing where practical.

 ## Risks

 ### User-Role Steering

 Pi extension custom messages become user-role messages. Codex uses developer-role injected pending input. This is not a perfect authority match. The design compensates with clear wording and explicit tool contracts.

 ### Infinite Loops

 Automatic continuation can loop forever if the model never completes or hands off. Mitigations:

 - hard stop at 95% context
 - require explicit completion tool
 - allow `/goal pause` and `/goal clear`
 - optional max continuation count per session

 ### Stale Context After Reload

 Captured command context is in-memory and can be lost. Mitigation: detect active goal with no automation controller and tell the user to run `/goal resume` if automatic handoff is required.

 ### Session Switch Footguns

 Pi warns against using stale contexts after session replacement. The implementation must put all post-switch actions inside `withSession` and use `nextCtx`.

 ### Tool Prompt Pollution

 Tool descriptions are included in model tool metadata. If the strict no-system-prompt rule is interpreted broadly, avoid `promptSnippet` and `promptGuidelines`. Do not add active goal state to system prompt.

 ## Open Decisions

 Should `/goal resume` be required after extension reload to restore automatic handoff controller, or can `withSession`/session events provide a safe replacement controller in all cases?

 Should the threshold be fixed at 95%, or configurable via package setting/command?

 Should budget handoff happen at exactly `>= 95%`, or should it request handoff at 95% and hard-stop at a higher emergency value like 98%?

 Should the old file-backed `.pi/goals` data be ignored, migrated, or exposed through a legacy command?

 Should the footer show exact context percent or a coarse state only?

 Should the new session name include sequence numbers, for example `goal: short objective (2)`, or rely only on parent metadata?

 ## Recommended V1 Defaults

 Use `/goal <objective>` as the canonical start path.

 Use a fixed 95% context threshold.

 Use append-only `pi-goal:state` custom entries for state.

 Use hidden `pi.sendMessage()` custom messages for continuation and budget-limit steering.

 Use `goal_handoff` for structured summary capture and automated linked-session creation.

 Use `newSession({ parentSession })`, not `/tree`, for budget handoffs.

 Use footer status plus a small widget. Delay complex overlay until core runtime works.

 Remove worker orchestration from the default v1 API.

 ## Summary

 The rewrite should make `pi-goal` a Codex-style long-running main-agent runtime adapted to Pi extension constraints.

 Codex gives us the product shape: one active objective, runtime-owned budget/status, main-agent continuation, model-only completion, and compact UI. Pi extension constraints change the mechanism: no developer-role injection and no system prompt mutation, so control happens through hidden appended custom messages and command-context-driven session handoff.

 The result should feel like goal mode rather than a task runner: start one goal, let the main agent continue, automatically hand off at 95% context, and preserve session lineage across consecutive sessions.
