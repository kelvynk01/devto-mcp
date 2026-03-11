# devto-mcp

DevTo is an AI work manager that runs inside Claude Code via MCP. It takes feature descriptions, generates structured plans (epics, stories, subtasks), and pushes them to your project tracker. AI planning runs locally using your own Anthropic key — your code context never leaves your machine.

## Install

```bash
npm install -g devto-mcp
```

Requires Node.js >= 18 and [Claude Code](https://claude.ai/claude-code).

## Setup

1. Create an account and get an API key at [devto.ai](https://devto.ai)

2. Log in and configure your Anthropic key:

```bash
devto login
devto config set anthropic-key sk-ant-xxxx
```

3. Connect to Claude Code:

```bash
devto init
```

## Usage

In Claude Code:

```
> create a plan for the password reset flow
```

DevTo generates a structured plan. Run `confirm_plan` to push it to your project tracker.

## CLI commands

| Command | Description |
|---|---|
| `devto login` | Authenticate with your API key |
| `devto status` | Show connection and usage info |
| `devto init` | Auto-configure MCP in Claude Code |
| `devto doctor` | Run diagnostics |
| `devto sync` | Re-sync workspace config |
| `devto config set anthropic-key` | Store your Anthropic key locally |

## MCP tools

| Tool | Description |
|---|---|
| `create_plan` | Generate a plan from a feature description |
| `confirm_plan` | Execute a plan and create all work items |
| `create_epic` | Create an epic |
| `create_task` | Create a task or story |
| `create_subtask` | Create a subtask under a parent |
| `get_tasks` | List open tasks |
| `update_task` | Update a task's status |
| `get_status` | Get project summary |

## Dashboard

Manage your workspace, API keys, and billing at [devto.ai/dashboard](https://devto.ai/dashboard).

## License

MIT — see [LICENSE](./LICENSE).
