#!/usr/bin/env node
/**
 * DevTo CLI — devto <command>
 *
 * Commands:
 *   devto login                          Authenticate with your DevTo API key
 *   devto status                         Show current connection status
 *   devto init                           Auto-configure Claude Code MCP config
 *   devto doctor                         Test full connection chain
 *   devto sync                           Re-sync workspace configuration
 *   devto verbose                        Toggle verbose mode
 *   devto config set anthropic-key <key> Store Anthropic API key
 */

import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  readConfig,
  writeConfig,
  getApiUrl,
  getAnthropicKey,
  isVerbose,
  setVerbose,
  setAnthropicKey,
} from "./config";

const command = process.argv[2];

async function prompt(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (hidden && process.stdout.isTTY) {
      process.stdout.write(question);
      let value = "";
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");

      const onData = (char: string) => {
        if (char === "\n" || char === "\r" || char === "\u0003") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          rl.close();
          resolve(value);
        } else if (char === "\u007f") {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      };

      process.stdin.on("data", onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

async function validateKey(apiKey: string): Promise<boolean> {
  const apiUrl = process.env.DEVTO_API_URL ?? "https://api.devto.ai";
  try {
    const res = await fetch(`${apiUrl}/api/v1/status`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-DevTo-Version": "0.1.5",
      },
    });
    // 200 = valid key, 401 = invalid
    return res.status !== 401;
  } catch {
    // Network error — can't validate, but save anyway
    return true;
  }
}

async function login() {
  console.log("\nDevTo Login\n");
  console.log("Get your API key from: https://devto.ai/dashboard/keys\n");

  const apiKey = await prompt("Paste your API key: ", true);

  if (!apiKey || !apiKey.startsWith("devto_")) {
    console.error(
      "\nInvalid key format. DevTo API keys start with 'devto_'.\nGet your key at https://devto.ai/dashboard/keys\n"
    );
    process.exit(1);
  }

  process.stdout.write("Validating... ");
  const valid = await validateKey(apiKey);

  if (!valid) {
    console.error("\nInvalid API key. Check your key at https://devto.ai/dashboard/keys\n");
    process.exit(1);
  }

  const apiUrl = process.env.DEVTO_API_URL ?? "https://api.devto.ai";
  writeConfig({ api_key: apiKey, api_url: apiUrl });

  console.log("OK\n");
  console.log("Logged in! Your API key is saved to ~/.devto/config.json\n");

  // Prompt for Anthropic key
  console.log("────────────────────────────────────────────────");
  console.log("DevTo uses the Anthropic API to generate AI plans locally.");
  console.log("You need an Anthropic API key for the `create_plan` feature.");
  console.log("Get one at: https://console.anthropic.com/settings/keys\n");

  const setupAnthropic = await prompt("Set up Anthropic key now? (y/n): ");

  if (setupAnthropic.toLowerCase() === "y" || setupAnthropic.toLowerCase() === "yes") {
    const anthropicKey = await prompt("Paste your Anthropic API key: ", true);

    if (!anthropicKey || !anthropicKey.startsWith("sk-ant-")) {
      console.error("\nInvalid key format. Anthropic keys start with 'sk-ant-'.");
      console.log("You can set it later: devto config set anthropic-key sk-ant-xxxx\n");
    } else {
      setAnthropicKey(anthropicKey);
      console.log("Anthropic key saved!\n");
    }
  } else {
    console.log("\nSkipped. You can set it later: devto config set anthropic-key sk-ant-xxxx\n");
  }

  console.log("Next step: run `devto init` to configure Claude Code MCP.");
  console.log("Run `devto status` to verify your connection.\n");
}

async function status() {
  const config = readConfig();

  if (!config) {
    console.log("\nNot logged in. Run `devto login` to authenticate.\n");
    process.exit(1);
  }

  console.log("\nDevTo Status");
  console.log("────────────");
  console.log(`API URL: ${config.api_url}`);
  console.log(`API Key: ${config.api_key.slice(0, 12)}...`);

  // Anthropic key status
  let anthropicPresent = false;
  try {
    getAnthropicKey();
    anthropicPresent = true;
    console.log("Anthropic Key: configured");
  } catch {
    console.log("Anthropic Key: missing (run `devto config set anthropic-key sk-ant-xxxx`)");
  }

  process.stdout.write("Connection: ");
  try {
    const res = await fetch(`${config.api_url}/api/v1/status`, {
      headers: {
        Authorization: `Bearer ${config.api_key}`,
        "X-DevTo-Version": "0.1.5",
      },
    });

    if (res.ok) {
      const data = (await res.json()) as {
        project: string;
        workspace_url: string;
        total_tasks: number;
        open_tasks: number;
        in_progress_tasks: number;
        completed_tasks: number;
        current_sprint: string | null;
      };
      console.log("Connected");
      console.log(`Project: ${data.project}`);
      console.log(`Workspace: ${data.workspace_url}`);
      console.log(`Tasks: ${data.total_tasks} total, ${data.in_progress_tasks} in progress, ${data.completed_tasks} done`);
      if (data.current_sprint) {
        console.log(`Sprint: ${data.current_sprint}`);
      }
    } else if (res.status === 401) {
      console.log("Invalid API key");
      console.log("\nRun `devto login` to re-authenticate.");
    } else {
      console.log(`Error (${res.status})`);
    }
  } catch {
    console.log("Could not connect to DevTo API");
  }

  console.log();
}

async function init() {
  console.log("\nDevTo Init — Configure Claude Code MCP\n");

  const config = readConfig();
  const apiKey = config?.api_key ?? "their-key-here";

  // Claude Code uses .mcp.json in the project root
  const configPath = path.join(process.cwd(), ".mcp.json");
  console.log(`Config file: ${configPath}`);

  // Read existing config or start fresh
  let mcpConfig: Record<string, unknown> = {};
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf-8");
      mcpConfig = JSON.parse(raw);
    }
  } catch {
    // Start fresh if corrupt
  }

  // Ensure mcpServers object exists
  if (!mcpConfig.mcpServers || typeof mcpConfig.mcpServers !== "object") {
    mcpConfig.mcpServers = {};
  }

  // Inject/update devto block
  (mcpConfig.mcpServers as Record<string, unknown>)["devto"] = {
    command: "devto-mcp",
    env: {
      DEVTO_API_KEY: apiKey,
    },
  };

  // Write config
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2));

  console.log("DevTo MCP server block injected successfully.");
  if (apiKey === "their-key-here") {
    console.log(
      "\nNote: No API key found in local config. Run `devto login` first, then re-run `devto init`."
    );
  } else {
    console.log(`\nAPI key (${apiKey.slice(0, 12)}...) written to MCP config.`);
  }

  // Warn if Anthropic key is missing
  try {
    getAnthropicKey();
  } catch {
    console.log("\n⚠ Anthropic API key not configured.");
    console.log("  AI plan generation (create_plan) requires an Anthropic key.");
    console.log("  Run: devto config set anthropic-key sk-ant-xxxx");
    console.log("  Get one at: https://console.anthropic.com/settings/keys");
  }

  console.log("\nRestart Claude Code to pick up the changes.\n");
}

