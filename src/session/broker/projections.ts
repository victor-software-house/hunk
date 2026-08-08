import type {
  HunkReviewTabInfo,
  HunkReviewTabState,
  HunkSessionRegistration,
  HunkSessionSnapshot,
  ListedReviewTab,
  ListedSession,
  SelectedSessionContext,
  SessionFileSummary,
  SessionLiveCommentSummary,
  SessionReview,
  SessionReviewNoteSummary,
  SessionReviewFile,
} from "../types";

export interface HunkSessionEntryLike {
  registration: HunkSessionRegistration;
  snapshot: HunkSessionSnapshot;
}

/** Resolve one tab's registration and live state, defaulting to the active tab. */
function resolveTab(
  info: { activeTabId: string; tabs: HunkReviewTabInfo[] },
  state: { activeTabId: string; tabs: HunkReviewTabState[] },
  tabId = state.activeTabId,
) {
  const tab = info.tabs.find((candidate) => candidate.tabId === tabId);
  const tabState = state.tabs.find((candidate) => candidate.tabId === tabId);
  if (!tab || !tabState) throw new Error(`Review tab is missing from session data: ${tabId}`);
  return { tab, state: tabState };
}

function findSelectedFile(tab: ListedReviewTab) {
  return (
    tab.files.find(
      (file) =>
        file.id === tab.state.selectedFileId ||
        file.path === tab.state.selectedFilePath ||
        file.previousPath === tab.state.selectedFilePath,
    ) ?? null
  );
}

/** Reduce one review-export file back to the summary fields used by session listings. */
export function summarizeReviewFile(reviewFile: SessionReviewFile): SessionFileSummary {
  return {
    id: reviewFile.id,
    path: reviewFile.path,
    previousPath: reviewFile.previousPath,
    additions: reviewFile.additions,
    deletions: reviewFile.deletions,
    hunkCount: reviewFile.hunkCount,
  };
}

/** Serialize one review-export file while keeping raw patch text opt-in for callers. */
export function serializeReviewFile(
  reviewFile: SessionReviewFile,
  includePatch: boolean,
): SessionReviewFile {
  return includePatch
    ? reviewFile
    : {
        ...summarizeReviewFile(reviewFile),
        hunks: reviewFile.hunks,
      };
}

/** Project one raw broker entry into the process session and ordered tab hierarchy. */
export function buildListedHunkSession(entry: HunkSessionEntryLike): ListedSession {
  const states = new Map(entry.snapshot.state.tabs.map((state) => [state.tabId, state]));
  const active = entry.registration.info.tabs.find(
    (tab) => tab.tabId === entry.snapshot.state.activeTabId,
  );
  if (!active) throw new Error(`Active review tab is missing: ${entry.snapshot.state.activeTabId}`);

  return {
    sessionId: entry.registration.sessionId,
    pid: entry.registration.pid,
    cwd: entry.registration.cwd,
    launchedAt: entry.registration.launchedAt,
    terminal: entry.registration.terminal,
    activeTabId: entry.snapshot.state.activeTabId,
    tabs: entry.registration.info.tabs.map((tab) => {
      const state = states.get(tab.tabId);
      if (!state) throw new Error(`Review tab state is missing: ${tab.tabId}`);
      return { ...tab, files: tab.files.map(summarizeReviewFile), state };
    }),
    snapshot: { updatedAt: entry.snapshot.updatedAt },
  };
}

/** Project the active tab's selected file and hunk for one Hunk process. */
export function buildSelectedHunkSessionContext(session: ListedSession): SelectedSessionContext {
  const tab = session.tabs.find((candidate) => candidate.tabId === session.activeTabId);
  if (!tab) throw new Error(`Active review tab is missing: ${session.activeTabId}`);
  const selectedFile = findSelectedFile(tab);

  return {
    sessionId: session.sessionId,
    activeTabId: session.activeTabId,
    tab: {
      tabId: tab.tabId,
      name: tab.name,
      cwd: tab.cwd,
      repoRoot: tab.repoRoot,
      inputKind: tab.inputKind,
      title: tab.title,
      sourceLabel: tab.sourceLabel,
      experimentalFeatures: tab.experimentalFeatures,
      selectedFile,
      selectedHunk: selectedFile
        ? {
            index: tab.state.selectedHunkIndex,
            oldRange: tab.state.selectedHunkOldRange,
            newRange: tab.state.selectedHunkNewRange,
          }
        : null,
      showAgentNotes: tab.state.showAgentNotes,
      noteMarkupWidth: tab.state.noteMarkupWidth,
      liveCommentCount: tab.state.liveCommentCount,
    },
  };
}

/** Project the active tab's complete review for `hunk session review`. */
export function buildHunkSessionReview(
  entry: HunkSessionEntryLike,
  options: { includePatch?: boolean; includeNotes?: boolean } = {},
): SessionReview {
  const active = resolveTab(entry.registration.info, entry.snapshot.state);
  const selectedFile =
    active.tab.files.find(
      (file) =>
        file.id === active.state.selectedFileId ||
        file.path === active.state.selectedFilePath ||
        file.previousPath === active.state.selectedFilePath,
    ) ?? null;
  const includePatch = options.includePatch ?? false;

  return {
    sessionId: entry.registration.sessionId,
    activeTabId: entry.snapshot.state.activeTabId,
    tab: {
      tabId: active.tab.tabId,
      name: active.tab.name,
      cwd: active.tab.cwd,
      repoRoot: active.tab.repoRoot,
      inputKind: active.tab.inputKind,
      title: active.tab.title,
      sourceLabel: active.tab.sourceLabel,
      experimentalFeatures: active.tab.experimentalFeatures ?? [],
      selectedFile: selectedFile ? serializeReviewFile(selectedFile, includePatch) : null,
      selectedHunk: selectedFile
        ? (selectedFile.hunks[active.state.selectedHunkIndex] ?? null)
        : null,
      showAgentNotes: active.state.showAgentNotes,
      liveCommentCount: active.state.liveCommentCount,
      reviewNoteCount: active.state.reviewNoteCount ?? active.state.reviewNotes?.length ?? 0,
      reviewNotes: options.includeNotes ? (active.state.reviewNotes ?? []) : undefined,
      files: active.tab.files.map((file) => serializeReviewFile(file, includePatch)),
    },
  };
}

/** Return the active tab's live comments, optionally filtered to one file. */
export function listHunkSessionComments(
  session: ListedSession,
  filter: { filePath?: string } = {},
): SessionLiveCommentSummary[] {
  const tab = session.tabs.find((candidate) => candidate.tabId === session.activeTabId);
  if (!tab) return [];
  return filter.filePath
    ? tab.state.liveComments.filter((comment) => comment.filePath === filter.filePath)
    : tab.state.liveComments;
}

/** Return the active tab's notes, optionally filtered to a file and source. */
export function listHunkSessionNotes(
  session: ListedSession,
  filter: { filePath?: string; source?: SessionReviewNoteSummary["source"] } = {},
): SessionReviewNoteSummary[] {
  const tab = session.tabs.find((candidate) => candidate.tabId === session.activeTabId);
  return (tab?.state.reviewNotes ?? []).filter((note) => {
    if (filter.filePath && note.filePath !== filter.filePath) return false;
    if (filter.source && note.source !== filter.source) return false;
    return true;
  });
}
