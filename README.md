# devto-mcp

AI work management for [Claude Code](https://claude.ai/claude-code). Plan features, break them into epics and stories, and track everything — without leaving your terminal.

## Install

```bash
npm install -g devto-mcp
```

## Quick start

### 1. Sign up and get an API key

Create a free account at [devto.dev](https://devto.dev) and generate an API key from the dashboard.

### 2. Log in

```bash
devto login
```

Paste your API key when prompted.

### 3. Set your Anthropic key

DevTo uses your own Anthropic API key for AI planning. Your key stays on your machine — it's never sent to our servers.

```bash
devto config set anthropic-key
```

### 4. Connect to Claude Code

```bash
devto init
```

This auto-configures the MCP server in your Claude Code settings.

### 5. Start planning

Open Claude Code and try:

```
> create a plan for the password reset flow
```

DevTo will generate a structured plan with an epic, stories, and subtasks. Confirm to track them all.

## CLI commands

| Command | Description |
|---|---|
| `devto login` | Authenticate with your DevTo API key |
| `devto status` | Show connection status, project info, and usage |
| `devto init` | Auto-configure MCP in Claude Code |
| `devto doctor` | Run diagnostics (API, workspace, Anthropic key) |
| `devto sync` | Re-sync workspace configuration |
| `devto verbose` | Toggle verbose API logging |
| `devto config set anthropic-key` | Store your Anthropic API key locally |

## MCP tools

When connected to Claude Code, these tools are available:

| Tool | Description |
|---|---|
| `create_plan` | Generate an AI-powered plan from a feature description |
| `confirm_plan` | Execute a plan and track all work items |
| `create_epic` | Create a single epic |
| `create_task` | Create a task or story |
| `create_subtask` | Create a subtask under a parent |
| `get_tasks` | List open tasks in your project |
| `update_task` | Move a task to a new status |
| `get_status` | Get a summary of your project |

All tools support **semantic matching** — you can reference tasks by name (e.g., "the auth task") instead of exact issue keys.

## How it works

```
You (Claude Code) → devto-mcp (local) → DevTo API (cloud) → Jira
                         ↕
                   Anthropic API
                   (your key, local)
```

- **AI calls happen locally** using your Anthropic key — your code context never leaves your machine
- **DevTo API** handles workspace config, plan storage, and Jira operations
- **Jira** is the output mechanism — DevTo is the planning layer

## Architecture

- Plans are previewed before anything is created (`create_plan` → `confirm_plan`)
- API keys are hashed with SHA-256 — raw keys are shown once at creation
- All requests include an `X-DevTo-Version` header for version tracking
- Config is stored in `~/.devto/config.json`

## Pricing

| Plan | Price | Includes |
|---|---|---|
| Free | $0 | 1 dev, 1 project, 50 actions/month |
| Pro | $15/seat/mo | Unlimited everything, 7-day trial |
| Team | $12/seat/mo | 5+ seats, shared workspace config |

All plans use BYOK (Bring Your Own Key) for Anthropic.

## Requirements

- Node.js >= 18
- Claude Code
- An Anthropic API key
- A DevTo account ([sign up free](https://devto.dev/sign-up))

## License

MIT — see [LICENSE](./LICENSE).

**Trademark notice:** "DevTo" and the DevTo name are trademarks. You are free to fork and modify this package under the MIT license, but you may not use the DevTo name, logo, or brand in derivative products or services without prior written permission.
