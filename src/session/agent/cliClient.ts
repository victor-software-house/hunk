import { sanitizeTerminalText } from "../../lib/terminalText";
import { resolveSessionBrokerConfig } from "../broker/brokerConfig";
import type { SessionTerminalLocation, SessionTerminalMetadata } from "@hunk/session-broker-core";
import { readHunkSessionDaemonCapabilities } from "../client/capabilities";
import {
  HUNK_SESSION_DAEMON_HTTP_TIMEOUT_MS,
  requestSessionDaemonHttp,
} from "../client/daemonHttp";
import {
  HUNK_SESSION_API_PATH,
  type SessionDaemonCapabilities,
  type SessionDaemonRequest,
} from "../protocol";
import type {
  AppliedCommentBatchResult,
  AppliedCommentResult,
  ClearedCommentsResult,
  ClosedReviewTabResult,
  ListedSession,
  NavigatedSelectionResult,
  ReloadedSessionResult,
  RemovedCommentResult,
  SelectedSessionContext,
  SessionLiveCommentSummary,
  SessionReview,
  SessionReviewNoteSummary,
  MutatedReviewTabResult,
} from "../types";
import type {
  SessionCommentAddCommandInput,
  SessionCommentApplyCommandInput,
  SessionCommentClearCommandInput,
  SessionCommentListCommandInput,
  SessionCommentRemoveCommandInput,
  SessionNavigateCommandInput,
  SessionReloadCommandInput,
  SessionReviewCommandInput,
  SessionSelectorInput,
  SessionTabAddCommandInput,
  SessionTabRenameCommandInput,
  SessionTabTargetCommandInput,
} from "../../core/types";
import { describeSessionSelector } from "@hunk/session-broker-core";

export interface HunkSessionCliClient {
  getCapabilities(): Promise<SessionDaemonCapabilities | null>;
  listSessions(): Promise<ListedSession[]>;
  getSession(selector: SessionSelectorInput): Promise<ListedSession>;
  getSelectedContext(selector: SessionSelectorInput): Promise<SelectedSessionContext>;
  getSessionReview(input: SessionReviewCommandInput): Promise<SessionReview>;
  navigateToHunk(input: SessionNavigateCommandInput): Promise<NavigatedSelectionResult>;
  reloadSession(input: SessionReloadCommandInput): Promise<ReloadedSessionResult>;
  addTab(input: SessionTabAddCommandInput): Promise<MutatedReviewTabResult>;
  selectTab(input: SessionTabTargetCommandInput): Promise<MutatedReviewTabResult>;
  renameTab(input: SessionTabRenameCommandInput): Promise<MutatedReviewTabResult>;
  closeTab(input: SessionTabTargetCommandInput): Promise<ClosedReviewTabResult>;
  addComment(input: SessionCommentAddCommandInput): Promise<AppliedCommentResult>;
  applyComments(input: SessionCommentApplyCommandInput): Promise<AppliedCommentBatchResult>;
  listComments(
    input: SessionCommentListCommandInput,
  ): Promise<Array<SessionLiveCommentSummary | SessionReviewNoteSummary>>;
  removeComment(input: SessionCommentRemoveCommandInput): Promise<RemovedCommentResult>;
  clearComments(input: SessionCommentClearCommandInput): Promise<ClearedCommentsResult>;
}

async function extractResponseError(response: Response) {
  try {
    const parsed = (await response.json()) as { error?: string };
    if (typeof parsed.error === "string" && parsed.error.length > 0) {
      return parsed.error;
    }
  } catch {
    // Fall through to status text.
  }

  return response.statusText || "Unknown Hunk session daemon error.";
}

class HttpHunkSessionCliClient implements HunkSessionCliClient {
  private readonly config = resolveSessionBrokerConfig();

  constructor(private readonly timeoutMs = HUNK_SESSION_DAEMON_HTTP_TIMEOUT_MS) {}