async function doctor() {
  console.log("\nDevTo Doctor — Connection Diagnostics\n");

  const config = readConfig();

  // 1. Check DevTo API reachable
  process.stdout.write("DevTo API reachable ... ");
  const apiUrl = config?.api_url ?? getApiUrl();
  try {
    const res = await fetch(`${apiUrl}/api/v1/status`, {
      headers: {
        ...(config?.api_key ? { Authorization: `Bearer ${config.api_key}` } : {}),
        "X-DevTo-Version": "0.1.5",
      },
    });

    if (res.ok) {
      console.log("OK");
    } else {
      console.log(`FAIL (HTTP ${res.status})`);
      console.log(`  Fix: Check your internet connection or try again later.`);
    }
  } catch {
    console.log("FAIL (network error)");
    console.log(`  Fix: Check your internet connection. API URL: ${apiUrl}`);
  }

  // 2. Check API key valid
  process.stdout.write("API key valid ... ");
  if (!config?.api_key) {
    console.log("FAIL (no key configured)");
    console.log("  Fix: Run `devto login` to authenticate.");
  } else {
    try {
      const res = await fetch(`${apiUrl}/api/v1/status`, {
        headers: {
          Authorization: `Bearer ${config.api_key}`,
          "X-DevTo-Version": "0.1.5",
        },
      });
      if (res.status === 401) {
        console.log("FAIL (invalid key)");
        console.log("  Fix: Run `devto login` to re-authenticate.");
      } else if (res.ok) {
        console.log("OK");
      } else {
        console.log(`WARN (HTTP ${res.status})`);
      }
    } catch {
      console.log("SKIP (cannot reach API)");
    }
  }

  // 3. Check workspace connection
  process.stdout.write("Workspace connection ... ");
  if (!config?.api_key) {
    console.log("SKIP (no API key)");
  } else {
    try {
      const res = await fetch(`${apiUrl}/api/v1/status`, {
        headers: {
          Authorization: `Bearer ${config.api_key}`,
          "X-DevTo-Version": "0.1.5",
        },
      });
      if (res.ok) {
        const data = (await res.json()) as { workspace_url?: string };
        if (data.workspace_url) {
          console.log(`OK (${data.workspace_url})`);
        } else {
          console.log("FAIL (no workspace connected)");
          console.log("  Fix: Connect your workspace at https://devto.ai/dashboard/settings");
        }
      } else {
        console.log("FAIL");
      }
    } catch {
      console.log("SKIP (cannot reach API)");
    }
  }

  // 4. Check Anthropic key
  process.stdout.write("Anthropic API key ... ");
  try {
    getAnthropicKey();
    console.log("OK");
  } catch {
    console.log("MISSING");
    console.log("  Fix: Run `devto config set anthropic-key sk-ant-xxxx`");
  }

  console.log();
}

