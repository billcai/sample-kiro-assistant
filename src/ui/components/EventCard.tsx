import { useEffect, useState, useSyncExternalStore } from "react";
import type {
  AgentAssistantMessage,
  AgentMessage,
  AgentPermissionResult,
  AgentResultMessage,
  AgentSystemMessage,
  AgentUserMessage
} from "../../shared/agent-schema.js";
import type { StreamMessage } from "../types";
import type { PermissionRequest } from "../store/useAppStore";
import MDContent from "../render/markdown";
import { DecisionPanel } from "./DecisionPanel";

type MessageContent = AgentAssistantMessage["message"]["content"][number];
type ToolResultContent = AgentUserMessage["message"]["content"][number];
type ToolStatus = "pending" | "success" | "error";
type UnknownRecord = Record<string, unknown>;

const toolStatusMap = new Map<string, ToolStatus>();
const toolStatusListeners = new Set<() => void>();

type AskUserQuestionInput = {
  questions?: Array<{
    question: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
};

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const getAskUserQuestionSignature = (input?: AskUserQuestionInput | null) => {
  if (!input?.questions?.length) return "";
  return input.questions
    .map((question) => {
      const options = (question.options ?? [])
        .map((option) => `${option.label}|${option.description ?? ""}`)
        .join(",");
      return `${question.question}|${question.header ?? ""}|${question.multiSelect ? "1" : "0"}|${options}`;
    })
    .join("||");
};

const setToolStatus = (toolUseId: string | undefined, status: ToolStatus) => {
  if (!toolUseId) return;
  toolStatusMap.set(toolUseId, status);
  toolStatusListeners.forEach((listener) => listener());
};

const subscribeToolStatus = (listener: () => void) => {
  toolStatusListeners.add(listener);
  return () => {
    toolStatusListeners.delete(listener);
  };
};

const useToolStatus = (toolUseId: string | undefined) =>
  useSyncExternalStore(
    subscribeToolStatus,
    () => (toolUseId ? toolStatusMap.get(toolUseId) : undefined),
    () => undefined
  );

const StatusDot = ({
  variant = "accent",
  isActive = false,
  isVisible = true
}: {
  variant?: "accent" | "success" | "error";
  isActive?: boolean;
  isVisible?: boolean;
}) => {
  if (!isVisible) return null;
  const colorClass =
    variant === "success" ? "bg-success" : variant === "error" ? "bg-error" : "bg-accent";
  return (
    <span className="relative flex h-2 w-2">
      {isActive && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full ${colorClass} opacity-75`}
        />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${colorClass}`} />
    </span>
  );
};

const SessionResult = ({ message }: { message: AgentResultMessage }) => {
  const formatMinutes = (ms: number | undefined) =>
    typeof ms !== "number" ? "-" : `${(ms / 60000).toFixed(2)} min`;
  const formatUsd = (usd: number | undefined) => (typeof usd !== "number" ? "-" : usd.toFixed(2));
  const formatMillions = (tokens: number | undefined) =>
    typeof tokens !== "number" ? "-" : `${(tokens / 1_000_000).toFixed(4)} M`;

  return (
    <div className="flex flex-col gap-2 mt-4">
      <div className="header text-accent">Session Result</div>
      <div className="flex flex-col rounded-xl px-4 py-3 border border-ink-900/10 bg-surface-secondary space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-[14px]">
          <span className="font-normal">Duration</span>
          <span className="inline-flex items-center rounded-full bg-surface-tertiary px-2.5 py-0.5 text-ink-700 text-[13px]">
            {formatMinutes(message.duration_ms)}
          </span>
          <span className="font-normal">API</span>
          <span className="inline-flex items-center rounded-full bg-surface-tertiary px-2.5 py-0.5 text-ink-700 text-[13px]">
            {formatMinutes(message.duration_api_ms)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[14px]">
          <span className="font-normal">Usage</span>
          <span className="inline-flex items-center rounded-full bg-accent/10 px-2.5 py-0.5 text-accent text-[13px]">
            Cost ${formatUsd(message.total_cost_usd)}
          </span>
          <span className="inline-flex items-center rounded-full bg-surface-tertiary px-2.5 py-0.5 text-ink-700 text-[13px]">
            Input {formatMillions(message.usage?.input_tokens)}
          </span>
          <span className="inline-flex items-center rounded-full bg-surface-tertiary px-2.5 py-0.5 text-ink-700 text-[13px]">
            Output {formatMillions(message.usage?.output_tokens)}
          </span>
        </div>
      </div>
    </div>
  );
};

const isMarkdown = (text: string): boolean => {
  if (!text || typeof text !== "string") return false;
  const patterns: RegExp[] = [/^#{1,6}\s+/m, /```[\s\S]*?```/];
  return patterns.some((pattern) => pattern.test(text));
};

const extractTagContent = (input: string, tag: string): string | null => {
  const match = input.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? match[1] : null;
};

const tryFormatJsonContent = (text: string): string | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const isJsonCandidate =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));
  if (!isJsonCandidate) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
};

