import Anthropic from "@anthropic-ai/sdk";
import { callApi } from "./client";
import { getAnthropicKey } from "./config";

// ─── Types ──────────────────────────────────────────────────────────────────

type Plan = {
  epic: { title: string; description: string };
  stories: Array<{
    title: string;
    description: string;
    acceptance_criteria: string[];
    subtasks: Array<{ title: string; description: string }>;
  }>;
  clarification_needed: boolean;
  clarification_question: string | null;
};

type PlanResponse = {
  plan_id: string;
  plan: Plan;
};

type ConfirmResponse = {
  plan_id: string;
  epic_key: string;
  tickets: string[];
};

type EpicResponse = { key: string; url: string };
type TaskResponse = { key: string; url: string };
type SubtaskResponse = { key: string; url: string };

type TasksResponse = {
  tasks: Array<{
    key: string;
    url: string;
    title: string;
    status: string;
    type: string;
    assignee: string | null;
    parent: { key: string; title: string } | null;
  }>;
  total: number;
};

type StatusResponse = {
  project: string;
  workspace_url: string;
  total_tasks: number;
  open_tasks: number;
  in_progress_tasks: number;
  completed_tasks: number;
  current_sprint: string | null;
};

type ProjectSummaryResponse = {
  project: string;
  issues: Array<{
    key: string;
    title: string;
    status: string;
    assignee: string | null;
    parent_key: string | null;
    epic_name: string | null;
  }>;
  total: number;
};

// ─── Anthropic system prompt ────────────────────────────────────────────────

const PLAN_SYSTEM_PROMPT = `You are DevTo, an AI work manager for software developers. Your job is to take a feature description and break it into a structured development plan. Always return a JSON object with this exact structure and nothing else — no preamble, no markdown, just the JSON:
{
  "epic": { "title": "string", "description": "string" },
  "stories": [
    {
      "title": "string",
      "description": "string",
      "acceptance_criteria": ["string"],
      "subtasks": [{ "title": "string", "description": "string" }]
    }
  ],
  "clarification_needed": false,
  "clarification_question": null
}
If the feature description is too vague to generate a meaningful plan, set clarification_needed to true and provide a specific clarifying question. Otherwise set it to false and generate the full plan. Keep story titles concise. Write descriptions in plain English. Acceptance criteria must be testable statements. Generate between 2 and 6 stories per epic. Generate between 1 and 4 subtasks per story. Never generate more work than what is described. Never invent requirements that were not mentioned.`;

// ─── Semantic ticket matching ────────────────────────────────────────────────

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

type TaskEntry = {
  key: string;
  url: string;
  title: string;
  status: string;
  type: string;
  assignee: string | null;
  parent: { key: string; title: string } | null;
};

/**
 * Score how well a query matches a task's title and context.
 * Returns a value between 0 and 1.
 */
function scoreMatch(query: string, task: TaskEntry): number {
  const q = query.toLowerCase().trim();
  const title = task.title.toLowerCase();
  const parentTitle = task.parent?.title?.toLowerCase() ?? "";
  const combinedText = `${title} ${parentTitle}`;

  // Exact title match
  if (title === q) return 1.0;

  // Title contains the full query
  if (title.includes(q)) return 0.92;

  // Combined text contains the full query
  if (combinedText.includes(q)) return 0.85;

  // Word-level overlap scoring
  const queryWords = q.split(/\s+/).filter((w) => w.length > 1);
  if (queryWords.length === 0) return 0;

  const titleWords = new Set(combinedText.split(/\s+/).filter((w) => w.length > 1));
  let matchedWords = 0;
  let partialScore = 0;

  for (const qw of queryWords) {
    if (titleWords.has(qw)) {
      matchedWords++;
    } else {
      // Check partial word matches (e.g. "auth" matches "authentication")
      for (const tw of titleWords) {
        if (tw.includes(qw) || qw.includes(tw)) {
          partialScore += 0.5;
          break;
        }
      }
    }
  }

  const wordScore = (matchedWords + partialScore) / queryWords.length;
  return Math.min(wordScore * 0.88, 0.88);
}

/**
 * Resolve an ambiguous reference to an issue key.
 * If the input looks like a valid key (e.g. PROJ-5), returns it directly.
 * Otherwise, fetches tasks and attempts semantic matching.
 *
 * Returns either:
 *   { resolved: true, key: string } — exact or high-confidence match
 *   { resolved: false, prompt: string } — disambiguation needed
 */
