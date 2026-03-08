#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { getApiKey } from "./config";
import { DevToApiError } from "./client";
import {
  createPlan,
  confirmPlan,
  createEpic,
  createTask,
  createSubtask,
  getTasks,
  updateTask,
  getStatus,
} from "./tools";

const CURRENT_VERSION = "0.1.0";

// Auto-update check (non-blocking)
(async () => {
  try {
    const res = await fetch("https://registry.npmjs.org/devto-mcp/latest", {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as { version?: string };
      if (data.version && data.version !== CURRENT_VERSION) {
        console.error(
          `[devto-mcp] DevTo v${data.version} is available. Run npm update -g devto-mcp to update.`
        );
      }
    }
  } catch {
    // Silently ignore — don't block startup
  }
})();

// Fail fast if no API key is configured
try {
  getApiKey();
} catch (err) {
  console.error(`[devto-mcp] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const server = new Server(
  {
    name: "devto",
    version: CURRENT_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ─── Tool definitions ────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "create_plan",
      description:
        "Generate an AI-powered project plan from a feature description. Returns a structured preview with epic, stories, and subtasks. Nothing is tracked until confirm_plan is called.",
      inputSchema: {
        type: "object",
        properties: {
          feature_description: {
            type: "string",
            description: "A description of the feature or work to plan",
          },
        },
        required: ["feature_description"],
      },
    },
    {
      name: "confirm_plan",
      description:
        "Execute a previously generated plan by tracking all work items (epic, stories, subtasks). Only call this after the user has reviewed and approved the plan from create_plan.",
      inputSchema: {
        type: "object",
        properties: {
          plan_id: {
            type: "string",
            description: "The plan ID returned by create_plan",
          },
        },
        required: ["plan_id"],
      },
    },
    {
      name: "create_epic",
      description: "Create a single epic in your project",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Epic title" },
          description: { type: "string", description: "Epic description" },
        },
        required: ["title", "description"],
      },
    },
    {
      name: "create_task",
      description:
        "Create a single story or task, optionally linked to an epic. You can reference the epic by exact key or natural description.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title" },
          description: { type: "string", description: "Task description" },
          epic_key: {
            type: "string",
            description: "Optional epic key (e.g. PROJ-1) or description to link this task to",
          },
        },
        required: ["title", "description"],
      },
    },
    {
      name: "create_subtask",
      description:
        "Create a subtask under a parent issue. You can reference the parent by exact key or natural description.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Subtask title" },
          description: { type: "string", description: "Subtask description" },
          parent_key: {
            type: "string",
            description: "Parent issue key (e.g. PROJ-5) or a natural language description",
          },
        },
        required: ["title", "description", "parent_key"],
      },
    },
    {
      name: "get_tasks",
      description:
        "Get open tasks (To Do + In Progress) for your project. Optionally filter by epic.",
      inputSchema: {
        type: "object",
        properties: {
          epic_key: {
            type: "string",
            description: "Optional epic key to filter tasks (e.g. PROJ-1)",
          },
        },
        required: [],
      },
    },
    {
      name: "update_task",
      description:
        "Update the status of a task. You can use an exact key (e.g. PROJ-5) or a natural description (e.g. 'the auth task'). If ambiguous, DevTo will ask which task you mean.",
      inputSchema: {
        type: "object",
        properties: {
          issue_key: {
            type: "string",
            description: "Issue key (e.g. PROJ-5) or a natural language description of the task",
          },
          status: {
            type: "string",
            enum: ["todo", "in_progress", "in_review", "done"],
            description: "New status for the task",
          },
        },
        required: ["issue_key", "status"],
      },
    },
    {
      name: "get_status",
      description: "Get a summary of your project: task counts and current sprint",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  ],
}));

// ─── Tool handler ────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      case "create_plan":
        result = await createPlan(args?.feature_description as string);
        break;

      case "confirm_plan":
        result = await confirmPlan(args?.plan_id as string);
        break;

      case "create_epic":
        result = await createEpic(
          args?.title as string,
          args?.description as string
        );
        break;

      case "create_task":
        result = await createTask(
          args?.title as string,
          args?.description as string,
          args?.epic_key as string | undefined
        );
        break;

      case "create_subtask":
        result = await createSubtask(
          args?.title as string,
          args?.description as string,
          args?.parent_key as string
        );
        break;

      case "get_tasks":
        result = await getTasks(args?.epic_key as string | undefined);
        break;

      case "update_task":
        result = await updateTask(
          args?.issue_key as string,
          args?.status as string
        );
        break;

      case "get_status":
        result = await getStatus();
        break;

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    return {
      content: [{ type: "text", text: result }],
    };
  } catch (err) {
    if (err instanceof McpError) throw err;

    const message =
      err instanceof DevToApiError
        ? `DevTo API error: ${err.message}${err.code ? ` (${err.code})` : ""}`
        : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;

    return {
      content: [{ type: "text", text: message }],
      isError: true,
    };
  }
});

// ─── Start server ────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[devto-mcp] Server started");
}

main().catch((err) => {
  console.error("[devto-mcp] Fatal error:", err);
  process.exit(1);
});