const formatModelBadge = (model: unknown): string | null => {
  if (typeof model !== "string") return null;
  const trimmed = model.trim();
  return trimmed.length ? `Model: ${trimmed}` : null;
};

const readToolResultArrayOutput = (content: unknown[]): string =>
  content
    .map((item) => {
      if (!isRecord(item)) return "";
      return readString(item.text) ?? "";
    })
    .join("\n");

const readModelInfoText = (message: AgentMessage): string => {
  if (message.type !== "system") return "";
  const messageRecord = message as unknown as UnknownRecord;
  if (messageRecord.subtype !== "model-info") return "";
  const payload = messageRecord.message;
  if (!isRecord(payload) || !Array.isArray(payload.content) || payload.content.length === 0) {
    return "";
  }
  const firstContent = payload.content[0];
  if (!isRecord(firstContent)) return "";
  return readString(firstContent.text) ?? "";
};

const readTranscriptText = (assistantMessage: AgentAssistantMessage): string | null => {
  const messageRecord = assistantMessage.message as unknown as UnknownRecord;
  const transcript = messageRecord.transcript;
  if (!Array.isArray(transcript) || transcript.length === 0) return null;
  const text = transcript
    .map((block) => {
      if (!isRecord(block)) return "";
      return readString(block.text) ?? "";
    })
    .filter((block) => block.length > 0)
    .join("\n\n");
  return text.length > 0 ? text : null;
};

const getToolInfo = (messageContent: Extract<MessageContent, { type: "tool_use" }>): string | null => {
  const input = isRecord(messageContent.input) ? messageContent.input : {};
  switch (messageContent.name) {
    case "Bash":
      return readString(input.command);
    case "Read":
    case "Write":
    case "Edit":
      return readString(input.file_path);
    case "Glob":
    case "Grep":
      return readString(input.pattern);
    case "Task":
      return readString(input.description);
    case "WebFetch":
      return readString(input.url);
    case "web_search":
      return readString(input.query);
    case "use_subagent":
    case "subagent": {
      const cmd = readString(input.command);
      if (cmd === "ListAgents") return "Listing available agents";
      const subs = input.content as Record<string, unknown> | undefined;
      const arr = Array.isArray(subs?.subagents) ? subs.subagents : [];
      if (arr.length === 0) return cmd;
      const names = arr.map((s: Record<string, unknown>) => readString(s.agent_name) || "agent").join(", ");
      return `${arr.length} subagent${arr.length > 1 ? "s" : ""}: ${names}`;
    }
    default:
      return null;
  }
};

// Build a lookup map from tool_use_id to tool_result content
const buildToolResultMap = (messages: StreamMessage[]): Map<string, ToolResultContent> => {
  const map = new Map<string, ToolResultContent>();
  for (const msg of messages) {
    if (msg.type !== "user") continue;
    const userMsg = msg as AgentUserMessage;
    if (!Array.isArray(userMsg.message?.content)) continue;
    for (const content of userMsg.message.content) {
      if (isRecord(content) && content.type === "tool_result" && typeof content.tool_use_id === "string") {
        map.set(content.tool_use_id, content as ToolResultContent);
      }
    }
  }
  return map;
};

const AssistantBlockCard = ({
  title,
  text,
  showIndicator = false,
  badge
}: {
  title: string;
  text: string;
  showIndicator?: boolean;
  badge?: string;
}) => (
  <div className="flex flex-col mt-4">
    <div className="header text-accent flex items-center gap-2">
      <StatusDot variant="success" isActive={showIndicator} isVisible={showIndicator} />
      {title}
      {badge && (
        <span className="rounded-full bg-surface-secondary px-3 py-0.5 text-xs font-medium text-ink-700">
          {badge}
        </span>
      )}
    </div>
    <MDContent text={text} />
  </div>
);

