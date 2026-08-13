"use client";
import { registerAbortHandler } from "@/hooks/useKeyboardShortcuts";
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AgentMessage, AssistantContentBlock, AssistantMessage, BashExecutionMessage, CustomMessage, ExtensionUiRequest, SessionInfo, SessionTreeNode, ToolResultMessage } from "@/lib/types";
import { translate, useI18n } from "@/lib/i18n";
import { countToolCallBlocks, getDisplayableAssistantBlocks, splitFinalAssistantBlocks } from "@/lib/message-display";
import { MessageView } from "./MessageView";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ExtensionDialog } from "./ExtensionDialog";
import { SubagentTranscriptDialog } from "./SubagentTranscriptDialog";
import { ChatMinimap, useMessageRefs } from "./ChatMinimap";
import { ComposerPanels } from "./ComposerPanels";
import { useAgentSession, type AgentPhase, type NoticeItem, type SubagentInfo } from "@/hooks/useAgentSession";
import { useAudio } from "@/hooks/useAudio";
import { useDragDrop } from "@/hooks/useDragDrop";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { normalizeCustomPanelLines, parseAnsiLine } from "@/lib/ansi";
import { resolveAvailableThinkingLevels } from "@/lib/thinking-levels";
import { asBracketedPaste, toTerminalKeyData } from "@/lib/terminal-input";
import {
  captureScrollDistance,
  getNextVisibleCount,
  getVisibleRenderWindow,
  restoreScrollTop,
  VISIBLE_PAGE_SIZE,
} from "@/lib/chat-lazy-load";

interface Props {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  advisorEnabled?: boolean;
  toolCallsDefaultCollapsed?: boolean;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSessionStatsChange?: (stats: SessionStatsInfo | null) => void;
  onSessionStatsPanelOpen?: () => void;
  onContextUsageChange?: (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => void;
  onOpenFile?: (filePath: string) => void;
}

function phaseLabel(phase: AgentPhase): string {
  if (phase?.kind === "running_tools") {
    const names = phase.tools.map((tool) => tool.name);
    if (names.length === 0) return translate("chatWindow.runningTool");
    if (names.length <= 3) return translate("chatWindow.runningNamed", { names: names.join(", ") });
    return translate("chatWindow.runningNamedMore", { names: names.slice(0, 2).join(", "), more: names.length - 2 });
  }
  if (phase?.kind === "waiting_model") return translate("chatWindow.waitingModel");
  if (phase?.kind === "running_command") return translate("chatWindow.runningCommand");
  return translate("chatWindow.thinking");
}

const CHAT_MINIMAP_WIDTH = 36;
const CHAT_COLUMN_PADDING = 16;
const CHAT_INPUT_RIGHT_PADDING = CHAT_COLUMN_PADDING + CHAT_MINIMAP_WIDTH;// Trigger the next history page while the sentinel is still this far below
// the top edge, so a normal upward scroll seamlessly continues into the newly
// loaded messages. Triggering only at the very top made the load invisible:
// the restore anchored the viewport to the old content, so the user parked on
// the banner and the load looked like a no-op.
const LOAD_MORE_ROOT_MARGIN = "400px 0px 0px 0px";

function hasFinalAssistantAnswer(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  return splitFinalAssistantBlocks(message as AssistantMessage).answerBlocks.some((block) => (
    block.type === "image" || (block.type === "text" && block.text.trim().length > 0)
  ));
}

function findFinalAssistantIndex(messages: AgentMessage[], userIdx: number, endIdx: number): number {
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (hasFinalAssistantAnswer(messages[candidateIdx])) return candidateIdx;
  }
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (messages[candidateIdx]?.role === "assistant") return candidateIdx;
  }
  return -1;
}

