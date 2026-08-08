import { SESSION_BROKER_REGISTRATION_VERSION } from "@hunk/session-broker-core";
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
  SessionReviewFile,
  SessionReviewHunk,
} from "../../src/session/types";

export const TEST_REVIEW_TAB_ID = "tab-1";

export function createTestSessionFileSummary(
  overrides: Partial<SessionFileSummary> = {},
): SessionFileSummary {
  return {
    id: "file-1",
    path: "src/example.ts",
    additions: 1,
    deletions: 1,
    hunkCount: 1,
    ...overrides,
  };
}

export function createTestSessionReviewHunk(
  overrides: Partial<SessionReviewHunk> = {},
): SessionReviewHunk {
  return {
    index: 0,
    header: "@@ -1,1 +1,1 @@",
    oldRange: [1, 1],
    newRange: [1, 1],
    ...overrides,
  };
}

export function createTestSessionReviewFile(
  overrides: Partial<SessionReviewFile> = {},
): SessionReviewFile {
  return {
    ...createTestSessionFileSummary(overrides),
    patch: "@@ -1,1 +1,1 @@",
    hunks: [createTestSessionReviewHunk()],
    ...overrides,
  };
}

function summarizeReviewFile(reviewFile: SessionReviewFile): SessionFileSummary {
  const { patch: _patch, hunks: _hunks, ...summary } = reviewFile;
  return summary;
}

export function createTestReviewTabState(
  overrides: Partial<HunkReviewTabState> = {},
): HunkReviewTabState {
  return {
    tabId: TEST_REVIEW_TAB_ID,
    selectedFileId: "file-1",
    selectedFilePath: "src/example.ts",
    selectedHunkIndex: 0,
    showAgentNotes: false,
    liveCommentCount: 0,
    liveComments: [],
    ...overrides,
  };
}

export function createTestSessionSnapshot({
  updatedAt = "2026-03-22T00:00:00.000Z",
  activeTabId = TEST_REVIEW_TAB_ID,
  tabs,
  ...activeTabOverrides
}: Partial<HunkReviewTabState> & {
  updatedAt?: string;
  activeTabId?: string;
  tabs?: HunkReviewTabState[];
} = {}): HunkSessionSnapshot {
  return {
    updatedAt,
    state: {
      activeTabId,
      tabs: tabs ?? [createTestReviewTabState({ tabId: activeTabId, ...activeTabOverrides })],
    },
  };
}

export function createTestReviewTabInfo(
  overrides: Partial<HunkReviewTabInfo> = {},
): HunkReviewTabInfo {
  return {
    tabId: TEST_REVIEW_TAB_ID,
    name: "repo",
    cwd: "/repo",
    repoRoot: "/repo",
    input: { kind: "vcs", staged: false, options: {} },
    inputKind: "vcs",
    title: "repo working tree",
    sourceLabel: "/repo",
    experimentalFeatures: [],
    files: [createTestSessionReviewFile()],
    ...overrides,
  };
}

export function createTestSessionRegistration(
  overrides: Partial<HunkSessionRegistration> & {
    activeTabId?: string;
    tabs?: HunkReviewTabInfo[];
    activeTab?: Partial<HunkReviewTabInfo>;
  } = {},
): HunkSessionRegistration {
  const {
    activeTabId = TEST_REVIEW_TAB_ID,
    tabs,
    activeTab,
    info: infoOverrides,
    ...registrationOverrides
  } = overrides;
  const resolvedTabs = tabs ?? [createTestReviewTabInfo({ tabId: activeTabId, ...activeTab })];

  return {
    registrationVersion: SESSION_BROKER_REGISTRATION_VERSION,
    sessionId: "session-1",
    pid: 123,
    cwd: "/repo",
    launchedAt: "2026-03-22T00:00:00.000Z",
    ...registrationOverrides,
    info: {
      activeTabId: infoOverrides?.activeTabId ?? activeTabId,
      tabs: infoOverrides?.tabs ?? resolvedTabs,
    },
  };
}

export function createTestListedReviewTab(
  overrides: Partial<ListedReviewTab> = {},
): ListedReviewTab {
  const info = createTestReviewTabInfo();
  return {
    ...info,
    files: info.files.map(summarizeReviewFile),
    state: createTestReviewTabState(),
    ...overrides,
  };
}

export function createTestListedSession(overrides: Partial<ListedSession> = {}): ListedSession {
  const activeTabId = overrides.activeTabId ?? TEST_REVIEW_TAB_ID;
  return {
    sessionId: "session-1",
    pid: 123,
    cwd: "/repo",
    launchedAt: "2026-03-22T00:00:00.000Z",
    activeTabId,
    tabs: [
      createTestListedReviewTab({
        tabId: activeTabId,
        state: createTestReviewTabState({ tabId: activeTabId }),
      }),
    ],
    snapshot: { updatedAt: "2026-03-22T00:00:00.000Z" },
    ...overrides,
  };
}

export function createTestSessionLiveComment(
  overrides: Partial<SessionLiveCommentSummary> = {},
): SessionLiveCommentSummary {
  return {
    commentId: "comment-1",
    filePath: "src/example.ts",
    hunkIndex: 0,
    side: "new",
    line: 4,
    summary: "Review note",
    createdAt: "2026-03-22T00:00:00.000Z",
    ...overrides,
  };
}

export function createTestSelectedSessionContext(
  overrides: Omit<Partial<SelectedSessionContext>, "tab"> & {
    tab?: Partial<SelectedSessionContext["tab"]>;
  } = {},
): SelectedSessionContext {
  return {
    sessionId: "session-1",
    activeTabId: TEST_REVIEW_TAB_ID,
    ...overrides,
    tab: {
      tabId: TEST_REVIEW_TAB_ID,
      name: "repo",
      cwd: "/repo",
      repoRoot: "/repo",
      inputKind: "diff",
      title: "repo diff",
      sourceLabel: "/repo",
      experimentalFeatures: [],
      selectedFile: createTestSessionFileSummary({ additions: 1, deletions: 0, path: "README.md" }),
      selectedHunk: { index: 0, oldRange: [1, 1], newRange: [1, 2] },
      showAgentNotes: false,
      liveCommentCount: 0,
      ...overrides.tab,
    },
  };
}

export function createTestSessionReview(
  overrides: Omit<Partial<SessionReview>, "tab"> & { tab?: Partial<SessionReview["tab"]> } = {},
): SessionReview {
  const files = overrides.tab?.files ?? [createTestSessionReviewFile()];
  const selectedFile =
    overrides.tab?.selectedFile === undefined ? (files[0] ?? null) : overrides.tab.selectedFile;
  const selectedHunk =
    overrides.tab?.selectedHunk === undefined
      ? (selectedFile?.hunks[0] ?? null)
      : overrides.tab.selectedHunk;

  return {
    sessionId: "session-1",
    activeTabId: TEST_REVIEW_TAB_ID,
    ...overrides,
    tab: {
      tabId: TEST_REVIEW_TAB_ID,
      name: "repo",
      cwd: "/repo",
      repoRoot: "/repo",
      inputKind: "vcs",
      title: "repo working tree",
      sourceLabel: "/repo",
      experimentalFeatures: [],
      showAgentNotes: false,
      liveCommentCount: 0,
      ...overrides.tab,
      selectedFile,
      selectedHunk,
      files,
    },
  };
}

export function createTestListedSessionFromReviewFiles(
  files: SessionReviewFile[],
  overrides: Partial<ListedSession> = {},
): ListedSession {
  return createTestListedSession({
    tabs: [createTestListedReviewTab({ files: files.map(summarizeReviewFile) })],
    ...overrides,
  });
}