  private async request<ResultType>(input: SessionDaemonRequest) {
    return requestSessionDaemonHttp({
      config: this.config,
      path: HUNK_SESSION_API_PATH,
      operation: `complete session ${input.action}`,
      timeoutMs: this.timeoutMs,
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      },
      parse: async (response) => {
        if (!response.ok) {
          throw new Error(await extractResponseError(response));
        }

        return (await response.json()) as ResultType;
      },
    });
  }

  async getCapabilities() {
    return readHunkSessionDaemonCapabilities(this.config, this.timeoutMs);
  }

  async listSessions() {
    return (await this.request<{ sessions: ListedSession[] }>({ action: "list" })).sessions;
  }

  async getSession(selector: SessionSelectorInput) {
    return (await this.request<{ session: ListedSession }>({ action: "get", selector })).session;
  }

  async getSelectedContext(selector: SessionSelectorInput) {
    return (
      await this.request<{ context: SelectedSessionContext }>({ action: "context", selector })
    ).context;
  }

  async getSessionReview(input: SessionReviewCommandInput) {
    return (
      await this.request<{ review: SessionReview }>({
        action: "review",
        selector: input.selector,
        includePatch: input.includePatch,
        includeNotes: input.includeNotes,
      })
    ).review;
  }

  async navigateToHunk(input: SessionNavigateCommandInput) {
    return (
      await this.request<{ result: NavigatedSelectionResult }>({
        action: "navigate",
        selector: input.selector,
        filePath: input.filePath,
        hunkNumber: input.hunkNumber,
        side: input.side,
        line: input.line,
        commentDirection: input.commentDirection,
      })
    ).result;
  }

  async reloadSession(input: SessionReloadCommandInput) {
    return (
      await this.request<{ result: ReloadedSessionResult }>({
        action: "reload",
        selector: input.selector,
        nextInput: input.nextInput,
        sourcePath: input.sourcePath,
      })
    ).result;
  }

  async addTab(input: SessionTabAddCommandInput) {
    return (
      await this.request<{ result: MutatedReviewTabResult }>({
        action: "tab-add",
        selector: input.selector,
        name: input.name,
        sourcePath: input.sourcePath,
        input: input.input,
      })
    ).result;
  }

  async selectTab(input: SessionTabTargetCommandInput) {
    return (
      await this.request<{ result: MutatedReviewTabResult }>({
        action: "tab-select",
        selector: input.selector,
        tab: input.tab,
      })
    ).result;
  }

  async renameTab(input: SessionTabRenameCommandInput) {
    return (
      await this.request<{ result: MutatedReviewTabResult }>({
        action: "tab-rename",
        selector: input.selector,
        tab: input.tab,
        name: input.name,
      })
    ).result;
  }

  async closeTab(input: SessionTabTargetCommandInput) {
    return (
      await this.request<{ result: ClosedReviewTabResult }>({
        action: "tab-close",
        selector: input.selector,
        tab: input.tab,
      })
    ).result;
  }

  async addComment(input: SessionCommentAddCommandInput) {
    return (
      await this.request<{ result: AppliedCommentResult }>({
        action: "comment-add",
        selector: input.selector,
        filePath: input.filePath,
        side: input.side,
        line: input.line,
        summary: input.summary,
        rationale: input.rationale,
        markup: input.markup,
        author: input.author,
        reveal: input.reveal,
      })
    ).result;
  }

  async applyComments(input: SessionCommentApplyCommandInput) {
    return (
      await this.request<{ result: AppliedCommentBatchResult }>({
        action: "comment-apply",
        selector: input.selector,
        comments: input.comments,
        revealMode: input.revealMode,
      })
    ).result;
  }

  async listComments(input: SessionCommentListCommandInput) {
    return (
      await this.request<{ comments: Array<SessionLiveCommentSummary | SessionReviewNoteSummary> }>(
        {
          action: "comment-list",
          selector: input.selector,
          filePath: input.filePath,
          type: input.type,
        },
      )
    ).comments;
  }

  async removeComment(input: SessionCommentRemoveCommandInput) {
    return (
      await this.request<{ result: RemovedCommentResult }>({
        action: "comment-rm",
        selector: input.selector,
        commentId: input.commentId,
      })
    ).result;
  }

  async clearComments(input: SessionCommentClearCommandInput) {
    return (
      await this.request<{ result: ClearedCommentsResult }>({
        action: "comment-clear",
        selector: input.selector,
        filePath: input.filePath,
        includeUser: input.includeUser,
      })
    ).result;
  }
}

/** Create the concrete Hunk session CLI client that speaks to the broker-backed HTTP API. */
export function createHttpHunkSessionCliClient({
  timeoutMs,
}: { timeoutMs?: number } = {}): HunkSessionCliClient {
  return new HttpHunkSessionCliClient(timeoutMs);
}

export function stringifyJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function activeListedTab(session: ListedSession) {
  const tab = session.tabs.find((candidate) => candidate.tabId === session.activeTabId);
  if (!tab) throw new Error(`Active review tab is missing: ${session.activeTabId}`);
  return tab;
}