function getUserInputText(message: AgentMessage): string | null {
  if (message.role !== "user") return null;
  if (typeof message.content === "string") {
    const text = message.content.trim();
    return text.length > 0 ? text : null;
  }
  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

function countToolCalls(messages: AgentMessage[], indices: number[]): number {
  let count = 0;
  for (const idx of indices) {
    const msg = messages[idx];
    if (msg?.role !== "assistant") continue;
    count += countToolCallBlocks(getDisplayableAssistantBlocks(msg as AssistantMessage));
  }
  return count;
}

function hasDisplayableProcessMessage(message: AgentMessage): boolean {
  if (message.role === "assistant") {
    return getDisplayableAssistantBlocks(message as AssistantMessage).length > 0;
  }
  return message.role === "custom";
}

// A user message normally anchors a turn (user prompt → process → final
// answer), and the process messages in between get folded into a collapsed
// ProcessDetailsGroup. When compaction fires mid-turn, pi drops the original
// user prompt and inserts a compaction summary (role "custom", customType
// "compaction") in its place; the agent then keeps producing tool calls and a
// final answer with no user message left to anchor them. Treat a compaction
// summary as an anchor too, otherwise every post-compaction message renders
// standalone and never collapses.
function isGroupAnchor(message: AgentMessage): boolean {
  if (message.role === "user") return true;
  return message.role === "custom" && (message as CustomMessage).customType === "compaction";
}

function withAssistantBlocks(
  message: AssistantMessage,
  content: AssistantContentBlock[],
  options: { omitUsage?: boolean } = {},
): AssistantMessage {
  const next = { ...message, content };
  if (options.omitUsage) next.usage = undefined;
  return next;
}

function OmpRuntimeVersion() {
  const { t } = useI18n();
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/omp-version")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { version: string | null } | null) => {
        // omp reports "omp/17.1.3"; show just the number next to the label.
        if (!cancelled && data?.version) setVersion(data.version.replace(/^omp\//, ""));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
      omp <span style={{ color: "var(--text)" }}>{version ? `v${version}` : t("chatWindow.versionNotFound")}</span>
    </span>
  );
}

function ProcessDetailsGroup({ messageCount, toolCallCount, children }: { messageCount: number; toolCallCount: number; children: ReactNode }) {
  const { t, tn } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const parts = [t("chatWindow.processDetails"), tn("chatWindow.messageCount", messageCount)];
  if (toolCallCount > 0) parts.push(tn("chatWindow.toolCallCount", toolCallCount));

  return (
    <div style={{ marginBottom: 14 }}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "auto",
          minHeight: 24,
          padding: "2px 0",
          border: "none",
          background: "transparent",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
        }}
        title={expanded ? t("chatWindow.collapseProcessDetails") : t("chatWindow.expandProcessDetails")}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: expanded ? "rotate(90deg)" : "none", transition: "transform var(--dur-fast) var(--ease-out-warm)" }}>
          <polyline points="4 2.5 7.5 6 4 9.5" />
        </svg>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {parts.join(" · ")}
        </span>
      </button>
      {expanded && (
        <div style={{ marginTop: 8 }}>
          {children}
        </div>
      )}
    </div>
  );
}

interface CommittedTranscriptProps {
  messages: AgentMessage[];
  entryIds: string[];
  conversationMeta: { toolResultsMap: Map<string, ToolResultMessage>; lastAnchorIdx: number; visibleRefIndexByMessage: Map<number, number> };
  messageRefs: React.RefObject<(HTMLDivElement | null)[]>;
  isStreaming: boolean;
  sessionBusy: boolean;
  isNew: boolean;
  forkingEntryId: string | null;
  handleFork: (entryId: string) => void;
  handleNavigate: (entryId: string) => void;
  handleEditContent: (content: string) => void;
  modelNames: Record<string, string>;
  messageCwd: string | undefined;
  onOpenFile?: (filePath: string) => void;
  sessionId: string | undefined;
  toolCallsDefaultCollapsed: boolean;
  visibleCount: number;
  sentinelRef: React.RefObject<HTMLButtonElement | null>;
  handleLoadMoreClick: () => void;
}

/**
 * The committed (non-streaming) transcript. Extracted from ChatWindow and
 * memoized over the committed messages so token-streaming updates (which only
 * change `streamingMessage`, rendered separately) do not re-run the O(history)
 * grouping/splitting work at display-frame cadence.
 */
