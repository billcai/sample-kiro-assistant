import { mkdir, readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { AssistantSettings } from "./app-settings.js";
import {
  DEFAULT_OP_ORCHESTRATOR_PROMPT,
  DEFAULT_OP_EXPLORE_PROMPT,
  DEFAULT_OP_TASK_WORKER_PROMPT,
  DEFAULT_OP_ORCHESTRATOR_MODEL,
  DEFAULT_OP_EXPLORE_MODEL,
  DEFAULT_OP_TASK_WORKER_MODEL,
} from "../../shared/op-mode-defaults.js";

const AGENTS_DIR = join(homedir(), ".kiro", "agents");
const BASE_CONFIG_PATH = join(AGENTS_DIR, "agent_config.json");

const OP_FILES = ["op-orchestrator.json", "op-explore.json", "op-task-worker.json"] as const;

type BaseConfig = {
  mcpServers?: Record<string, unknown>;
  tools?: string[];
  allowedTools?: string[];
  resources?: unknown[];
};

async function readBaseConfig(): Promise<BaseConfig> {
  try {
    return JSON.parse(await readFile(BASE_CONFIG_PATH, "utf8")) as BaseConfig;
  } catch {
    return {};
  }
}

async function writeAgent(name: string, config: Record<string, unknown>): Promise<void> {
  await mkdir(AGENTS_DIR, { recursive: true });
  await writeFile(join(AGENTS_DIR, name), JSON.stringify(config, null, 2) + "\n", "utf8");
}

async function removeAgent(name: string): Promise<void> {
  try {
    await unlink(join(AGENTS_DIR, name));
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && e.code !== "ENOENT") throw e;
  }
}

export async function syncOpModeAgents(settings: AssistantSettings): Promise<void> {
  if (!settings.opMode) {
    for (const f of OP_FILES) await removeAgent(f);
    return;
  }

  const base = await readBaseConfig();
  const agents = settings.opModeAgents;
  const datePrefix = `Current date: ${new Date().toISOString().slice(0, 10)}\n\n`;

  await writeAgent("op-orchestrator.json", {
    name: "op-orchestrator",
    description: "OP Mode orchestrator: parallel explore, plan, delegate, verify.",
    prompt: datePrefix + (agents?.orchestrator?.prompt || DEFAULT_OP_ORCHESTRATOR_PROMPT),
    model: agents?.orchestrator?.model || DEFAULT_OP_ORCHESTRATOR_MODEL,
    mcpServers: base.mcpServers ?? {},
    tools: [...new Set([...(base.tools ?? []), "use_subagent", "todo"])],
    allowedTools: [...new Set([...(base.allowedTools ?? []), "use_subagent", "todo"])],
    resources: base.resources ?? [],
  });

  await writeAgent("op-explore.json", {
    name: "op-explore",
    description: "Read-only codebase exploration. Cannot modify files.",
    prompt: datePrefix + (agents?.explore?.prompt || DEFAULT_OP_EXPLORE_PROMPT),
    model: agents?.explore?.model || DEFAULT_OP_EXPLORE_MODEL,
    tools: ["read", "glob", "grep", "web_search", "web_fetch", "thinking"],
    allowedTools: ["read", "glob", "grep", "web_search", "web_fetch", "thinking"],
  });

  await writeAgent("op-task-worker.json", {
    name: "op-task-worker",
    description: "Focused implementation agent for well-defined subtasks.",
    prompt: datePrefix + (agents?.taskWorker?.prompt || DEFAULT_OP_TASK_WORKER_PROMPT),
    model: agents?.taskWorker?.model || DEFAULT_OP_TASK_WORKER_MODEL,
    mcpServers: base.mcpServers ?? {},
    tools: ["read", "glob", "grep", "write", "shell", "web_search", "web_fetch", "thinking", "todo"],
    allowedTools: ["read", "glob", "grep", "write", "shell", "web_search", "web_fetch", "thinking", "todo"],
  });
}
