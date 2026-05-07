# pi-spar

Agent-to-agent sparring for [pi](https://github.com/earendil-works/pi). Back-and-forth conversations with peer AI models for debugging, design review, and challenging your thinking.

## Install

```bash
pi install npm:@ogulcancelik/pi-spar
```

## Setup

Configure which models are available for sparring:

```
/spmodels
```

This shows all models from your pi configuration and lets you assign short aliases (e.g., `opus`, `gpt`).

> **Note:** After changing model aliases, restart pi for the agent to see the updated aliases. The aliases work immediately for tool execution, but the agent's tool description updates on next startup.

## Usage

The extension provides a `spar` tool the agent can use, plus commands for viewing sessions.

### Tool: `spar`

The agent uses this when you ask it to consult another model:

```
"spar with gpt about whether this architecture makes sense"
"ask opus to review the error handling in src/auth.ts"
```

Sessions persist — follow up, push back, disagree. The peer can read files, grep, and explore your codebase but can't execute commands or write files.

### Commands

| Command | Description |
|---------|-------------|
| `/spmodels` | Configure available sparring models |
| `/spar [session]` | Watch a spar session in a floating overlay |
| `/spview` | Browse all sessions — view, peek, or delete |

### Peek overlay

`/spar` opens a floating overlay that renders the spar conversation using the same components as pi's main TUI — same message styling, same syntax-highlighted tool output, same everything. It's pi inside pi.

![peek overlay demo](./assets/peek-demo.jpg)

- **j/k** or **↑/↓** — scroll
- **g/G** — jump to top/bottom
- **q** or **Esc** — close

Live sessions auto-scroll as the peer model responds.

### Session browser

`/spview` opens an inline session browser:

- **j/k** or **↑/↓** — navigate
- **enter** — open peek overlay for selected session
- **d** — delete selected session
- **D** — delete all non-active sessions
- **q** or **Esc** — close

## License

MIT
