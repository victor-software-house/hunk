import {
  buildHunkSessionReview,
  buildListedHunkSession,
  buildSelectedHunkSessionContext,
  listHunkSessionComments,
} from "./projections";
import type {
  HunkSessionCommandResult,
  HunkSessionInfo,
  HunkSessionServerMessage,
  HunkSessionState,
  ListedSession,
  SelectedSessionContext,
  SessionLiveCommentSummary,
  SessionReview,
} from "../types";
import { parseSessionRegistration, parseSessionSnapshot } from "./wire";
import { SessionBrokerState, type SessionBrokerViewAdapter } from "@hunk/session-broker-core";

const hunkSessionBrokerView: SessionBrokerViewAdapter<
  HunkSessionInfo,
  HunkSessionState,
  ListedSession,
  SelectedSessionContext,
  SessionReview,
  SessionLiveCommentSummary
> = {
  parseRegistration: parseSessionRegistration,
  parseSnapshot: parseSessionSnapshot,
  matchesSession: (session, selector) => {
    if (selector.sessionId) return session.sessionId === selector.sessionId;
    if (selector.sessionPath) return session.cwd === selector.sessionPath;
    if (!selector.repoRoot) return true;
    const active = session.tabs.find((tab) => tab.tabId === session.activeTabId);
    return active?.repoRoot === selector.repoRoot;
  },
  describeSession: (session) => {
    const active = session.tabs.find((tab) => tab.tabId === session.activeTabId);
    return `${session.sessionId} (${active?.name ?? session.activeTabId})`;
  },
  buildListedSession: buildListedHunkSession,
  buildSelectedContext: buildSelectedHunkSessionContext,
  buildSessionReview: buildHunkSessionReview,
  listComments: listHunkSessionComments,
};

export type HunkSessionBrokerState = SessionBrokerState<
  HunkSessionInfo,
  HunkSessionState,
  HunkSessionServerMessage,
  HunkSessionCommandResult,
  ListedSession,
  SelectedSessionContext,
  SessionReview,
  SessionLiveCommentSummary
>;

/** Wire the generic broker core to Hunk's registration, snapshot, and review projections. */
export function createHunkSessionBrokerState(): HunkSessionBrokerState {
  return new SessionBrokerState(hunkSessionBrokerView);
}