function formatSelectedSummary(session: ListedSession) {
  const tab = activeListedTab(session);
  const filePath = tab.state.selectedFilePath
    ? formatSessionPath(tab.state.selectedFilePath)
    : "(none)";
  const hunkNumber = tab.state.selectedFilePath ? tab.state.selectedHunkIndex + 1 : 0;
  return filePath === "(none)" ? filePath : `${filePath} hunk ${hunkNumber}`;
}

function formatTerminalLocation(location: SessionTerminalLocation) {
  const parts: string[] = [];

  if (location.tty) {
    parts.push(location.tty);
  }

  if (location.windowId) {
    parts.push(`window ${location.windowId}`);
  }

  if (location.tabId) {
    parts.push(`tab ${location.tabId}`);
  }

  if (location.paneId) {
    parts.push(`pane ${location.paneId}`);
  }

  if (location.terminalId) {
    parts.push(`terminal ${location.terminalId}`);
  }

  if (location.sessionId) {
    parts.push(`session ${location.sessionId}`);
  }

  return parts.length > 0 ? parts.join(", ") : "present";
}

function formatTerminalLines(
  terminal: SessionTerminalMetadata | undefined,
  {
    headerLabel,
    locationLabel,
  }: {
    headerLabel: string;
    locationLabel: string;
  },
) {
  if (!terminal) {
    return [];
  }

  return [
    ...(terminal.program ? [`${headerLabel}: ${terminal.program}`] : []),
    ...terminal.locations.map(
      (location) => `${locationLabel}[${location.source}]: ${formatTerminalLocation(location)}`,
    ),
  ];
}

export function formatListOutput(sessions: ListedSession[]) {
  if (sessions.length === 0) {
    return "No active Hunk sessions.\n";
  }

  return `${sessions
    .map((session) => {
      const terminal = session.terminal;
      const tab = activeListedTab(session);
      return [
        `${session.sessionId}  ${formatSessionPath(tab.name)}`,
        `  path: ${formatSessionPath(tab.cwd)}`,
        `  repo: ${tab.repoRoot ? formatSessionPath(tab.repoRoot) : "-"}`,
        ...formatTerminalLines(terminal, {
          headerLabel: "  terminal",
          locationLabel: "  location",
        }),
        `  active tab: ${formatSessionPath(tab.name)} (${session.tabs.length} total)`,
        `  focus: ${formatSelectedSummary(session)}`,
        `  files: ${tab.files.length}`,
        `  comments: ${tab.state.liveCommentCount}`,
      ].join("\n");
    })
    .join("\n\n")}\n`;
}

/** Keep exact session paths in JSON while neutralizing controls in human-readable output. */
function formatSessionPath(path: string) {
  return sanitizeTerminalText(path, { preserveNewlines: false, preserveTabs: false });
}

/** Sanitize selectors because session-path targets can contain arbitrary filesystem characters. */
function formatSessionSelector(selector: SessionSelectorInput) {
  return formatSessionPath(describeSessionSelector(selector));
}

export function formatSessionOutput(session: ListedSession) {
  const terminal = session.terminal;
  const activeTab = activeListedTab(session);

  return [
    `Session: ${session.sessionId}`,
    `Active tab: ${formatSessionPath(activeTab.name)} (${activeTab.tabId})`,
    `Path: ${formatSessionPath(activeTab.cwd)}`,
    `Repo: ${activeTab.repoRoot ? formatSessionPath(activeTab.repoRoot) : "-"}`,
    `Input: ${activeTab.inputKind}`,
    `Title: ${formatSessionPath(activeTab.title)}`,
    `Source: ${formatSessionPath(activeTab.sourceLabel)}`,
    ...((activeTab.experimentalFeatures?.length ?? 0) > 0
      ? [`Experimental features: ${activeTab.experimentalFeatures!.join(", ")}`]
      : []),
    `Launched: ${session.launchedAt}`,
    ...formatTerminalLines(terminal, {
      headerLabel: "Terminal",
      locationLabel: "Location",
    }),
    `Selected: ${formatSelectedSummary(session)}`,
    `Agent notes visible: ${activeTab.state.showAgentNotes ? "yes" : "no"}`,
    `Live comments: ${activeTab.state.liveCommentCount}`,
    "Tabs:",
    ...session.tabs.map(
      (tab) =>
        `  ${tab.tabId === session.activeTabId ? "*" : "-"} ${formatSessionPath(tab.name)} (${tab.tabId}, ${tab.files.length} files)`,
    ),
    "Files:",
    ...activeTab.files.map(
      (file) =>
        `  - ${formatSessionPath(file.path)} (+${file.additions} -${file.deletions}, hunks: ${file.hunkCount})`,
    ),
    "",
  ].join("\n");
}

