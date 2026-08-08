import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { defaultReviewTabName } from "../../app/reviewTabs";
import { resolveExperimentalFeatures } from "../../core/experimental";
import { summarizeHunk } from "../../core/hunkSummary";
import { hunkLineRange } from "../../core/liveComments";
import type { AppBootstrap } from "../../core/types";
import {
  SESSION_BROKER_REGISTRATION_VERSION,
  resolveSessionTerminalMetadata,
} from "@hunk/session-broker-core";
import type {
  HunkReviewTabInfo,
  HunkReviewTabState,
  HunkSessionRegistration,
  HunkSessionSnapshot,
  SessionReviewFile,
} from "../types";

/** Resolve the TTY device path for the current process, if available. */
function ttyname(): string | undefined {
  if (!process.stdin.isTTY) {
    return undefined;
  }

  try {
    const result = spawnSync("tty", [], { stdio: ["inherit", "pipe", "pipe"] });
    const name = result.stdout?.toString().trim();
    return name && !name.startsWith("not a tty") ? name : undefined;
  } catch {
    return undefined;
  }
}

/** Infer the repo-root selector that remote session commands should match for this review input. */
function inferRepoRoot(bootstrap: AppBootstrap) {
  return bootstrap.input.kind === "vcs" ||
    bootstrap.input.kind === "show" ||
    bootstrap.input.kind === "stash-show"
    ? bootstrap.changeset.sourceLabel
    : undefined;
}

/** Convert the loaded changeset into the app-owned file-and-hunk review export model. */
function buildSessionFiles(bootstrap: AppBootstrap): SessionReviewFile[] {
  return bootstrap.changeset.files.map((file) => ({
    id: file.id,
    path: file.path,
    previousPath: file.previousPath,
    additions: file.stats.additions,
    deletions: file.stats.deletions,
    hunkCount: file.metadata.hunks.length,
    patch: file.patch,
    // The same derivation the extension API's file views use, so the two
    // external views of a review never disagree on a hunk's header or spans.
    hunks: file.metadata.hunks.map((hunk, index) => summarizeHunk(hunk, index)),
  }));
}

/** Build one review tab's registered content from its loaded bootstrap. */
export function buildReviewTabInfo(
  bootstrap: AppBootstrap,
  tab: { tabId: string; name: string; cwd: string },
): HunkReviewTabInfo {
  return {
    ...tab,
    repoRoot: inferRepoRoot(bootstrap),
    input: bootstrap.input,
    inputKind: bootstrap.input.kind,
    title: bootstrap.changeset.title,
    sourceLabel: bootstrap.changeset.sourceLabel,
    experimentalFeatures: resolveExperimentalFeatures(bootstrap.input.options),
    files: buildSessionFiles(bootstrap),
  };
}

/** Build one tab's initial selection and comment state. */
export function buildInitialReviewTabState(
  bootstrap: AppBootstrap,
  tabId: string,
): HunkReviewTabState {
  const firstFile = bootstrap.changeset.files[0];
  const firstHunk = firstFile?.metadata.hunks[0];
  const firstRange = firstHunk ? hunkLineRange(firstHunk) : null;

  return {
    tabId,
    selectedFileId: firstFile?.id,
    selectedFilePath: firstFile?.path,
    selectedHunkIndex: 0,
    selectedHunkOldRange: firstRange?.oldRange,
    selectedHunkNewRange: firstRange?.newRange,
    showAgentNotes: bootstrap.initialShowAgentNotes ?? false,
    liveCommentCount: 0,
    liveComments: [],
    reviewNoteCount: 0,
    reviewNotes: [],
  };
}

/** Build the broker-facing envelope for one Hunk process and its initial review tab. */
export function createSessionRegistration(bootstrap: AppBootstrap): HunkSessionRegistration {
  const terminal = resolveSessionTerminalMetadata({ tty: ttyname() });
  const tabId = randomUUID();
  const tab = buildReviewTabInfo(bootstrap, {
    tabId,
    name: defaultReviewTabName(bootstrap),
    cwd: bootstrap.reloadContext.cwd,
  });

  return {
    registrationVersion: SESSION_BROKER_REGISTRATION_VERSION,
    sessionId: randomUUID(),
    pid: process.pid,
    cwd: process.cwd(),
    launchedAt: new Date().toISOString(),
    terminal,
    info: { activeTabId: tabId, tabs: [tab] },
  };
}

/** Rebuild the active tab's registration content while preserving process and tab identity. */
export function updateSessionRegistration(
  current: HunkSessionRegistration,
  bootstrap: AppBootstrap,
  tabId = current.info.activeTabId,
): HunkSessionRegistration {
  const currentTab = current.info.tabs.find((tab) => tab.tabId === tabId);
  if (!currentTab) throw new Error(`Review tab is missing: ${tabId}`);

  return {
    ...current,
    registrationVersion: SESSION_BROKER_REGISTRATION_VERSION,
    info: {
      ...current.info,
      tabs: current.info.tabs.map((tab) =>
        tab.tabId === currentTab.tabId
          ? buildReviewTabInfo(bootstrap, {
              tabId: tab.tabId,
              name: tab.name,
              cwd: bootstrap.reloadContext.cwd,
            })
          : tab,
      ),
    },
  };
}

/** Start with an empty-but-valid state for every registered review tab. */
export function createInitialSessionSnapshot(
  bootstrap: AppBootstrap,
  tabId: string,
): HunkSessionSnapshot {
  return {
    updatedAt: new Date().toISOString(),
    state: {
      activeTabId: tabId,
      tabs: [buildInitialReviewTabState(bootstrap, tabId)],
    },
  };
}