export async function resolveIssueKey(
  input: string
): Promise<{ resolved: true; key: string } | { resolved: false; prompt: string }> {
  // If it already looks like a valid issue key, pass through
  if (ISSUE_KEY_PATTERN.test(input.trim().toUpperCase())) {
    return { resolved: true, key: input.trim().toUpperCase() };
  }

  // Fetch all open tasks for matching
  const res = await callApi<TasksResponse>("GET", "/api/v1/tasks");

  if (res.total === 0) {
    return {
      resolved: false,
      prompt: `No open tasks found in your project. I couldn't resolve "${input}" to a ticket. Use an exact key like PROJ-5, or create the task first.`,
    };
  }

  // Score all tasks against the query
  const scored = res.tasks
    .map((task) => ({ task, score: scoreMatch(input, task) }))
    .filter((s) => s.score > 0.15)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    // No matches — show all open tasks so the developer can pick
    const lines = [
      `I couldn't find a task matching "${input}". Here are your open tasks:`,
      ``,
    ];
    res.tasks.slice(0, 5).forEach((task, i) => {
      lines.push(`${i + 1}. **${task.key}** — ${task.title} (${task.status})`);
    });
    if (res.total > 5) {
      lines.push(``, `...and ${res.total - 5} more. Use \`get_tasks\` to see all.`);
    }
    lines.push(``, `Which one did you mean? Reply with the key (e.g. ${res.tasks[0].key}).`);
    return { resolved: false, prompt: lines.join("\n") };
  }

  const best = scored[0];

  // High confidence (>= 90%) — state the match, ask for single confirmation
  if (best.score >= 0.9) {
    return {
      resolved: false,
      prompt: `I'm pretty sure you mean **${best.task.key}** — ${best.task.title} (${best.task.status}). Is that right? Reply **yes** or give me a different key.`,
    };
  }

  // Lower confidence — show top 2-3 matches
  const topMatches = scored.slice(0, 3);
  const lines = [
    `I found a few tasks that might match "${input}":`,
    ``,
  ];
  topMatches.forEach((s, i) => {
    lines.push(
      `${i + 1}. **${s.task.key}** — ${s.task.title} (${s.task.status})`
    );
  });
  lines.push(
    ``,
    `Which one did you mean? Reply with the number or the key.`
  );
  return { resolved: false, prompt: lines.join("\n") };
}

// ─── Tool handlers ───────────────────────────────────────────────────────────

export async function createPlan(featureDescription: string): Promise<string> {
  // 1. Get Anthropic key from local config
  let anthropicKey: string;
  try {
    anthropicKey = getAnthropicKey();
  } catch {
    return [
      "**Anthropic API key not configured.**",
      "",
      "The `create_plan` tool uses the Anthropic API to generate AI-powered plans locally on your machine.",
      "",
      "To set it up, run this in your terminal:",
      "```",
      "devto config set anthropic-key sk-ant-xxxx",
      "```",
      "",
      "Get your key at: https://console.anthropic.com/settings/keys",
    ].join("\n");
  }

  // 2. Call Anthropic API directly
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  let plan: Plan;
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: PLAN_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: featureDescription,
        },
      ],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from Anthropic API");
    }

    plan = JSON.parse(textBlock.text) as Plan;
  } catch (err: unknown) {
    // Handle Anthropic 429 rate limit errors
    if (
      err &&
      typeof err === "object" &&
      "status" in err &&
      (err as { status: number }).status === 429
    ) {
      return "Your Anthropic API key has hit its rate limit. Please wait a few minutes or check your usage at console.anthropic.com.";
    }
    throw err;
  }

  // 3. If clarification needed, return the question
  if (plan.clarification_needed) {
    return `I need a bit more detail before I can build a plan.\n\n**Question:** ${plan.clarification_question}`;
  }

  // 4. Save the structured plan to the backend
  const res = await callApi<PlanResponse>("POST", "/api/v1/plan", {
    plan,
  });

  const { plan_id } = res;

  // 5. Return formatted plan preview
  const lines: string[] = [
    `## Plan Preview — ${plan.epic.title}`,
    ``,
    `**Epic:** ${plan.epic.title}`,
    `${plan.epic.description}`,
    ``,
    `**Stories:**`,
  ];

  plan.stories.forEach((story, i) => {
    lines.push(``, `### ${i + 1}. ${story.title}`);
    lines.push(story.description);
    if (story.acceptance_criteria.length > 0) {
      lines.push(``, `**Acceptance Criteria:**`);
      story.acceptance_criteria.forEach((ac) => lines.push(`- ${ac}`));
    }
    if (story.subtasks.length > 0) {
      lines.push(``, `**Subtasks:**`);
      story.subtasks.forEach((st) => lines.push(`- ${st.title}`));
    }
  });

  lines.push(
    ``,
    `---`,
    `**Plan ID:** \`${plan_id}\``,
    ``,
    `This plan has NOT been tracked yet. To track this work, say: **"confirm plan ${plan_id}"**`
  );

  return lines.join("\n");
}