const CommittedTranscript = memo(function CommittedTranscript({
  messages, entryIds, conversationMeta, messageRefs, isStreaming, sessionBusy, isNew, forkingEntryId,
  handleFork, handleNavigate, handleEditContent, modelNames, messageCwd, onOpenFile, sessionId,
  toolCallsDefaultCollapsed, visibleCount, sentinelRef, handleLoadMoreClick,
}: CommittedTranscriptProps) {
  const { t } = useI18n();
  const { toolResultsMap, lastAnchorIdx, visibleRefIndexByMessage } = conversationMeta;

  const attachVisibleRef = (idx: number, refIndex: number) => (el: HTMLDivElement | null) => {
    messageRefs.current[refIndex] = el;
  };

  const renderMessage = (idx: number, options: { attachRef?: boolean; keyPrefix?: string; messageOverride?: AgentMessage; showTimestamp?: boolean } = {}): ReactNode => {
    const msg = options.messageOverride ?? messages[idx];
    const prevAssistantEntryId =
      msg.role === "user" && idx > 0 && messages[idx - 1].role === "assistant"
        ? entryIds[idx - 1]
        : undefined;
    const isVisible = msg.role === "user" || msg.role === "assistant";
    const currentRefIdx = visibleRefIndexByMessage.get(idx);
    const keyPrefix = options.keyPrefix ?? "message";
    let showTimestamp = false;
    if (msg.role === "assistant") {
      showTimestamp = true;
      for (let j = idx + 1; j < messages.length; j++) {
        const r = messages[j].role;
        if (r === "user") break;
        if (r === "assistant") { showTimestamp = false; break; }
      }
      // Hide on the currently-streaming tail (the streaming bubble owns the live timestamp)
      if (showTimestamp && isStreaming && idx === messages.length - 1) {
        showTimestamp = false;
      }
    }
    if (options.showTimestamp !== undefined) showTimestamp = options.showTimestamp;
    const view = (
      <MessageView
        key={`${keyPrefix}-view-${idx}`}
        message={msg}
        toolResults={toolResultsMap}
        modelNames={modelNames}
        cwd={messageCwd}
        onOpenFile={onOpenFile}
        entryId={entryIds[idx]}
        onFork={sessionBusy || isNew || (idx === 0 && msg.role === "user") ? undefined : handleFork}
        forking={forkingEntryId === entryIds[idx]}
        onNavigate={sessionBusy ? undefined : handleNavigate}
        prevAssistantEntryId={sessionBusy ? undefined : prevAssistantEntryId}
        onEditContent={handleEditContent}
        showTimestamp={showTimestamp}
        prevTimestamp={idx > 0 ? (messages[idx - 1] as AgentMessage & { timestamp?: number }).timestamp : undefined}
        sessionId={sessionId}
        toolCallsDefaultCollapsed={toolCallsDefaultCollapsed}
      />
    );
    if (!isVisible || options.attachRef === false || currentRefIdx === undefined) return view;
    return (
      <div key={`${keyPrefix}-${idx}`} ref={attachVisibleRef(idx, currentRefIdx)}>
        {view}
      </div>
    );
  };

  const rendered: ReactNode[] = [];
  for (let idx = 0; idx < messages.length;) {
    const msg = messages[idx];
    if (!isGroupAnchor(msg)) {
      rendered.push(renderMessage(idx));
      idx += 1;
      continue;
    }

    const userIdx = idx;
    let endIdx = userIdx + 1;
    while (endIdx < messages.length && !isGroupAnchor(messages[endIdx])) endIdx += 1;

    const finalAssistantIdx = findFinalAssistantIndex(messages, userIdx, endIdx);

    if (finalAssistantIdx === -1) {
      for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
        rendered.push(renderMessage(renderIdx));
      }
      idx = endIdx;
      continue;
    }

    const isLiveTail = (sessionBusy || isStreaming) && endIdx === messages.length && userIdx === lastAnchorIdx;
    if (isLiveTail) {
      for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
        rendered.push(renderMessage(renderIdx));
      }
      idx = endIdx;
      continue;
    }

    rendered.push(renderMessage(userIdx));

    const processIndices: number[] = [];
    for (let processIdx = userIdx + 1; processIdx < finalAssistantIdx; processIdx++) {
      processIndices.push(processIdx);
    }
    const visibleProcessIndices = processIndices.filter((processIdx) => hasDisplayableProcessMessage(messages[processIdx]));
    const finalAssistant = messages[finalAssistantIdx] as AssistantMessage;
    const finalSplit = splitFinalAssistantBlocks(finalAssistant);
    const finalProcessMessage = finalSplit.processBlocks.length > 0
      ? withAssistantBlocks(finalAssistant, finalSplit.processBlocks, { omitUsage: true })
      : null;
    const finalAnswerMessage = finalSplit.answerBlocks.length > 0
      ? withAssistantBlocks(finalAssistant, finalSplit.answerBlocks)
      : null;

    const processCount = visibleProcessIndices.length + (finalProcessMessage ? 1 : 0);
    if (processCount > 0) {
      const processRefIdx = visibleProcessIndices
        .map((processIdx) => visibleRefIndexByMessage.get(processIdx))
        .find((value): value is number => typeof value === "number")
        ?? (finalAnswerMessage ? undefined : visibleRefIndexByMessage.get(finalAssistantIdx));
      const processGroup = (
        <ProcessDetailsGroup
          messageCount={processCount}
          toolCallCount={countToolCalls(messages, visibleProcessIndices) + countToolCallBlocks(finalSplit.processBlocks)}
        >
          {visibleProcessIndices.map((processIdx) => renderMessage(processIdx, { attachRef: false, keyPrefix: "process" }))}
          {finalProcessMessage && renderMessage(finalAssistantIdx, { attachRef: false, keyPrefix: "process-final", messageOverride: finalProcessMessage, showTimestamp: false })}
        </ProcessDetailsGroup>
      );
      rendered.push(
        <div
          key={`process-group-${userIdx}-${finalAssistantIdx}`}
          ref={processRefIdx === undefined ? undefined : (el) => { messageRefs.current[processRefIdx] = el; }}
        >
          {processGroup}
        </div>,
      );
    }

    if (finalAnswerMessage) {
      rendered.push(renderMessage(finalAssistantIdx, { messageOverride: finalAnswerMessage }));
    }
    for (let renderIdx = finalAssistantIdx + 1; renderIdx < endIdx; renderIdx++) {
      rendered.push(renderMessage(renderIdx));
    }
    idx = endIdx;
  }
  const { startIndex, hasMore } = getVisibleRenderWindow(rendered.length, visibleCount);
  return (
    <>
      {hasMore && (
        <button
          ref={sentinelRef}
          type="button"
          onClick={handleLoadMoreClick}
          className="py-3 w-full text-center text-xs text-text-muted hover:text-text transition-colors cursor-pointer"
        >
          {t("chatWindow.scrollUpToLoad", { count: startIndex })}
        </button>
      )}
      {rendered.slice(startIndex)}
    </>
  );
});

