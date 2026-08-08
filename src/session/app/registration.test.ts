import { describe, expect, test } from "bun:test";
import { SESSION_BROKER_REGISTRATION_VERSION } from "@hunk/session-broker-core";
import { createTestDiffFile } from "../../../test/helpers/diff-helpers";
import type { AppBootstrap } from "../../core/types";
import {
  createInitialSessionSnapshot,
  createSessionRegistration,
  updateSessionRegistration,
} from "./registration";

function createBootstrap(overrides: Partial<AppBootstrap> = {}): AppBootstrap {
  const file = createTestDiffFile({
    id: "file-1",
    path: "src/example.ts",
    previousPath: "src/old-example.ts",
    before: "export const value = 1;\n",
    after: "export const value = 2;\n",
  });

  return {
    input: { kind: "vcs", staged: false, options: {} },
    changeset: {
      id: "changeset-1",
      title: "working tree",
      sourceLabel: "/repo",
      files: [
        {
          ...file,
          patch: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
        },
      ],
    },
    initialMode: "split",
    initialShowAgentNotes: true,
    ...overrides,
    reloadContext: overrides.reloadContext ?? { cwd: "/repo" },
  };
}

function activeRegistrationTab(registration: ReturnType<typeof createSessionRegistration>) {
  return registration.info.tabs.find((tab) => tab.tabId === registration.info.activeTabId)!;
}

function createSnapshot(bootstrap: AppBootstrap) {
  const registration = createSessionRegistration(bootstrap);
  return createInitialSessionSnapshot(bootstrap, registration.info.activeTabId);
}

describe("session registration", () => {
  // Intent: registration preserves daemon-facing repo, file, patch, and hunk metadata.
  test("createSessionRegistration exports one review tab with hunks and repo-root selection", () => {
    const registration = createSessionRegistration(createBootstrap());
    const tab = activeRegistrationTab(registration);

    expect(registration).toMatchObject({
      registrationVersion: SESSION_BROKER_REGISTRATION_VERSION,
      pid: process.pid,
      cwd: process.cwd(),
      info: { activeTabId: tab.tabId, tabs: [{ tabId: tab.tabId }] },
    });
    expect(registration.sessionId).toBeString();
    expect(registration.launchedAt).toBeString();
    expect(tab).toMatchObject({
      name: "repo",
      cwd: "/repo",
      repoRoot: "/repo",
      inputKind: "vcs",
      title: "working tree",
      sourceLabel: "/repo",
      experimentalFeatures: [],
      files: [
        {
          id: "file-1",
          path: "src/example.ts",
          previousPath: "src/old-example.ts",
          additions: 1,
          deletions: 1,
          hunkCount: 1,
          patch: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
        },
      ],
    });
    expect(tab.files[0]?.hunks[0]).toMatchObject({
      index: 0,
      oldRange: [1, 1],
      newRange: [1, 1],
    });
  });

  test("registration and initial selection preserve exact Unicode rename paths", () => {
    const bootstrap = createBootstrap();
    const file = bootstrap.changeset.files[0]!;
    bootstrap.changeset.files = [
      { ...file, path: "国際化/한국어-🧪.txt", previousPath: "国際化/日本語.txt" },
    ];

    const registration = createSessionRegistration(bootstrap);
    const snapshot = createInitialSessionSnapshot(bootstrap, registration.info.activeTabId);

    expect(activeRegistrationTab(registration).files[0]).toMatchObject({
      path: "国際化/한국어-🧪.txt",
      previousPath: "国際化/日本語.txt",
    });
    expect(snapshot.state.tabs[0]?.selectedFilePath).toBe("国際化/한국어-🧪.txt");
  });

  // Intent: reloads refresh only the active tab while preserving process and tab identity.
  test("updateSessionRegistration preserves identity while refreshing active-tab metadata", () => {
    const current = createSessionRegistration(createBootstrap());
    const currentTab = activeRegistrationTab(current);
    const nextBootstrap = createBootstrap({
      input: { kind: "patch", file: "change.patch", options: {} },
      changeset: {
        id: "changeset-2",
        title: "patch file",
        sourceLabel: "change.patch",
        files: [],
      },
    });

    const updated = updateSessionRegistration(current, nextBootstrap);
    const updatedTab = activeRegistrationTab(updated);

    expect(updated.sessionId).toBe(current.sessionId);
    expect(updated.pid).toBe(current.pid);
    expect(updated.info.activeTabId).toBe(current.info.activeTabId);
    expect(updatedTab).toEqual({
      tabId: currentTab.tabId,
      name: currentTab.name,
      cwd: "/repo",
      repoRoot: undefined,
      input: { kind: "patch", file: "change.patch", options: {} },
      inputKind: "patch",
      title: "patch file",
      sourceLabel: "change.patch",
      experimentalFeatures: [],
      files: [],
    });
  });

  test("registration advertises STML only on its opted-in tab", () => {
    const registration = createSessionRegistration(
      createBootstrap({
        input: { kind: "vcs", staged: false, options: { experimental: true } },
      }),
    );

    expect(activeRegistrationTab(registration).experimentalFeatures).toEqual(["stml"]);
  });

  // Intent: initial snapshots expose first-hunk focus and configured note visibility.
  test("createInitialSessionSnapshot starts with the first hunk and note visibility", () => {
    const snapshot = createSnapshot(createBootstrap());

    expect(snapshot.state.tabs).toHaveLength(1);
    expect(snapshot.state.tabs[0]).toMatchObject({
      tabId: snapshot.state.activeTabId,
      selectedFileId: "file-1",
      selectedFilePath: "src/example.ts",
      selectedHunkIndex: 0,
      selectedHunkOldRange: [1, 1],
      selectedHunkNewRange: [1, 1],
      showAgentNotes: true,
      liveCommentCount: 0,
      liveComments: [],
      reviewNoteCount: 0,
      reviewNotes: [],
    });
  });

  // Intent: empty reviews still publish a valid, explicit tab snapshot.
  test("createInitialSessionSnapshot handles empty changesets", () => {
    const snapshot = createSnapshot(
      createBootstrap({
        changeset: {
          id: "empty",
          title: "empty",
          sourceLabel: "/repo",
          files: [],
        },
        initialShowAgentNotes: false,
      }),
    );

    expect(snapshot.state.tabs).toEqual([
      {
        tabId: snapshot.state.activeTabId,
        selectedFileId: undefined,
        selectedFilePath: undefined,
        selectedHunkIndex: 0,
        selectedHunkOldRange: undefined,
        selectedHunkNewRange: undefined,
        showAgentNotes: false,
        liveCommentCount: 0,
        liveComments: [],
        reviewNoteCount: 0,
        reviewNotes: [],
      },
    ]);
  });
});