export function formatContextOutput(context: SelectedSessionContext) {
  const { tab } = context;
  const selectedFile = tab.selectedFile?.path ? formatSessionPath(tab.selectedFile.path) : "(none)";
  const hunkNumber = tab.selectedHunk ? tab.selectedHunk.index + 1 : 0;
  const oldRange = tab.selectedHunk?.oldRange
    ? `${tab.selectedHunk.oldRange[0]}..${tab.selectedHunk.oldRange[1]}`
    : "-";
  const newRange = tab.selectedHunk?.newRange
    ? `${tab.selectedHunk.newRange[0]}..${tab.selectedHunk.newRange[1]}`
    : "-";

  return [
    `Session: ${context.sessionId}`,
    `Tab: ${formatSessionPath(tab.name)} (${tab.tabId})`,
    `Title: ${formatSessionPath(tab.title)}`,
    `Path: ${tab.cwd ? formatSessionPath(tab.cwd) : "-"}`,
    `Repo: ${tab.repoRoot ? formatSessionPath(tab.repoRoot) : "-"}`,
    `File: ${selectedFile}`,
    `Hunk: ${tab.selectedHunk ? hunkNumber : "-"}`,
    `Old range: ${oldRange}`,
    `New range: ${newRange}`,
    `Agent notes visible: ${tab.showAgentNotes ? "yes" : "no"}`,
    ...(tab.experimentalFeatures?.includes("stml")
      ? [
          `Experimental features: ${tab.experimentalFeatures.join(", ")}`,
          `Note markup width: ${tab.noteMarkupWidth ?? "-"}`,
        ]
      : []),
    `Live comments: ${tab.liveCommentCount}`,
    "",
  ].join("\n");
}

/** Render one human-readable summary of the exported active-tab review model. */
export function formatReviewOutput(review: SessionReview) {
  const { tab } = review;
  const selectedFile = tab.selectedFile?.path ? formatSessionPath(tab.selectedFile.path) : "(none)";
  const hunkNumber = tab.selectedHunk ? tab.selectedHunk.index + 1 : "-";

  return [
    `Session: ${review.sessionId}`,
    `Tab: ${formatSessionPath(tab.name)} (${tab.tabId})`,
    `Title: ${formatSessionPath(tab.title)}`,
    `Source: ${formatSessionPath(tab.sourceLabel)}`,
    `Path: ${tab.cwd ? formatSessionPath(tab.cwd) : "-"}`,
    `Repo: ${tab.repoRoot ? formatSessionPath(tab.repoRoot) : "-"}`,
    `Input: ${tab.inputKind}`,
    ...((tab.experimentalFeatures?.length ?? 0) > 0
      ? [`Experimental features: ${tab.experimentalFeatures!.join(", ")}`]
      : []),
    `Selected file: ${selectedFile}`,
    `Selected hunk: ${hunkNumber}`,
    `Agent notes visible: ${tab.showAgentNotes ? "yes" : "no"}`,
    `Live comments: ${tab.liveCommentCount}`,
    `Review notes: ${tab.reviewNoteCount ?? tab.reviewNotes?.length ?? 0}`,
    ...(tab.reviewNotes
      ? [
          "Notes:",
          ...tab.reviewNotes.map(
            (note) =>
              `  - ${note.noteId} [${note.source}] ${formatSessionPath(note.filePath)}: ${note.body}`,
          ),
        ]
      : []),
    "Files:",
    ...tab.files.flatMap((file) => [
      `  - ${formatSessionPath(file.path)} (+${file.additions} -${file.deletions}, hunks: ${file.hunkCount})`,
      ...file.hunks.map((hunk) => `      hunk ${hunk.index + 1}: ${hunk.header}`),
    ]),
    "",
  ].join("\n");
}

export function formatNavigationOutput(
  selector: SessionSelectorInput,
  result: NavigatedSelectionResult,
) {
  return `Focused ${formatSessionPath(result.filePath)} hunk ${result.hunkIndex + 1} in ${formatSessionSelector(selector)}.\n`;
}