async function sync() {
  console.log("\nDevTo Sync — Workspace Configuration Discovery\n");

  const config = readConfig();
  if (!config?.api_key) {
    console.log("Not logged in. Run `devto login` first.\n");
    process.exit(1);
  }

  const apiUrl = config.api_url;

  process.stdout.write("Discovering workspace configuration... ");
  try {
    const res = await fetch(`${apiUrl}/api/v1/jira/discover`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.api_key}`,
        "X-DevTo-Version": "0.1.5",
      },
    });

    if (!res.ok) {
      console.log(`FAIL (HTTP ${res.status})`);
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (data.message) console.log(`  ${data.message}`);
      process.exit(1);
    }

    const data = (await res.json()) as {
      project?: string;
      issue_types?: string[];
      statuses?: string[];
      boards?: string[];
    };

    console.log("OK\n");

    if (data.project) console.log(`Project: ${data.project}`);
    if (data.issue_types) console.log(`Issue types: ${data.issue_types.join(", ")}`);
    if (data.statuses) console.log(`Statuses: ${data.statuses.join(", ")}`);
    if (data.boards) console.log(`Boards: ${data.boards.join(", ")}`);
  } catch {
    console.log("FAIL (network error)");
  }

  console.log();
}

async function verbose() {
  const current = isVerbose();
  const newState = !current;
  setVerbose(newState);
  console.log(`\nVerbose mode: ${newState ? "ON" : "OFF"}\n`);
}

async function configSet() {
  const subcommand = process.argv[3]; // "set"
  const key = process.argv[4]; // "anthropic-key"
  const value = process.argv[5]; // the actual key

  if (subcommand !== "set" || key !== "anthropic-key" || !value) {
    console.error("\nUsage: devto config set anthropic-key <key>\n");
    process.exit(1);
  }

  if (!value.startsWith("sk-ant-")) {
    console.error(
      "\nInvalid Anthropic key format. Keys should start with 'sk-ant-'.\n"
    );
    process.exit(1);
  }

  setAnthropicKey(value);
  console.log("\nAnthropic API key saved to ~/.devto/config.json");
  console.log(`Key: ${value.slice(0, 12)}...`);
  console.log("You can now use `devto create_plan` with local AI generation.\n");
}

async function uninstall() {
  console.log("\nDevTo Uninstall\n");

  const confirm = await prompt("This will remove all DevTo config and MCP settings. Continue? (y/n): ");
  if (confirm.toLowerCase() !== "y" && confirm.toLowerCase() !== "yes") {
    console.log("Cancelled.\n");
    return;
  }

  // 1. Remove devto from .mcp.json in current directory
  const mcpJsonPath = path.join(process.cwd(), ".mcp.json");
  if (fs.existsSync(mcpJsonPath)) {
    try {
      const raw = fs.readFileSync(mcpJsonPath, "utf-8");
      const mcpConfig = JSON.parse(raw);
      if (mcpConfig.mcpServers?.devto) {
        delete mcpConfig.mcpServers.devto;
        fs.writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2));
        console.log(`Removed devto from: ${mcpJsonPath}`);
      }
    } catch {
      // Skip corrupt config
    }
  }

  // 2. Remove ~/.devto config directory
  const configDir = path.join(os.homedir(), ".devto");
  if (fs.existsSync(configDir)) {
    fs.rmSync(configDir, { recursive: true, force: true });
    console.log("Removed ~/.devto config directory.");
  }

  console.log("\nDevTo config removed.");
  console.log("To complete uninstall, run: npm uninstall -g devto-mcp\n");
}

function printHelp() {
  console.log(`
DevTo CLI — AI-powered work management

Usage:
  devto login                          Authenticate with your DevTo API key
  devto status                         Show connection status
  devto init                           Auto-configure Claude Code MCP config
  devto doctor                         Test full connection chain
  devto sync                           Re-sync workspace configuration
  devto verbose                        Toggle verbose mode
  devto config set anthropic-key <key> Store Anthropic API key
  devto uninstall                      Remove all DevTo config and MCP settings
  devto help                           Show this help message
  devto --version                      Show installed version

After logging in, run \`devto init\` in your project to add DevTo to .mcp.json,
or manually add this to your project's .mcp.json:

  {
    "mcpServers": {
      "devto": {
        "command": "devto-mcp",
        "env": {
          "DEVTO_API_KEY": "your-api-key"
        }
      }
    }
  }
`);
}

async function main() {
  switch (command) {
    case "login":
    case "--login":
      await login();
      break;
    case "status":
    case "--status":
      await status();
      break;
    case "init":
    case "--init":
      await init();
      break;
    case "doctor":
    case "--doctor":
      await doctor();
      break;
    case "sync":
    case "--sync":
      await sync();
      break;
    case "verbose":
    case "--verbose":
      await verbose();
      break;
    case "config":
    case "--config":
      await configSet();
      break;
    case "uninstall":
    case "--uninstall":
      await uninstall();
      break;
    case "--version":
    case "-v":
      console.log(`devto-mcp v${require("../package.json").version}`);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
