import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { McpServersMap, SkillInfo } from "../types";
import { useAppStore } from "../store/useAppStore";
import { DEFAULT_MODEL_ID, type ModelInfo } from "@/shared/models";

type SettingsModalProps = {
  open: boolean;
  onClose: () => void;
};

type ModelSettings = {
  models: ModelInfo[];
  currentModelId: string;
  configuredModelId?: string | null;
  source: "custom" | "default";
  settingsPath?: string | null;
};

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [servers, setServers] = useState<McpServersMap>({});
  const [settingsPath, setSettingsPath] = useState<string | null>(null);
  const [loadingServers, setLoadingServers] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [updatingServer, setUpdatingServer] = useState<string | null>(null);
  const cliInteractive = useAppStore((state) => state.cliInteractive);
  const setCliInteractive = useAppStore((state) => state.setCliInteractive);
  const [modelSettings, setModelSettings] = useState<ModelSettings | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [updatingModel, setUpdatingModel] = useState(false);

  // OP Mode state
  const [opModeSettings, setOpModeSettings] = useState<OpModeSettingsResponse | null>(null);
  const [opModeLoading, setOpModeLoading] = useState(false);
  const [opModeError, setOpModeError] = useState<string | null>(null);
  const [opModeExpanded, setOpModeExpanded] = useState(false);
  const [opModeDirty, setOpModeDirty] = useState<Partial<SetOpModeSettingsPayload["agents"]>>({});

  const serverEntries = useMemo(
    () => Object.entries(servers).sort(([a], [b]) => a.localeCompare(b)),
    [servers]
  );

  const sortedSkills = useMemo(
    () => [...skills].sort((a, b) => a.name.localeCompare(b.name)),
    [skills]
  );
  const selectedModel = useMemo<ModelInfo | null>(() => {
    if (!modelSettings) return null;
    return modelSettings.models.find((model) => model.id === modelSettings.currentModelId) ?? null;
  }, [modelSettings]);

  const fetchServers = useCallback(async () => {
    setLoadingServers(true);
    setServerError(null);
    try {
      const response = await window.electron.getKiroMcpServers();
      if (!response.success) {
        throw new Error(response.error || "Failed to load MCP servers");
      }
      setServers(response.servers ?? {});
      setSettingsPath(response.settingsPath ?? null);
    } catch (error) {
      setServers({});
      setServerError(error instanceof Error ? error.message : "Unable to load MCP servers");
    } finally {
      setLoadingServers(false);
    }
  }, []);

  const fetchSkills = useCallback(async () => {
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      const response = await window.electron.getSkills();
      if (!response.success) {
        throw new Error(response.error || "Failed to load skills");
      }
      setSkills(response.user ?? []);
    } catch (error) {
      setSkills([]);
      setSkillsError(error instanceof Error ? error.message : "Unable to load skills");
    } finally {
      setSkillsLoading(false);
    }
  }, []);

  const fetchModelSettings = useCallback(async () => {
    setModelLoading(true);
    setModelError(null);
    try {
      const response = await window.electron.getModelSettings();
      setModelSettings(response);
    } catch (error) {
      setModelSettings(null);
      setModelError(error instanceof Error ? error.message : "Unable to load model settings");
    } finally {
      setModelLoading(false);
    }
  }, []);

  const handleModelChange = useCallback(
    async (event: ChangeEvent<HTMLSelectElement>) => {
      const modelId = event.target.value;
      if (!modelId) return;
      setUpdatingModel(true);
      setModelError(null);
      try {
        const result = await window.electron.setDefaultModel({ modelId });
        if (!result.success || !result.currentModelId) {
          throw new Error(result.error || "Failed to update model");
        }
        const nextModelId = result.currentModelId as string;
        setModelSettings((prev: ModelSettings | null): ModelSettings | null =>
          prev
            ? {
                ...prev,
                currentModelId: nextModelId,
                configuredModelId: nextModelId,
                source: "custom"
              }
            : prev
        );
      } catch (error) {
        setModelError(error instanceof Error ? error.message : "Unable to update model");
      } finally {
        setUpdatingModel(false);
      }
    },
    []
  );

  const fetchOpModeSettings = useCallback(async () => {
    setOpModeLoading(true);
    setOpModeError(null);
    try {
      const response = await window.electron.getOpModeSettings();
      setOpModeSettings(response);
      setOpModeDirty({});
    } catch (error) {
      setOpModeError(error instanceof Error ? error.message : "Unable to load OP Mode settings");
    } finally {
      setOpModeLoading(false);
    }
  }, []);

  const handleOpModeToggle = useCallback(async () => {
    if (!opModeSettings) return;
    setOpModeError(null);
    try {
      const result = await window.electron.setOpModeSettings({ enabled: !opModeSettings.enabled });
      if (result.success && result.settings) setOpModeSettings(result.settings);
      else throw new Error(result.error || "Failed to toggle OP Mode");
    } catch (error) {
      setOpModeError(error instanceof Error ? error.message : "Unable to toggle OP Mode");
    }
  }, [opModeSettings]);

  const handleOpModeSave = useCallback(async () => {
    if (!opModeDirty || !Object.keys(opModeDirty).length) return;
    setOpModeError(null);
    try {
      const result = await window.electron.setOpModeSettings({ agents: opModeDirty as SetOpModeSettingsPayload["agents"] });
      if (result.success && result.settings) {
        setOpModeSettings(result.settings);
        setOpModeDirty({});
      } else throw new Error(result.error || "Failed to save OP Mode settings");
    } catch (error) {
      setOpModeError(error instanceof Error ? error.message : "Unable to save OP Mode settings");
    }
  }, [opModeDirty]);

  useEffect(() => {
    if (!open) {
      setServerError(null);
      setSkillsError(null);
      setModelError(null);
      setOpModeError(null);
      return;
    }
    fetchServers();
    fetchSkills();
    fetchModelSettings();
    fetchOpModeSettings();
  }, [open, fetchServers, fetchSkills, fetchModelSettings, fetchOpModeSettings]);

  const handleToggleServer = useCallback(
    async (name: string, disabled: boolean) => {
      if (!servers[name]) return;
      setUpdatingServer(name);
      setServerError(null);
      try {
        const result = await window.electron.setKiroMcpDisabled({ name, disabled });
        if (!result.success || !result.servers) {
          throw new Error(result.error || "Failed to update MCP server");
        }
        setServers(result.servers);
      } catch (error) {
        setServerError(error instanceof Error ? error.message : "Unable to update MCP server");
      } finally {
        setUpdatingServer(null);
      }
    },
    [servers]
  );

  const handleOpenSkill = useCallback((path: string) => {
    if (!path) return;
    window.electron.openFileExternal(path);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 flex max-h-[90vh] w-[min(1050px,90vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-3xl bg-surface shadow-2xl">
          <div className="flex items-start justify-between gap-4 shrink-0 px-6 pt-6 pb-2">
            <div>
              <Dialog.Title className="text-lg font-semibold text-ink-900">Settings</Dialog.Title>
              <Dialog.Description className="text-sm text-muted">
                Review Kiro MCP servers and installed skills.
              </Dialog.Description>
              {settingsPath && (
                <p className="mt-2 text-xs text-muted">
                  MCP settings file: <code className="break-all">{settingsPath}</code>
                </p>
              )}
            </div>
            <button
              className="rounded-full border border-ink-200 px-3 py-1 text-sm text-muted hover:text-ink-900"
              onClick={onClose}
            >
              Close
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-4">
          {serverError && (
            <div className="rounded-xl border border-error/20 bg-error/5 px-3 py-2 text-sm text-error">{serverError}</div>
          )}

          <section className="rounded-2xl border border-ink-900/10 bg-surface-secondary/70 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-ink-900">Model Selection</h3>
                <p className="mt-1 text-[11px] text-muted">
                  Changes only apply to *new* tasks (each task creates a fresh workspace).
                </p>
              </div>
              <button
                className="text-xs font-medium text-ink-500 hover:text-ink-900 disabled:opacity-50"
                onClick={fetchModelSettings}
                disabled={modelLoading}
              >
                Refresh
              </button>
            </div>
            {modelError && (
              <div className="mt-3 rounded-lg border border-error/20 bg-error/5 px-3 py-2 text-xs text-error">{modelError}</div>
            )}
            <div className="mt-3">
              <select
                id="model-select"
                className="mt-1 w-full rounded-xl border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-900 focus:border-accent focus:outline-none"
                value={modelSettings?.currentModelId ?? ""}
                onChange={handleModelChange}
                disabled={modelLoading || updatingModel || !modelSettings}
              >
                {!modelSettings && <option value="">Loading…</option>}
                {modelSettings?.models.map((model: ModelInfo) => (
                  <option key={model.id} value={model.id}>
                    {model.label} ({model.price})
                  </option>
                ))}
              </select>
              {modelSettings?.source === "custom" && modelSettings.settingsPath && (
                <p className="mt-2 text-xs text-muted">
                  Stored in <code>{modelSettings.settingsPath}</code>
                </p>
              )}
              {modelSettings?.source === "default" && (
                <p className="mt-2 text-xs text-muted">Using built-in default ({DEFAULT_MODEL_ID}).</p>
              )}
              {selectedModel && (
                <p className="mt-3 text-sm text-ink-700">{selectedModel.description}</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-ink-900/10 bg-surface-secondary/70 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-ink-900">CLI Mode</h3>
                <p className="text-xs text-muted">
                  {cliInteractive ? "Interactive (Kiro CLI stays open until you stop it)" : "Non-interactive (CLI exits after each response)"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCliInteractive(!cliInteractive)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${cliInteractive ? "bg-accent" : "bg-ink-200"}`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-surface transition-transform ${cliInteractive ? "translate-x-5" : "translate-x-1"}`}
                />
                <span className="sr-only">Toggle interactive CLI mode</span>
              </button>
            </div>
          </section>

          {/* OP Mode */}
          <section className="rounded-2xl border border-ink-900/10 bg-surface-secondary/70 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-ink-900">OP Mode</h3>
                <p className="text-xs text-muted">
                  {opModeSettings?.enabled
                    ? "Orchestrator agent with explore → plan → implement → verify workflow"
                    : "Standard single-agent mode"}
                </p>
              </div>
              <button
                type="button"
                onClick={handleOpModeToggle}
                disabled={opModeLoading || !opModeSettings}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${opModeSettings?.enabled ? "bg-accent" : "bg-ink-200"}`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-surface transition-transform ${opModeSettings?.enabled ? "translate-x-5" : "translate-x-1"}`}
                />
                <span className="sr-only">Toggle OP Mode</span>
              </button>
            </div>
            {opModeError && <p className="mt-2 text-xs text-red-500">{opModeError}</p>}

            {opModeSettings?.enabled && (
              <>
                <button
                  type="button"
                  onClick={() => setOpModeExpanded(!opModeExpanded)}
                  className="mt-3 text-xs font-medium text-ink-500 hover:text-ink-900"
                >
                  {opModeExpanded ? "▾ Hide agent config" : "▸ Customize agent config"}
                </button>

                {opModeExpanded && (
                  <div className="mt-3 space-y-4">
                    {(["orchestrator", "explore", "taskWorker"] as const).map((role) => {
                      const label = role === "taskWorker" ? "Task Worker" : role.charAt(0).toUpperCase() + role.slice(1);
                      const defaultPromptKey = `${role === "taskWorker" ? "taskWorker" : role}Prompt` as keyof OpModeSettingsResponse["defaults"];
                      const defaultModelKey = `${role === "taskWorker" ? "taskWorker" : role}Model` as keyof OpModeSettingsResponse["defaults"];
                      const currentPrompt = (opModeDirty as Record<string, Record<string, string>>)?.[role]?.prompt ?? opModeSettings.agents[role]?.prompt ?? "";
                      const currentModel = (opModeDirty as Record<string, Record<string, string>>)?.[role]?.model ?? opModeSettings.agents[role]?.model ?? opModeSettings.defaults[defaultModelKey];

                      return (
                        <div key={role} className="rounded-xl border border-ink-900/10 p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-ink-900">{label}</span>
                            <button
                              type="button"
                              className="text-[11px] text-ink-500 hover:text-ink-900"
                              onClick={() => setOpModeDirty((prev) => ({
                                ...prev,
                                [role]: { prompt: undefined, model: undefined },
                              }))}
                            >
                              Reset to default
                            </button>
                          </div>
                          <label className="block text-[11px] text-muted">
                            Model
                            <select
                              className="mt-1 block w-full rounded-lg border border-ink-900/10 bg-surface px-2 py-1 text-xs"
                              value={currentModel}
                              onChange={(e) => setOpModeDirty((prev) => ({
                                ...prev,
                                [role]: { ...(prev as Record<string, Record<string, string>>)?.[role], model: e.target.value },
                              }))}
                            >
                              {modelSettings?.models?.map((m: ModelInfo) => (
                                <option key={m.id} value={m.id}>{m.label}</option>
                              ))}
                            </select>
                          </label>
                          <label className="block text-[11px] text-muted">
                            System Prompt
                            <textarea
                              className="mt-1 block w-full rounded-lg border border-ink-900/10 bg-surface px-2 py-1 text-xs font-mono"
                              rows={4}
                              placeholder={opModeSettings.defaults[defaultPromptKey].slice(0, 200) + "…"}
                              value={currentPrompt}
                              onChange={(e) => setOpModeDirty((prev) => ({
                                ...prev,
                                [role]: { ...(prev as Record<string, Record<string, string>>)?.[role], prompt: e.target.value },
                              }))}
                            />
                          </label>
                        </div>
                      );
                    })}
                    {Object.keys(opModeDirty).length > 0 && (
                      <button
                        type="button"
                        onClick={handleOpModeSave}
                        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
                      >
                        Save Agent Config
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-2xl border border-ink-900/10 bg-surface-secondary/70 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-ink-900">Kiro MCP Servers</h3>
                <p className="text-xs text-muted">Read from ~/.kiro/agents/agent_config.json</p>
                <p className="text-[11px] text-muted mt-1">Changes only affect new tasks (fresh workspaces).</p>
              </div>
              <button
                className="text-xs font-medium text-ink-500 hover:text-ink-900 disabled:opacity-50"
                onClick={fetchServers}
                disabled={loadingServers}
              >
                Refresh
              </button>
            </div>

            <div className="mt-4 max-h-[360px] overflow-y-auto space-y-3">
              {loadingServers ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted">Loading…</div>
              ) : serverEntries.length === 0 ? (
                <div className="rounded-xl border border-dashed border-ink-900/20 px-4 py-6 text-center text-sm text-muted">
                  No MCP servers configured yet.
                </div>
              ) : (
                serverEntries.map(([name, config]) => (
                  <ServerCard
                    key={name}
                    name={name}
                    config={config}
                    onToggle={handleToggleServer}
                    updating={updatingServer === name}
                  />
                ))
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-ink-900/10 bg-surface-secondary/70 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-ink-900">Kiro Skills</h3>
                <p className="text-xs text-muted">Directories under ~/.kiro/skills</p>
              </div>
              <button
                className="text-xs font-medium text-ink-500 hover:text-ink-900 disabled:opacity-50"
                onClick={fetchSkills}
                disabled={skillsLoading}
              >
                Refresh
              </button>
            </div>
            {skillsError && (
              <div className="mt-3 rounded-lg border border-error/20 bg-error/5 px-3 py-2 text-xs text-error">{skillsError}</div>
            )}
            <div className="mt-4 max-h-[360px] overflow-y-auto space-y-3">
              {skillsLoading ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted">Loading…</div>
              ) : sortedSkills.length === 0 ? (
                <div className="rounded-xl border border-dashed border-ink-900/20 px-4 py-6 text-center text-sm text-muted">
                  No skills detected.
                </div>
              ) : (
                sortedSkills.map((skill) => (
                  <SkillCard key={skill.path} skill={skill} onOpen={handleOpenSkill} />
                ))
              )}
            </div>
          </section>
        </div>
        </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ServerCard({
  name,
  config,
  onToggle,
  updating
}: {
  name: string;
  config: McpServersMap[string];
  onToggle: (name: string, disabled: boolean) => void;
  updating: boolean;
}) {
  const isEnabled = config?.disabled !== true;
  const isHttp = (config?.type ?? "stdio") === "http";
  const summary = isHttp ? config?.url ?? "HTTP server" : config?.command ?? "Command not specified";
  const args = Array.isArray(config?.args) ? config?.args : undefined;
  const env = config?.env && typeof config.env === "object" ? config.env : undefined;

  return (
    <div className="rounded-2xl border border-ink-900/15 bg-surface p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink-900">{name}</span>
            <span className={`text-[11px] font-semibold ${isEnabled ? "text-success" : "text-error"}`}>
              {isEnabled ? "Enabled" : "Disabled"}
            </span>
            <span className="rounded-full bg-surface-tertiary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              {isHttp ? "HTTP" : "STDIO"}
            </span>
          </div>
          <p className="text-xs text-muted break-all">{summary}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!isEnabled || updating}
            onClick={() => onToggle(name, true)}
            className={`rounded-full px-3 py-1 text-xs font-semibold border transition-colors ${
              isEnabled ? "border-error/40 text-error hover:bg-error/10" : "border-ink-900/20 text-muted"
            } ${!isEnabled || updating ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            Disable
          </button>
          <button
            type="button"
            disabled={isEnabled || updating}
            onClick={() => onToggle(name, false)}
            className={`rounded-full px-3 py-1 text-xs font-semibold border transition-colors ${
              !isEnabled ? "border-success/40 text-success hover:bg-success/10" : "border-ink-900/20 text-muted"
            } ${isEnabled || updating ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            Enable
          </button>
        </div>
      </div>
      {args && args.length > 0 && (
        <div className="mt-2 text-[12px] text-muted">
          Args: <span className="font-mono text-ink-900">{args.join(" ")}</span>
        </div>
      )}
      {env && Object.keys(env).length > 0 && (
        <div className="mt-2 text-[12px] text-muted">
          Env:
          <div className="mt-1 flex flex-wrap gap-1">
            {Object.entries(env).map(([key, value]) => (
              <span key={key} className="rounded-full bg-surface-tertiary px-2 py-0.5 font-mono text-[11px] text-ink-800">
                {key}={<span className="text-ink-900">{value}</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SkillCard({ skill, onOpen }: { skill: SkillInfo; onOpen: (path: string) => void }) {
  return (
    <div className="rounded-2xl border border-ink-900/15 bg-surface p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-ink-900">{skill.name}</div>
          <p className="text-xs text-muted break-all">{skill.path}</p>
        </div>
        <button
          className="rounded-full border border-ink-200 px-3 py-1 text-xs text-ink-700 hover:border-accent hover:text-accent"
          onClick={() => onOpen(skill.path)}
        >
          Open
        </button>
      </div>
    </div>
  );
}
