import { useEffect, useMemo } from "react";
import type { CliInput, DiffFile } from "../../core/types";
import { hunkLineRange } from "../../core/liveComments";
import { createHunkSessionBridge, type HunkSessionAppBridge } from "../../session/app/bridge";
import type {
  HunkReviewTabState,
  HunkSessionBrokerClient,
  ReloadedSessionResult,
  ReloadSessionOptions,
  SessionLiveCommentSummary,
  SessionReviewNoteSummary,
} from "../../session/types";
import type { ReviewController } from "./useReviewController";

export interface HunkSessionBinding {
  tabId: string;
  onBridge: (tabId: string, bridge: HunkSessionAppBridge | null) => void;
  onSnapshot: (state: HunkReviewTabState) => void;
}

/** Bridge one live Hunk review session to the local session daemon. */
export function useHunkSessionBridge({
  addLiveComment,
  addLiveCommentBatch,
  clearLiveComments,
  hostClient,
  liveCommentCount,
  liveCommentSummaries,
  navigateToLocation,
  noteMarkupWidth,
  openAgentNotes,
  reloadSession,
  removeLiveComment,
  reviewNoteCount,
  reviewNoteSummaries,
  selectedFile,
  selectedHunk,
  selectedHunkIndex,
  showAgentNotes,
  sessionBinding,
}: {
  addLiveComment: ReviewController["addLiveComment"];
  addLiveCommentBatch: ReviewController["addLiveCommentBatch"];
  clearLiveComments: ReviewController["clearLiveComments"];
  hostClient?: HunkSessionBrokerClient;
  liveCommentCount: number;
  liveCommentSummaries: SessionLiveCommentSummary[];
  navigateToLocation: ReviewController["navigateToLocation"];
  /** Width STML note markup currently renders at (see agentNoteMarkupWidth). */
  noteMarkupWidth?: number;
  openAgentNotes: () => void;
  reloadSession: (
    nextInput: CliInput,
    options?: ReloadSessionOptions,
  ) => Promise<ReloadedSessionResult>;
  removeLiveComment: ReviewController["removeLiveComment"];
  reviewNoteCount: number;
  reviewNoteSummaries: SessionReviewNoteSummary[];
  selectedFile: DiffFile | undefined;
  selectedHunk: DiffFile["metadata"]["hunks"][number] | undefined;
  selectedHunkIndex: number;
  showAgentNotes: boolean;
  sessionBinding?: HunkSessionBinding;
}) {
  const bridge = useMemo(
    () =>
      createHunkSessionBridge({
        addLiveComment,
        addLiveCommentBatch,
        clearLiveComments,
        navigateToLocation,
        openAgentNotes,
        reloadSession: (nextInput, options) => reloadSession(nextInput, { ...options }),
        removeLiveComment,
      }),
    [
      addLiveComment,
      addLiveCommentBatch,
      clearLiveComments,
      navigateToLocation,
      openAgentNotes,
      reloadSession,
      removeLiveComment,
    ],
  );

  useEffect(() => {
    if (sessionBinding) {
      sessionBinding.onBridge(sessionBinding.tabId, bridge);
      return () => sessionBinding.onBridge(sessionBinding.tabId, null);
    }
    if (!hostClient) {
      return;
    }

    hostClient.setBridge(bridge);

    return () => {
      hostClient.setBridge(null);
    };
  }, [bridge, hostClient, sessionBinding]);

  useEffect(() => {
    const selectedRange = selectedHunk ? hunkLineRange(selectedHunk) : undefined;
    const tabId = sessionBinding?.tabId ?? hostClient?.getRegistration().info.activeTabId;
    if (!tabId) return;
    const tabState: HunkReviewTabState = {
      tabId,
      selectedFileId: selectedFile?.id,
      selectedFilePath: selectedFile?.path,
      selectedHunkIndex,
      selectedHunkOldRange: selectedRange?.oldRange,
      selectedHunkNewRange: selectedRange?.newRange,
      showAgentNotes,
      noteMarkupWidth,
      liveCommentCount,
      liveComments: liveCommentSummaries,
      reviewNoteCount,
      reviewNotes: reviewNoteSummaries,
    };

    if (sessionBinding) {
      sessionBinding.onSnapshot(tabState);
      return;
    }
    hostClient?.updateSnapshot({
      updatedAt: new Date().toISOString(),
      state: { activeTabId: tabId, tabs: [tabState] },
    });
  }, [
    hostClient,
    liveCommentCount,
    liveCommentSummaries,
    noteMarkupWidth,
    reviewNoteCount,
    reviewNoteSummaries,
    selectedFile?.id,
    selectedFile?.path,
    selectedHunk,
    selectedHunkIndex,
    showAgentNotes,
    sessionBinding,
  ]);
}