const SubagentSummary = ({ summary }: { summary: { taskDescription?: string; taskResult?: string; contextSummary?: string } }) => {
  const [expanded, setExpanded] = useState(false);
  const title = summary.taskDescription?.slice(0, 120) || "Subagent task";
  const hasResult = Boolean(summary.taskResult);
  return (
    <div className="rounded-lg border border-ink-900/10 bg-surface-secondary overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-tertiary transition-colors"
      >
        <span className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}>▸</span>
        <span className="text-ink-700 truncate">{title}{title.length >= 120 ? "…" : ""}</span>
        {hasResult && <span className="ml-auto shrink-0 text-[10px] text-muted">{expanded ? "collapse" : "expand"}</span>}
      </button>
      {expanded && summary.taskResult && (
        <div className="border-t border-ink-900/10 px-3 py-2 text-sm">
          <MDContent text={summary.taskResult} />
        </div>
      )}
    </div>
  );
};

const parseSubagentOutput = (outputText: string): Array<{ taskDescription?: string; taskResult?: string; contextSummary?: string }> | null => {
  try {
    const parsed = JSON.parse(outputText);
    const obj = typeof parsed === "object" && parsed !== null ? parsed : null;
    if (!obj) return null;
    // Handle both {Json: {summaries: [...]}} and {summaries: [...]}
    const inner = obj.Json ?? obj;
    if (Array.isArray(inner.summaries) && inner.summaries.length > 0) return inner.summaries;
    return null;
  } catch {
    return null;
  }
};

