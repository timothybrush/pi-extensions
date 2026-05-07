# pi-tmux

Tmux pane management for [pi](https://github.com/earendil-works/pi). Run dev servers, watchers, and long-running processes in named panes without blocking the agent.

## Install

```bash
pi install npm:@ogulcancelik/pi-tmux
```

Or add manually to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["npm:@ogulcancelik/pi-tmux"]
}
```

## What it does

Gives the agent a `tmux` tool with five actions:

| Action | Description |
|--------|-------------|
| **run** | Start a command in a named pane |
| **read** | Capture output from a named pane |
| **send** | Send keys (`C-c`, `Enter`, etc.) or literal text to a pane |
| **stop** | Kill a named pane |
| **list** | List all managed panes |

The agent uses `tmux run` for long-running processes (dev servers, file watchers, builds) and `bash` for short-lived commands. This keeps the agent unblocked while background processes run.

If you are using [herdr](https://github.com/ogulcancelik/herdr), use [`pi-herdr`](https://github.com/ogulcancelik/pi-extensions/tree/main/packages/pi-herdr) instead. `pi-herdr` exists specifically for herdr-native pane, tab, workspace, output watch, and agent-status workflows. `pi-tmux` is for plain tmux sessions.

## Layout

Pi runs on the left. The first worker pane splits to the right. Additional panes stack vertically below existing ones. You can override with `position: "right"` or `position: "bottom"`.

## How it works

- Panes are tagged with `@pi_name` tmux user options for reliable discovery
- ANSI escape sequences are stripped from captured output
- Dead panes are automatically replaced on `run`
- The tool self-disables when pi is not running inside tmux
- The tool also self-disables when `HERDR_ENV` is present, so herdr can own pane orchestration inside herdr-managed tmux sessions

## Requirements

- [pi](https://github.com/earendil-works/pi) v0.40+
- [tmux](https://github.com/tmux/tmux) — pi must be running inside a tmux session without `HERDR_ENV`

## License

MIT
