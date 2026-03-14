import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export type DevToConfig = {
  api_key: string;
  api_url: string;
  anthropic_key?: string;
  verbose?: boolean;
};

const CONFIG_DIR = path.join(os.homedir(), ".devto");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const DEFAULT_API_URL = "https://api.devto.ai";

export function readConfig(): DevToConfig | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.api_key) return null;
    return {
      api_key: parsed.api_key,
      api_url: parsed.api_url ?? DEFAULT_API_URL,
      anthropic_key: parsed.anthropic_key,
      verbose: parsed.verbose,
    };
  } catch {
    return null;
  }
}

export function writeConfig(config: DevToConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function getApiKey(): string {
  // Prefer environment variable (for MCP server launched by Claude Code)
  const envKey = process.env.DEVTO_API_KEY;
  if (envKey) return envKey;

  const config = readConfig();
  if (!config) {
    throw new Error(
      "No DevTo API key found. Run `devto login` to authenticate, or set the DEVTO_API_KEY environment variable."
    );
  }
  return config.api_key;
}

export function getApiUrl(): string {
  return process.env.DEVTO_API_URL ?? readConfig()?.api_url ?? DEFAULT_API_URL;
}

export function getAnthropicKey(): string {
  // Prefer environment variable (set in .mcp.json by devto init)
  const envKey = process.env.DEVTO_ANTHROPIC_KEY;
  if (envKey) return envKey;

  const config = readConfig();
  if (config?.anthropic_key) return config.anthropic_key;
  throw new Error(
    "No Anthropic API key configured. Run: devto config set anthropic-key sk-ant-xxxx"
  );
}

export function isVerbose(): boolean {
  const config = readConfig();
  return config?.verbose ?? false;
}

export function setVerbose(enabled: boolean): void {
  const config = readConfig() ?? { api_key: "", api_url: DEFAULT_API_URL };
  config.verbose = enabled;
  writeConfig(config);
}

export function setAnthropicKey(key: string): void {
  const config = readConfig() ?? { api_key: "", api_url: DEFAULT_API_URL };
  config.anthropic_key = key;
  writeConfig(config);
}