const ToolUseCard = ({
  messageContent,
  showIndicator = false,
  toolResult
}: {
  messageContent: MessageContent;
  showIndicator?: boolean;
  toolResult?: ToolResultContent;
}) => {
  const [inputsExpanded, setInputsExpanded] = useState(false);
  const [outputExpanded, setOutputExpanded] = useState(false);
  
  const isToolUse = messageContent.type === "tool_use";
  const toolUseId = isToolUse ? messageContent.id : undefined;
  const toolStatus = useToolStatus(toolUseId);
  const isPending = !toolStatus || toolStatus === "pending";
  
  const hasResult = toolResult && toolResult.type === "tool_result";
  const isError = hasResult && toolResult.is_error;
  const statusVariant = isError ? "error" : "success";
  const shouldShowDot = hasResult || toolStatus === "success" || toolStatus === "error" || showIndicator;

  useEffect(() => {
    if (!toolUseId || toolStatusMap.has(toolUseId)) return;
    setToolStatus(toolUseId, "pending");
  }, [toolUseId]);

  useEffect(() => {
    if (!hasResult || !toolUseId) return;
    setToolStatus(toolUseId, isError ? "error" : "success");
  }, [hasResult, toolUseId, isError]);

  if (!isToolUse) return null;

  const inputJson = isRecord(messageContent.input) 
    ? JSON.stringify(messageContent.input, null, 2) 
    : "{}";

  let outputText = "";
  let outputLines: string[] = [];
  let isMarkdownOutput = false;
  if (hasResult) {
    if (toolResult.is_error) {
      outputText = extractTagContent(String(toolResult.content), "tool_use_error") ?? String(toolResult.content);
    } else {
      try {
        outputText = Array.isArray(toolResult.content)
          ? readToolResultArrayOutput(toolResult.content)
          : String(toolResult.content);
      } catch {
        outputText = JSON.stringify(toolResult, null, 2);
      }
    }
    const formattedJson = tryFormatJsonContent(outputText);
    outputText = formattedJson ?? outputText;
    outputLines = outputText ? outputText.split("\n") : [];
    isMarkdownOutput = !formattedJson && isMarkdown(outputText);
  }

  return (
    <div className="flex flex-col gap-2 rounded-[1rem] bg-surface-tertiary px-3 py-2 mt-4 overflow-hidden">
      <div className="flex flex-row items-center gap-2 min-w-0">
        <StatusDot variant={statusVariant} isActive={isPending && showIndicator} isVisible={shouldShowDot} />
        <div className="flex flex-row items-center gap-2 tool-use-item min-w-0 flex-1">
          <span className="inline-flex items-center rounded-md text-accent py-0.5 text-sm font-medium shrink-0">
            {messageContent.name}
          </span>
          <span className="text-sm text-muted truncate">{getToolInfo(messageContent)}</span>
        </div>
      </div>

      <div className="border-t border-ink-900/10 pt-2">
        <button
          onClick={() => setInputsExpanded((prev) => !prev)}
          className="text-xs font-medium text-accent hover:text-accent-hover transition-colors"
        >
          {inputsExpanded ? "Hide inputs" : "Show inputs"}
        </button>
        {inputsExpanded && (
          <pre className="mt-2 text-xs text-ink-700 whitespace-pre-wrap break-words bg-surface-secondary rounded-lg p-2">
            {inputJson}
          </pre>
        )}
      </div>

      {hasResult && (() => {
        const isSubagent = isToolUse && (messageContent.name === "use_subagent" || messageContent.name === "subagent");
        const summaries = isSubagent && !isError ? parseSubagentOutput(outputText) : null;

        if (summaries) {
          return (
            <div className="border-t border-ink-900/10 pt-2">
              <span className="text-xs font-medium text-ink-900">Subagent Results ({summaries.length})</span>
              <div className="mt-2 space-y-2">
                {summaries.map((s, i) => <SubagentSummary key={i} summary={s} />)}
              </div>
            </div>
          );
        }

        return (
          <div className="border-t border-ink-900/10 pt-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-ink-900">Output</span>
              <button
                onClick={() => setOutputExpanded((prev) => !prev)}
                className="text-xs font-medium text-accent hover:text-accent-hover transition-colors"
              >
                {outputExpanded ? "Hide output" : "Show output"}
              </button>
            </div>
            {!outputExpanded && (
              <p className="mt-1 text-xs text-muted">
                Output hidden{outputLines.length ? ` (${outputLines.length} lines)` : ""}.
              </p>
            )}
            {outputExpanded && (
              <div className={`mt-2 text-sm whitespace-pre-wrap break-words ${isError ? "text-red-500" : "text-ink-700"}`}>
                {isMarkdownOutput ? (
                  <MDContent text={outputText} />
                ) : (
                  <pre className="whitespace-pre-wrap break-words text-xs">{outputText}</pre>
                )}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
};

const AskUserQuestionCard = ({
  messageContent,
  permissionRequest,
  onPermissionResult
}: {
  messageContent: MessageContent;
  permissionRequest?: PermissionRequest;
  onPermissionResult?: (toolUseId: string, result: AgentPermissionResult) => void;
}) => {
  if (messageContent.type !== "tool_use") return null;

  const input = messageContent.input as AskUserQuestionInput | null;
  const questions = input?.questions ?? [];
  const currentSignature = getAskUserQuestionSignature(input);
  const requestSignature = getAskUserQuestionSignature(
    permissionRequest?.input as AskUserQuestionInput | undefined
  );
  const isActiveRequest = permissionRequest && currentSignature === requestSignature;

  if (isActiveRequest && onPermissionResult) {
    return (
      <div className="mt-4">
        <DecisionPanel
          key={permissionRequest.toolUseId}
          request={permissionRequest}
          onSubmit={(result) => onPermissionResult(permissionRequest.toolUseId, result)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-[1rem] bg-surface-tertiary px-3 py-2 mt-4">
      <div className="flex flex-row items-center gap-2">
        <StatusDot variant="success" isActive={false} isVisible />
        <span className="inline-flex items-center rounded-md text-accent py-0.5 text-sm font-medium">
          AskUserQuestion
        </span>
      </div>
      {questions.map((question, idx) => (
        <div key={idx} className="text-sm text-ink-700 ml-4">
          {question.question}
        </div>
      ))}
    </div>
  );
};

const SystemInfoItem = ({ name, value }: { name: string; value: string }) => (
  <div className="text-[14px]">
    <span className="mr-4 font-normal">{name}</span>
    <span className="font-light">{value}</span>
  </div>
);

const SystemInfoCard = ({
  message,
  showIndicator = false
}: {
  message: AgentSystemMessage;
  showIndicator?: boolean;
}) => (
  <div className="flex flex-col gap-2">
    <div className="header text-accent flex items-center gap-2">
      <StatusDot variant="success" isActive={showIndicator} isVisible={showIndicator} />
      System Init
    </div>
    <div className="flex flex-col rounded-xl px-4 py-2 border border-ink-900/10 bg-surface-secondary space-y-1">
      <SystemInfoItem name="Session ID" value={message.session_id || "-"} />
      <SystemInfoItem name="Model Name" value={message.model || "-"} />
      <SystemInfoItem name="Permission Mode" value={message.permissionMode || "-"} />
      <SystemInfoItem name="Working Directory" value={message.cwd || "-"} />
    </div>
  </div>
);

const ModelInfoCard = ({ message }: { message: AgentMessage }) => {
  const text = readModelInfoText(message);
  if (!text) return null;
  return (
    <div className="flex items-center gap-2 mt-2 text-sm text-ink-700">
      <span className="rounded-full bg-surface-secondary px-3 py-1 text-xs font-medium text-ink-900">
        {text}
      </span>
    </div>
  );
};

const UserMessageCard = ({
  message,
  showIndicator = false
}: {
  message: { type: "user_prompt"; prompt: string };
  showIndicator?: boolean;
}) => (
  <div className="flex flex-col mt-4">
    <div className="header text-accent flex items-center gap-2">
      <StatusDot variant="success" isActive={showIndicator} isVisible={showIndicator} />
      User
    </div>
    <MDContent text={message.prompt} />
  </div>
);

export function MessageCard({
  message,
  isLast = false,
  isRunning = false,
  permissionRequest,
  onPermissionResult,
  allMessages = []
}: {
  message: StreamMessage;
  isLast?: boolean;
  isRunning?: boolean;
  permissionRequest?: PermissionRequest;
  onPermissionResult?: (toolUseId: string, result: AgentPermissionResult) => void;
  allMessages?: StreamMessage[];
}) {
  const showIndicator = isLast && isRunning;
  const toolResultMap = buildToolResultMap(allMessages);

  if (message.type === "user_prompt") {
    return <UserMessageCard message={message} showIndicator={showIndicator} />;
  }

  const sdkMessage = message as AgentMessage;

  if (sdkMessage.type === "system") {
    if (readModelInfoText(sdkMessage)) {
      return <ModelInfoCard message={sdkMessage} />;
    }
    if (sdkMessage.subtype === "init") {
      return <SystemInfoCard message={sdkMessage} showIndicator={showIndicator} />;
    }
    return null;
  }

  if (sdkMessage.type === "result") {
    if (sdkMessage.subtype === "success") {
      return <SessionResult message={sdkMessage} />;
    }
    return (
      <div className="flex flex-col gap-2 mt-4">
        <div className="header text-error">Session Error</div>
        <div className="rounded-xl bg-error-light p-3">
          <pre className="text-sm text-error whitespace-pre-wrap">{JSON.stringify(sdkMessage, null, 2)}</pre>
        </div>
      </div>
    );
  }

  if (sdkMessage.type === "assistant") {
    const contents = sdkMessage.message.content as MessageContent[];
    const assistantRecord = sdkMessage as unknown as UnknownRecord;
    const modelBadge = formatModelBadge(assistantRecord.model);
    const transcriptText = readTranscriptText(sdkMessage);

    if (transcriptText) {
      return (
        <>
          <AssistantBlockCard
            title="Assistant"
            text={transcriptText}
            showIndicator={showIndicator}
            badge={modelBadge ?? undefined}
          />
          {contents
            .filter((content) => content.type === "tool_use")
            .map((content, idx) => {
              const toolUseContent = content as Extract<MessageContent, { type: "tool_use" }>;
              const toolResult = toolResultMap.get(toolUseContent.id);
              return content.name === "AskUserQuestion" ? (
                <AskUserQuestionCard
                  key={`tool-${idx}`}
                  messageContent={content}
                  permissionRequest={permissionRequest}
                  onPermissionResult={onPermissionResult}
                />
              ) : (
                <ToolUseCard key={`tool-${idx}`} messageContent={content} showIndicator={false} toolResult={toolResult} />
              );
            })}
        </>
      );
    }

    const firstTextIndex = contents.findIndex((content) => content.type === "text");
    return (
      <>
        {contents.map((content, idx) => {
          const isLastContent = idx === contents.length - 1;
          const shouldShowBadge = idx === firstTextIndex && content.type === "text" && !!modelBadge;

          if (content.type === "thinking") {
            return (
              <AssistantBlockCard
                key={idx}
                title="Thinking"
                text={content.thinking}
                showIndicator={isLastContent && showIndicator}
              />
            );
          }

          if (content.type === "text") {
            return (
              <AssistantBlockCard
                key={idx}
                title="Assistant"
                text={content.text}
                showIndicator={isLastContent && showIndicator}
                badge={shouldShowBadge ? modelBadge ?? undefined : undefined}
              />
            );
          }

          if (content.type === "tool_use") {
            if (content.name === "AskUserQuestion") {
              return (
                <AskUserQuestionCard
                  key={idx}
                  messageContent={content}
                  permissionRequest={permissionRequest}
                  onPermissionResult={onPermissionResult}
                />
              );
            }
            const toolResult = toolResultMap.get(content.id);
            return (
              <ToolUseCard
                key={idx}
                messageContent={content}
                showIndicator={isLastContent && showIndicator}
                toolResult={toolResult}
              />
            );
          }

          return null;
        })}
      </>
    );
  }

  // Skip rendering standalone tool results - they're now shown inline in ToolUseCard
  if (sdkMessage.type === "user") {
    return null;
  }

  return null;
}

export { MessageCard as EventCard };