export function ChatWindow({ session, newSessionCwd, advisorEnabled, toolCallsDefaultCollapsed = true, onAgentEnd, onSessionCreated, onSessionForked, modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSessionStatsChange, onSessionStatsPanelOpen, onContextUsageChange, onOpenFile }: Props) {
  const { t, tn } = useI18n();
  const { soundEnabled, onSoundToggle, playDoneSound, unlockAudio } = useAudio();
  const isMobile = useIsMobile();

  // Wrap onAgentEnd to play the completion sound. This is more reliable than
  // wrapping handleAgentEventRef because useAgentSession overwrites that ref
  // on every render (it syncs the latest callback), which would blow away an
  // externally-installed wrapper after the first re-render.
  const playDoneSoundRef = useRef(playDoneSound);
  playDoneSoundRef.current = playDoneSound;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const wrappedOnAgentEnd = useCallback(() => {
    if (soundEnabledRef.current) {
      playDoneSoundRef.current();
    }
    onAgentEnd?.();
  }, [onAgentEnd]);

  // 稳定化 onEditContent 引用，配合 React.memo 防止历史消息重渲染
  const handleEditContent = useCallback((content: string) => {
    chatInputRef?.current?.insertIfEmpty(content);
  }, [chatInputRef]);

  const {
    loading, error, messages, entryIds, streamState,
    agentRunning, bashRunning, pendingBash, modelNames, modelList, modelsLoading, modelError, modelThinkingLevels, modelThinkingLevelMaps, toolPreset, thinkingLevel, fastModeEnabled, interruptMode, autoCompactionEnabled, steeringMode, followUpMode,
    liveModelMeta,
    retryInfo, contextUsage, forkingEntryId,
    isCompacting, compactError, compactResult, displayModel: displayModelValue, sessionStats,
    slashCommands, slashCommandsLoading, queuedMessages,
    notices, extensionDialog, extensionCustomUi, extensionStatuses, extensionWidgets, respondToExtensionUi, sendExtensionCustomInput,
    isAutoModelSelection,
    agentPhase, activeGoal, activePlan,
    subagents, subagentEvents, subagentTranscriptVersions, activeSubagentCount, currentTodoPhase, todoPhases,
    isNew,
    sessionIdRef, messagesEndRef, scrollContainerRef,
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    handleRecallQueue,
    handleBuiltinSlashCommand,
    handleToolPresetChange, handleThinkingLevelChange, handleFastModeChange, handleInterruptModeChange, handleAutoCompactionChange, handleSteeringModeChange, handleFollowUpModeChange, loadSlashCommands,
  } = useAgentSession({
    session, newSessionCwd, advisorEnabled, onAgentEnd: wrappedOnAgentEnd, onSessionCreated, onSessionForked,
    modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSessionStatsPanelOpen,
    onOpenFile,
  });
  const sessionBusy = agentRunning || bashRunning;

  // Register the abort handler for the global Esc shortcut
  useEffect(() => {
    registerAbortHandler(sessionBusy ? handleAbort : null);
  }, [sessionBusy, handleAbort]);

  // --- Lazy-load historical messages ---
  // Only render the last N messages initially. When the user scrolls to the
  // top, load another page while keeping the scroll position stable.
  const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE);
  const [selectedSubagent, setSelectedSubagent] = useState<SubagentInfo | null>(null);
  const sentinelRef = useRef<HTMLButtonElement>(null);
  const prevScrollDistanceRef = useRef<number | null>(null);
  // "auto" (observer fired while scrolling) anchors the viewport to the old
  // content; "click" (user pressed the banner) reveals the loaded messages at
  // the top of the viewport instead.
  const loadMoreModeRef = useRef<"auto" | "click">("auto");

  // IntersectionObserver on the sentinel banner at the top of the message
  // list. When the user scrolls near the top, load the next page of older
  // messages.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          // Save distance from top before prepending to restore scroll later
          prevScrollDistanceRef.current = captureScrollDistance(container.scrollHeight, container.scrollTop);
          loadMoreModeRef.current = "auto";
          setVisibleCount((prev) => getNextVisibleCount(prev));
        }
      },
      // Expand the root upward so the page loads while the banner is still
      // below the top edge — by the time the user reaches the top, the loaded
      // messages are already there and the scroll continues into them.
      { root: container, rootMargin: LOAD_MORE_ROOT_MARGIN, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, messages.length, scrollContainerRef]);

  // After visibleCount increases (more messages prepended), restore the
  // scroll position so the viewport doesn't jump.
  useEffect(() => {
    if (prevScrollDistanceRef.current == null) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    if (loadMoreModeRef.current === "click") {
      // Explicit request: reveal the loaded page. The browser's scroll
      // anchoring already kept the previous content in view, so move the
      // viewport up to the loaded messages.
      const sentinel = sentinelRef.current;
      if (sentinel) {
        // More pages remain: place the banner's bottom edge just above the
        // viewport so the newest loaded message is at the top.
        const containerRect = container.getBoundingClientRect();
        const sentinelRect = sentinel.getBoundingClientRect();
        container.scrollTop = container.scrollTop + (sentinelRect.bottom - containerRect.top) + 1;
      } else {
        // Everything loaded — the banner unmounted; show the top of the session.
        container.scrollTop = 0;
      }
    } else {
      container.scrollTop = restoreScrollTop(container.scrollHeight, prevScrollDistanceRef.current);
    }
    loadMoreModeRef.current = "auto";
    prevScrollDistanceRef.current = null;
  }, [visibleCount, scrollContainerRef]);

  const handleLoadMoreClick = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      // Sentinel value so the restore effect above runs and reveals the page.
      prevScrollDistanceRef.current = captureScrollDistance(container.scrollHeight, container.scrollTop);
    }
    loadMoreModeRef.current = "click";
    setVisibleCount((prev) => getNextVisibleCount(prev));
  }, [scrollContainerRef]);
  // Push session stats up to AppShell for the top bar.
  // Compare scalar fields to avoid loops from new object identity each render.
  const statsKey = sessionStats
    ? [
      sessionStats.sessionId,
      sessionStats.sessionFile ?? "",
      sessionStats.sessionName ?? "",
      sessionStats.userMessages,
      sessionStats.assistantMessages,
      sessionStats.toolCalls,
      sessionStats.toolResults,
      sessionStats.totalMessages,
      sessionStats.tokens.input,
      sessionStats.tokens.output,
      sessionStats.tokens.cacheRead,
      sessionStats.tokens.cacheWrite,
      sessionStats.tokens.total,
      sessionStats.cost ?? 0,
    ].join("|")
    : null;
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  useEffect(() => {
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [statsKey, onSessionStatsChange]);
  useEffect(() => () => { onSessionStatsChange?.(null); }, [onSessionStatsChange]);

  // Push context usage up to AppShell as well.
  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  useEffect(() => {
    onContextUsageChange?.(contextUsageRef.current);
  }, [ctxKey, onContextUsageChange]);
  useEffect(() => () => { onContextUsageChange?.(null); }, [onContextUsageChange]);

  const onDrop = useCallback((files: File[]) => {
    if (sessionBusy) return;
    chatInputRef?.current?.addFiles(files);
  }, [sessionBusy, chatInputRef]);

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  const visibleMessages = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const inputHistory = useMemo(() => {
    const seen = new Set<string>();
    const history: string[] = [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const text = getUserInputText(messages[i]);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      history.push(text);
      if (history.length >= 50) break;
    }
    return history.reverse();
  }, [messages]);
  const messageRefs = useMessageRefs(visibleMessages.length);
  const conversationMeta = useMemo(() => {
    const toolResultsMap = new Map<string, ToolResultMessage>();
    let lastAnchorIdx = -1;
    const visibleRefIndexByMessage = new Map<number, number>();
    let refIdx = 0;

    messages.forEach((message, index) => {
      if (message.role === "toolResult") toolResultsMap.set((message as ToolResultMessage).toolCallId, message as ToolResultMessage);
      if (isGroupAnchor(message)) lastAnchorIdx = index;
      if (message.role === "user" || message.role === "assistant") visibleRefIndexByMessage.set(index, refIdx++);
    });

    return { toolResultsMap, lastAnchorIdx, visibleRefIndexByMessage };
  }, [messages]);
  // Tool-call ids already rendered by COMMITTED messages — memoized away from
  // the streaming path so a per-token update only re-scans the live bubble.
  const committedToolCallIds = useMemo(() => {
    const renderedIds = new Set<string>();
    for (const message of messages) {
      if (message?.role !== "assistant") continue;
      for (const block of (message as Partial<AssistantMessage>).content ?? []) {
        if (block.type === "toolCall") renderedIds.add(block.toolCallId);
      }
    }
    return renderedIds;
  }, [messages]);
  const pendingToolHeaders = useMemo(() => {
    if (agentPhase?.kind !== "running_tools") return [];
    const renderedIds = new Set(committedToolCallIds);
    const streaming = streamState.streamingMessage;
    if (streaming?.role === "assistant") {
      for (const block of (streaming as Partial<AssistantMessage>).content ?? []) {
        if (block.type === "toolCall") renderedIds.add(block.toolCallId);
      }
    }
    return agentPhase.tools.filter((tool) => !renderedIds.has(tool.id));
  }, [agentPhase, committedToolCallIds, streamState.streamingMessage]);

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !sessionBusy;
  const messageCwd = session?.cwd ?? newSessionCwd ?? undefined;

  const availableThinkingLevels = displayModelValue
    ? resolveAvailableThinkingLevels(
        modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`],
        displayModelValue,
        liveModelMeta,
      )
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const chatInputElement = (
    <ChatInput
      ref={chatInputRef}
      onSend={handleSend}
      onAbort={handleAbort}
      onSteer={agentRunning ? handleSteer : undefined}
      onFollowUp={agentRunning ? handleFollowUp : undefined}
      onPromptWithStreamingBehavior={agentRunning ? handlePromptWithStreamingBehavior : undefined}
      isStreaming={sessionBusy}
      model={displayModelValue}
      isAutoModelSelection={isAutoModelSelection}
      modelNames={modelNames}
      modelList={modelList}
      modelsLoading={modelsLoading}
      modelError={modelError}
      onModelChange={handleModelChange}
      onCompact={session || isNew ? handleCompact : undefined}
      onAbortCompaction={handleAbortCompaction}
      isCompacting={isCompacting}
      compactError={compactError}
      compactResult={compactResult}
      toolPreset={toolPreset}
      onToolPresetChange={session || isNew ? handleToolPresetChange : undefined}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
      fastModeEnabled={fastModeEnabled}
      fastModeSupported={Boolean(displayModelValue && modelList.some((entry) => entry.provider === displayModelValue.provider && entry.id === displayModelValue.modelId && entry.supportsFastMode))}
      onFastModeChange={session || isNew ? handleFastModeChange : undefined}
      interruptMode={interruptMode}
      onInterruptModeChange={session ? handleInterruptModeChange : undefined}
      autoCompactionEnabled={autoCompactionEnabled}
      onAutoCompactionChange={session ? handleAutoCompactionChange : undefined}
      steeringMode={steeringMode}
      onSteeringModeChange={session ? handleSteeringModeChange : undefined}
      followUpMode={followUpMode}
      onFollowUpModeChange={session ? handleFollowUpModeChange : undefined}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      modelNameOverride={liveModelMeta?.name ?? null}
      retryInfo={retryInfo}
      activeGoal={activeGoal}
      activePlan={activePlan}
      advisorEnabled={advisorEnabled}
      queuedMessages={queuedMessages}
      inputHistory={inputHistory}
      onRecallQueue={handleRecallQueue}
      slashCommands={slashCommands}
      slashCommandsLoading={slashCommandsLoading}
      onLoadSlashCommands={loadSlashCommands}
      onBuiltinCommand={handleBuiltinSlashCommand}
      soundEnabled={soundEnabled}
      onSoundToggle={onSoundToggle}
      onAudioUnlock={unlockAudio}
      draftKey={session?.id ?? (newSessionCwd ? `new:${newSessionCwd}` : undefined)}
      cwd={session?.cwd ?? newSessionCwd}
    />
  );

  const aboveEditorWidgets = extensionWidgets.filter((widget) => widget.placement !== "belowEditor");
  const belowEditorWidgets = extensionWidgets.filter((widget) => widget.placement === "belowEditor");

  if (loading) {
    return (
      <div role="status" className="flex h-full items-center justify-center" style={{ color: "var(--text-muted)" }}>
        {t("chatWindow.loadingSession")}
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="flex h-full items-center justify-center" style={{ color: "var(--accent-strong)", padding: "0 16px", textAlign: "center", fontSize: 13 }}>
        {error}
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && !sessionBusy && (
        <div className="drop-zone-overlay pointer-events-none absolute inset-0 z-50 flex items-center justify-center backdrop-blur-[1px]">
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {[0, 0.8, 1.6].map((delay) => (
              <div
                key={delay}
                className="drop-ripple-ring absolute h-[720px] w-[720px] rounded-full border-[1.5px] border-solid"
                style={{ transformOrigin: "center", animationDelay: `${delay}s` }}
              />
            ))}
          </div>
          <svg
            width="280" height="280" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg"
            className="drop-zone-illustration"
          >
            <rect x="28" y="44" width="84" height="60" rx="8" fill="color-mix(in srgb, var(--accent) 8%, transparent)" stroke="color-mix(in srgb, var(--accent) 50%, transparent)" strokeWidth="1.8"/>
            <path d="M36 100 L54 72 L68 88 L80 74 L104 100Z" fill="color-mix(in srgb, var(--accent) 16%, transparent)" stroke="color-mix(in srgb, var(--accent) 40%, transparent)" strokeWidth="1.4" strokeLinejoin="round"/>
            <circle cx="96" cy="58" r="8" fill="color-mix(in srgb, var(--accent) 22%, transparent)" stroke="color-mix(in srgb, var(--accent) 55%, transparent)" strokeWidth="1.6"/>
            <g stroke="color-mix(in srgb, var(--accent) 45%, transparent)" strokeWidth="1.4" strokeLinecap="round">
              <line x1="96" y1="46" x2="96" y2="43"/>
              <line x1="96" y1="70" x2="96" y2="73"/>
              <line x1="84" y1="58" x2="81" y2="58"/>
              <line x1="108" y1="58" x2="111" y2="58"/>
              <line x1="87.5" y1="49.5" x2="85.4" y2="47.4"/>
              <line x1="104.5" y1="66.5" x2="106.6" y2="68.6"/>
              <line x1="104.5" y1="49.5" x2="106.6" y2="47.4"/>
              <line x1="87.5" y1="66.5" x2="85.4" y2="68.6"/>
            </g>
          </svg>
        </div>
      )}

      {extensionDialog && (
        <ExtensionDialog
          request={extensionDialog}
          onRespond={respondToExtensionUi}
        />
      )}

      <SubagentTranscriptDialog
        subagent={selectedSubagent}
        sessionId={session?.id ?? sessionIdRef.current ?? null}
        transcriptVersion={selectedSubagent ? (subagentTranscriptVersions[selectedSubagent.id] ?? 0) : 0}
        events={selectedSubagent ? (subagentEvents[selectedSubagent.id] ?? []) : undefined}
        onClose={() => setSelectedSubagent(null)}
      />

      {extensionCustomUi && (
        <ExtensionCustomPanel
          request={extensionCustomUi}
          onInput={sendExtensionCustomInput}
        />
      )}

      {isEmptyNew ? (
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8">
          <div className="w-full max-w-[820px]">
            <div
               className="mb-3 empty-chat-brand"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                marginLeft: 16,
                 marginRight: 52,
                fontFamily: "var(--font-mono)",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0, flex: 1, lineHeight: 1.4, overflow: "hidden" }}>
                <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: 0, color: "var(--text)", flexShrink: 0, whiteSpace: "nowrap" }}>⌥</span>
                <span style={{ fontSize: 22, color: "var(--text)", fontWeight: 700, letterSpacing: 0, flexShrink: 0, whiteSpace: "nowrap" }}>omp web</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  web <span style={{ color: "var(--text)" }}>v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}</span>
                </span>
                <OmpRuntimeVersion />
              </div>
            </div>
            <NoticeShelf notices={notices} align="right" />
            {chatInputElement}
          </div>
        </div>
      ) : (
      <>
      <div className="relative flex flex-1 overflow-hidden">
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 0,
            right: isMobile ? 0 : CHAT_MINIMAP_WIDTH,
            zIndex: 40,
            padding: `0 ${CHAT_COLUMN_PADDING}px`,
            pointerEvents: "none",
          }}
        >
          <div style={{ maxWidth: 820, margin: "0 auto" }}>
            <NoticeShelf notices={notices} floating align="right" />
          </div>
        </div>
        {/* Hide the Firefox scrollbar on desktop only: ChatMinimap provides the
            position indicator there, but on mobile there is no minimap and
            users need the scrollbar (Chrome's overlay scrollbar still shows). */}
        <div ref={scrollContainerRef} className={`flex-1 overflow-y-auto pt-4${isMobile ? "" : " [scrollbar-width:none]"}`}>
          <div style={{ padding: `0 ${CHAT_COLUMN_PADDING}px` }}>
            <div style={{ maxWidth: 820, margin: "0 auto" }}>
              <ExtensionStatusBar statuses={extensionStatuses} />
              <ExtensionWidgets widgets={aboveEditorWidgets} />

            <CommittedTranscript
              messages={messages}
              entryIds={entryIds}
              conversationMeta={conversationMeta}
              messageRefs={messageRefs}
              isStreaming={streamState.isStreaming}
              sessionBusy={sessionBusy}
              isNew={isNew}
              forkingEntryId={forkingEntryId}
              handleFork={handleFork}
              handleNavigate={handleNavigate}
              handleEditContent={handleEditContent}
              modelNames={modelNames}
              messageCwd={messageCwd}
              onOpenFile={onOpenFile}
              sessionId={session?.id ?? sessionIdRef.current ?? undefined}
              toolCallsDefaultCollapsed={toolCallsDefaultCollapsed}
              visibleCount={visibleCount}
              sentinelRef={sentinelRef}
              handleLoadMoreClick={handleLoadMoreClick}
            />
            {streamState.isStreaming && streamState.streamingMessage && (
              <MessageView message={streamState.streamingMessage as AgentMessage} isStreaming modelNames={modelNames} cwd={messageCwd} onOpenFile={onOpenFile} toolCallsDefaultCollapsed={toolCallsDefaultCollapsed} />
            )}

            {toolCallsDefaultCollapsed && pendingToolHeaders.map((tool) => (
              <div
                key={tool.id}
                role="status"
                aria-label={t("chatWindow.runningNamed", { names: tool.name })}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  marginBottom: 8, padding: "6px 10px",
                  border: "1px solid color-mix(in srgb, var(--status-success) 25%, transparent)",
                  borderRadius: 7,
                  background: "color-mix(in srgb, var(--status-success) 4%, transparent)",
                  color: "var(--text-muted)", fontSize: 12,
                }}
              >
                <span aria-hidden className="live-status-dot live-pulse inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span style={{ color: "var(--status-success)", fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 11 }}>{tool.name}</span>
              </div>
            ))}

            {agentRunning && !streamState.streamingMessage && pendingToolHeaders.length === 0 && (
              <div role="status" aria-live="polite" className="py-2 text-[13px] text-text-muted flex items-center gap-2">
                <span
                  aria-hidden
                  className="live-status-dot live-pulse inline-block h-2 w-2 shrink-0 rounded-full bg-accent"
                />
                <span>
                  {[
                    phaseLabel(agentPhase),
                    activeSubagentCount > 0 ? tn("chatWindow.subagentCount", activeSubagentCount) : null,
                    currentTodoPhase
                      ? t("chatWindow.todoPhaseStatus", {
                          name: currentTodoPhase.name,
                          done: currentTodoPhase.done,
                          total: currentTodoPhase.total,
                        })
                      : null,
                  ].filter(Boolean).join(" · ")}
                </span>
              </div>
            )}

            {bashRunning && !pendingBash && (
              <div role="status" aria-live="polite" className="py-2 text-[13px] text-text-muted flex items-center gap-2">
                <span
                  aria-hidden
                  className="live-status-dot live-pulse inline-block h-2 w-2 shrink-0 rounded-full bg-accent"
                />
                <span>{t("chatWindow.runningCommand")}</span>
              </div>
            )}

            {pendingBash && (
              <MessageView
                message={{
                  role: "bashExecution",
                  command: pendingBash.command,
                  output: "",
                  excludeFromContext: pendingBash.excludeFromContext,
                } as BashExecutionMessage}
                sessionId={session?.id ?? sessionIdRef.current ?? undefined}
              />
            )}

            <div ref={messagesEndRef} />
            </div>
          </div>
        </div>
        {isMobile ? null : (
          <ChatMinimap
            messages={messages}
            scrollContainer={scrollContainerRef}
            messageRefs={messageRefs}
          />
        )}
      </div>

      <div className="relative">
        <div
          style={{
            padding: `0 ${CHAT_COLUMN_PADDING}px`,
            paddingRight: isMobile ? CHAT_COLUMN_PADDING : CHAT_INPUT_RIGHT_PADDING,
          }}
        >
          <div style={{ maxWidth: 820, margin: "0 auto" }}>
            <ComposerPanels
              todoPhases={todoPhases}
              subagents={subagents}
              onSelectSubagent={setSelectedSubagent}
            />
            <ExtensionWidgets widgets={belowEditorWidgets} />
          </div>
        </div>
        {chatInputElement}
      </div>
      </>
      )}
    </div>
  );
}

function ExtensionStatusBar({ statuses }: { statuses: Array<{ key: string; text: string }> }) {
  if (statuses.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
      {statuses.map((status) => (
        <div
          key={status.key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            maxWidth: "100%",
            padding: "4px 8px",
            border: "1px solid color-mix(in srgb, var(--accent) 24%, var(--border))",
            borderRadius: 6,
            background: "color-mix(in srgb, var(--accent) 7%, var(--bg))",
            color: "var(--text-muted)",
            fontSize: 12,
          }}
        >
          <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{status.key}</span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{status.text}</span>
        </div>
      ))}
    </div>
  );
}

function ExtensionWidgets({ widgets }: { widgets: Array<{ key: string; lines: string[] }> }) {
  if (widgets.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
      {widgets.map((widget) => (
        <div
          key={widget.key}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 7,
            background: "var(--bg-panel)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "5px 9px", borderBottom: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
            {widget.key}
          </div>
          <pre style={{ margin: 0, padding: "8px 9px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)" }}>
            {widget.lines.join("\n")}
          </pre>
        </div>
      ))}
    </div>
  );
}

function NoticeShelf({ notices, floating = false, align = "left" }: { notices: NoticeItem[]; floating?: boolean; align?: "left" | "right" }) {
  if (notices.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "right" ? "flex-end" : "stretch",
        marginBottom: floating ? 0 : 10,
      }}
    >
      {notices.map((notice, index) => {
        const color = notice.type === "error"
          ? "var(--status-error)"
          : notice.type === "warning"
            ? "var(--status-warning)"
            : notice.type === "success"
              ? "var(--status-success)"
              : "var(--accent)";
        return (
          <div
            key={notice.id}
            className="notice-shelf-item"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minHeight: 60,
              height: 60,
              maxHeight: 60,
              marginBottom: index === notices.length - 1 ? 0 : 6,
              overflow: "hidden",
              borderRadius: 14,
              border: "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              width: "fit-content",
              maxWidth: "min(100%, 620px)",
              boxShadow: floating ? "var(--shadow-modal)" : "var(--shadow-pop)",
              fontSize: 18,
              lineHeight: 1.45,
              transformOrigin: "top center",
              animation: notice.exiting
                ? "notice-shelf-out var(--dur-med) ease-in forwards"
                : "notice-shelf-in var(--dur-med) var(--ease-out-warm) both",
              padding: "0 12px",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: color,
                flexShrink: 0,
              }}
            />
            <span style={{ padding: "14px 0", minWidth: 0, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {notice.message}
            </span>
          </div>
        );
      })}
    </div>
  );
}

type ExtensionCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

function renderAnsiLine(line: string, keyPrefix: string): ReactNode[] {
  return parseAnsiLine(line).map((segment, index) => (
    Object.keys(segment.style).length > 0
      ? <span key={`${keyPrefix}-${index}`} style={segment.style}>{segment.text}</span>
      : segment.text
  ));
}

function ExtensionCustomPanel({
  request,
  onInput,
}: {
  request: ExtensionCustomRequest;
  onInput: (request: ExtensionCustomRequest, data: string) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const displayLines = normalizeCustomPanelLines(request.lines);

  useEffect(() => {
    inputRef.current?.focus();
  }, [request.id]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 95,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "var(--overlay-backdrop)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) inputRef.current?.focus();
        }}
        style={{
          position: "relative",
          width: "min(920px, 100%)",
          maxHeight: "min(760px, calc(100vh - 40px))",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
          outline: "none",
        }}
      >
        <textarea
          ref={inputRef}
          aria-label={t("chatWindow.extensionTerminalInput")}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing) return;
            const data = toTerminalKeyData(event);
            if (!data) return;
            event.preventDefault();
            event.stopPropagation();
            onInput(request, data);
          }}
          onInput={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing) return;
            const text = event.currentTarget.value;
            event.currentTarget.value = "";
            if (text) onInput(request, text);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            const input = event.currentTarget;
            queueMicrotask(() => {
              const text = input.value;
              input.value = "";
              if (text) onInput(request, text);
            });
          }}
          onPaste={(event) => {
            event.preventDefault();
            const text = event.clipboardData.getData("text");
            if (text) onInput(request, asBracketedPaste(text));
          }}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            border: 0,
            opacity: 0,
            pointerEvents: "none",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 650 }}>{t("chatWindow.extensionPanel")}</div>
          <button
            onClick={() => onInput(request, "\x03")}
            style={{
              padding: "5px 9px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {t("chatWindow.close")}
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: 14,
            maxHeight: "calc(min(760px, 100vh - 40px) - 48px)",
            overflow: "auto",
            background: "var(--bg-panel)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            lineHeight: 1.45,
            whiteSpace: "pre",
          }}
        >
          {(displayLines.length ? displayLines : [""]).map((line, index, allLines) => (
            <Fragment key={index}>
              {renderAnsiLine(line, `line-${index}`)}
              {index < allLines.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </pre>
      </div>
    </div>
  );
}