export function formatReloadOutput(selector: SessionSelectorInput, result: ReloadedSessionResult) {
  const selected = result.selectedFilePath
    ? `${formatSessionPath(result.selectedFilePath)} hunk ${result.selectedHunkIndex + 1}`
    : "(no files)";
  return `Reloaded ${formatSessionSelector(selector)} with ${formatSessionPath(result.title)} (${result.fileCount} files). Selected: ${selected}.\n`;
}

export function formatTabMutationOutput(
  action: "added" | "selected" | "renamed",
  result: MutatedReviewTabResult,
) {
  return `${action[0]!.toUpperCase()}${action.slice(1)} tab ${formatSessionPath(result.tab.name)} (${result.tab.tabId}) in session ${result.sessionId}.\n`;
}

export function formatTabCloseOutput(result: ClosedReviewTabResult) {
  return `Closed tab ${result.closedTabId}. Active: ${formatSessionPath(result.activeTab.name)} (${result.activeTab.tabId}).\n`;
}

/** Format the STML render notes attached to one applied comment, if any. */
function formatMarkupNotes(result: AppliedCommentResult, indent = "") {
  const widthHint =
    result.markupWidth !== undefined
      ? ` (preview with \`hunk markup render - --width ${result.markupWidth}\`)`
      : " (preview with `hunk markup render`)";
  return (result.markupNotes ?? []).map((note) => `${indent}Markup note: ${note}${widthHint}.`);
}

export function formatCommentOutput(selector: SessionSelectorInput, result: AppliedCommentResult) {
  return `${[
    `Added live comment ${result.commentId} on ${formatSessionPath(result.filePath)}:${result.line} (${result.side}) in hunk ${result.hunkIndex + 1} for ${formatSessionSelector(selector)}.`,
    ...formatMarkupNotes(result),
  ].join("\n")}\n`;
}

export function formatCommentApplyOutput(
  selector: SessionSelectorInput,
  result: AppliedCommentBatchResult,
) {
  if (result.applied.length === 0) {
    return `Applied 0 live comments to ${formatSessionSelector(selector)}.\n`;
  }

  return `${[
    `Applied ${result.applied.length} live comments to ${formatSessionSelector(selector)}:`,
    ...result.applied.flatMap((comment) => [
      `  - ${comment.commentId} on ${formatSessionPath(comment.filePath)}:${comment.line} (${comment.side}) hunk ${comment.hunkIndex + 1}`,
      ...formatMarkupNotes(comment, "    "),
    ]),
    "",
  ].join("\n")}`;
}

export function formatCommentListOutput(
  selector: SessionSelectorInput,
  comments: SessionLiveCommentSummary[],
) {
  if (comments.length === 0) {
    return `No live comments for ${formatSessionSelector(selector)}.\n`;
  }

  return `${comments
    .map((comment) =>
      [
        `${comment.commentId}  ${formatSessionPath(comment.filePath)}:${comment.line} (${comment.side})`,
        `  hunk: ${comment.hunkIndex + 1}`,
        `  summary: ${comment.summary}`,
        ...(comment.author ? [`  author: ${comment.author}`] : []),
      ].join("\n"),
    )
    .join("\n\n")}\n`;
}

export function formatRemoveCommentOutput(
  selector: SessionSelectorInput,
  result: RemovedCommentResult,
) {
  const label = result.source === "user" ? "user note" : "live comment";
  return `Removed ${label} ${result.commentId} from ${formatSessionSelector(selector)}. Remaining comments: ${result.remainingCommentCount}.\n`;
}

export function formatNoteListOutput(
  selector: SessionSelectorInput,
  notes: SessionReviewNoteSummary[],
) {
  if (notes.length === 0) {
    return `No review notes for ${formatSessionSelector(selector)}.\n`;
  }

  return `${notes
    .map((note) =>
      [
        `${note.noteId}  ${formatSessionPath(note.filePath)} [${note.source}]`,
        ...(note.hunkIndex !== undefined ? [`  hunk: ${note.hunkIndex + 1}`] : []),
        `  body: ${note.body}`,
        ...(note.author ? [`  author: ${note.author}`] : []),
      ].join("\n"),
    )
    .join("\n\n")}\n`;
}

export function formatClearCommentsOutput(
  selector: SessionSelectorInput,
  result: ClearedCommentsResult,
) {
  const scope = result.filePath
    ? `${formatSessionPath(result.filePath)} in ${formatSessionSelector(selector)}`
    : formatSessionSelector(selector);
  const label = result.includeUser ? "comments" : "live comments";
  return `Cleared ${result.removedCount} ${label} from ${scope}. Remaining comments: ${result.remainingCommentCount}.\n`;
}
