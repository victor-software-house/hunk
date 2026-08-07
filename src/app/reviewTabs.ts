import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { AppBootstrap } from "../core/types";
import { sanitizeTerminalLine } from "../lib/terminalText";

export const MAX_REVIEW_TAB_NAME_CODE_POINTS = 48;

export interface ReviewTab {
  tabId: string;
  name: string;
  cwd: string;
  bootstrap: AppBootstrap;
}

export interface ReviewTabsState {
  activeTabId: string;
  tabs: readonly ReviewTab[];
}

export interface NewReviewTab {
  name: string;
  cwd: string;
  bootstrap: AppBootstrap;
  tabId?: string;
}

/** Normalize one user- or agent-authored tab name into its stored identity label. */
export function normalizeReviewTabName(name: unknown): string {
  if (typeof name !== "string") {
    throw new Error("Review tab name must be a string.");
  }

  const normalized = sanitizeTerminalLine(name.replaceAll(/\s+/gu, " ")).trim();
  if (normalized.length === 0) {
    throw new Error("Review tab name must not be empty.");
  }
  if ([...normalized].length > MAX_REVIEW_TAB_NAME_CODE_POINTS) {
    throw new Error(
      `Review tab name must be at most ${MAX_REVIEW_TAB_NAME_CODE_POINTS} Unicode code points.`,
    );
  }
  return normalized;
}

/** Derive the initial tab's concise project label from the loaded review root. */
export function defaultReviewTabName(bootstrap: AppBootstrap): string {
  const source = bootstrap.reloadContext.repoRoot ?? bootstrap.changeset.sourceLabel;
  return normalizeReviewTabName(basename(source) || bootstrap.changeset.title);
}

/** Build the first tab in one Hunk process. */
export function createReviewTabsState(tab: NewReviewTab): ReviewTabsState {
  const created = materializeReviewTab(tab);
  return { activeTabId: created.tabId, tabs: [created] };
}

/** Add and activate one uniquely named review tab. */
export function addReviewTab(state: ReviewTabsState, tab: NewReviewTab): ReviewTabsState {
  const created = materializeReviewTab(tab);
  assertUniqueName(state.tabs, created.name);
  if (state.tabs.some((candidate) => candidate.tabId === created.tabId)) {
    throw new Error(`Review tab id already exists: ${created.tabId}`);
  }
  return { activeTabId: created.tabId, tabs: [...state.tabs, created] };
}

/** Select one existing tab by stable id. */
export function selectReviewTab(state: ReviewTabsState, tabId: string): ReviewTabsState {
  assertTab(state, tabId);
  return state.activeTabId === tabId ? state : { ...state, activeTabId: tabId };
}

/** Rename one tab without changing identity or order. */
export function renameReviewTab(
  state: ReviewTabsState,
  tabId: string,
  requestedName: string,
): ReviewTabsState {
  assertTab(state, tabId);
  const name = normalizeReviewTabName(requestedName);
  assertUniqueName(state.tabs, name, tabId);
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.tabId === tabId ? { ...tab, name } : tab)),
  };
}

/** Close one tab and select its right neighbor, then its left neighbor. */
export function closeReviewTab(state: ReviewTabsState, tabId: string): ReviewTabsState {
  const index = state.tabs.findIndex((tab) => tab.tabId === tabId);
  if (index < 0) throw new Error(`Unknown review tab id: ${tabId}`);
  if (state.tabs.length === 1) {
    throw new Error("A Hunk process must keep at least one review tab open.");
  }

  const tabs = state.tabs.filter((tab) => tab.tabId !== tabId);
  if (state.activeTabId !== tabId) return { ...state, tabs };
  const active = tabs[index] ?? tabs[index - 1];
  if (!active) throw new Error("Closing the active review tab left no fallback.");
  return { activeTabId: active.tabId, tabs };
}

/** Replace one tab's loaded review while retaining its identity and local state slot. */
export function replaceReviewTabBootstrap(
  state: ReviewTabsState,
  tabId: string,
  bootstrap: AppBootstrap,
  cwd: string,
): ReviewTabsState {
  assertTab(state, tabId);
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.tabId === tabId ? { ...tab, bootstrap, cwd } : tab)),
  };
}

function materializeReviewTab(tab: NewReviewTab): ReviewTab {
  return {
    tabId: tab.tabId ?? randomUUID(),
    name: normalizeReviewTabName(tab.name),
    cwd: tab.cwd,
    bootstrap: tab.bootstrap,
  };
}

function assertTab(state: ReviewTabsState, tabId: string): void {
  if (!state.tabs.some((tab) => tab.tabId === tabId)) {
    throw new Error(`Unknown review tab id: ${tabId}`);
  }
}

function assertUniqueName(tabs: readonly ReviewTab[], name: string, exceptTabId?: string): void {
  if (tabs.some((tab) => tab.tabId !== exceptTabId && tab.name === name)) {
    throw new Error(`Review tab name already exists: ${name}`);
  }
}