export async function confirmPlan(planId: string): Promise<string> {
  const res = await callApi<ConfirmResponse>("POST", `/api/v1/confirm/${planId}`);

  const lines = [
    `## Done. Tracked.`,
    ``,
    `**Epic:** ${res.epic_key}`,
    ``,
    `**All tickets (${res.tickets.length}):**`,
    ...res.tickets.map((url) => `- ${url}`),
  ];

  return lines.join("\n");
}

export async function createEpic(title: string, description: string): Promise<string> {
  const res = await callApi<EpicResponse>("POST", "/api/v1/epic", { title, description });
  return `Done. I've tracked that as **${res.key}**.\n${res.url}`;
}

export async function createTask(
  title: string,
  description: string,
  epicKey?: string
): Promise<string> {
  let resolvedEpicKey = epicKey;

  // Resolve ambiguous epic references
  if (epicKey) {
    const resolved = await resolveIssueKey(epicKey);
    if (!resolved.resolved) {
      return resolved.prompt;
    }
    resolvedEpicKey = resolved.key;
  }

  const res = await callApi<TaskResponse>("POST", "/api/v1/task", {
    title,
    description,
    epic_key: resolvedEpicKey,
  });
  return `Done. I've tracked that as **${res.key}**.\n${res.url}`;
}

export async function createSubtask(
  title: string,
  description: string,
  parentKey: string
): Promise<string> {
  // Resolve ambiguous parent references
  const resolved = await resolveIssueKey(parentKey);
  if (!resolved.resolved) {
    return resolved.prompt;
  }

  const res = await callApi<SubtaskResponse>("POST", "/api/v1/subtask", {
    title,
    description,
    parent_key: resolved.key,
  });
  return `Done. I've tracked that as **${res.key}**.\n${res.url}`;
}

export async function getTasks(epicKey?: string): Promise<string> {
  let resolvedEpicKey = epicKey;

  // Resolve ambiguous epic references
  if (epicKey) {
    const resolved = await resolveIssueKey(epicKey);
    if (!resolved.resolved) {
      return resolved.prompt;
    }
    resolvedEpicKey = resolved.key;
  }

  const path = resolvedEpicKey ? `/api/v1/tasks/${resolvedEpicKey}` : "/api/v1/tasks";
  const res = await callApi<TasksResponse>("GET", path);

  if (res.total === 0) {
    return epicKey
      ? `No open tasks found under epic ${epicKey}.`
      : "No open tasks found in the project.";
  }

  const lines = [
    `## Open Tasks${epicKey ? ` — ${epicKey}` : ""} (${res.total})`,
    ``,
  ];

  res.tasks.forEach((task) => {
    lines.push(`**${task.key}** — ${task.title}`);
    lines.push(`  Status: ${task.status} | Type: ${task.type}${task.assignee ? ` | Assignee: ${task.assignee}` : ""}`);
    if (task.parent) lines.push(`  Parent: ${task.parent.key} — ${task.parent.title}`);
    lines.push(`  ${task.url}`);
    lines.push(``);
  });

  return lines.join("\n");
}

export async function updateTask(issueKey: string, status: string): Promise<string> {
  // Resolve ambiguous references
  const resolved = await resolveIssueKey(issueKey);
  if (!resolved.resolved) {
    return resolved.prompt;
  }

  await callApi("PUT", `/api/v1/task/${resolved.key}`, { status });
  return `Moved **${resolved.key}** to \`${status}\`.`;
}

export async function getProjectSummary(): Promise<string> {
  const res = await callApi<ProjectSummaryResponse>("GET", "/api/v1/project/summary");

  if (res.total === 0) {
    return "No open or in-progress tasks found in the project.";
  }

  const lines = [
    `## Project Summary — ${res.project} (${res.total} active)`,
    ``,
  ];

  res.issues.forEach((issue) => {
    const parts = [`**${issue.key}** — ${issue.title} (${issue.status})`];
    if (issue.assignee) parts.push(`  Assignee: ${issue.assignee}`);
    if (issue.parent_key) parts.push(`  Parent: ${issue.parent_key}${issue.epic_name ? ` — ${issue.epic_name}` : ""}`);
    lines.push(parts.join("\n"));
    lines.push(``);
  });

  return lines.join("\n");
}

export async function getStatus(): Promise<string> {
  const res = await callApi<StatusResponse>("GET", "/api/v1/status");

  const lines = [
    `## Project Status — ${res.project}`,
    ``,
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Total tasks | ${res.total_tasks} |`,
    `| Open | ${res.open_tasks} |`,
    `| In Progress | ${res.in_progress_tasks} |`,
    `| Done | ${res.completed_tasks} |`,
  ];

  if (res.current_sprint) {
    lines.push(``, `**Current Sprint:** ${res.current_sprint}`);
  }

  return lines.join("\n");
}
