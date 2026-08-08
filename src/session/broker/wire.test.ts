import { describe, expect, test } from "bun:test";
import {
  MAX_REGISTRATION_FILES,
  MAX_REGISTRATION_HUNKS_PER_FILE,
  MAX_REGISTRATION_PATCH_BYTES,
  MAX_SNAPSHOT_LIVE_COMMENTS,
  MAX_SNAPSHOT_REVIEW_NOTES,
  SESSION_BROKER_REGISTRATION_VERSION,
} from "@hunk/session-broker-core";
import type { CliInput } from "../../core/types";
import { parseSessionRegistration, parseSessionSnapshot } from "./wire";

const TAB_ID = "tab-1";

function createRegistration(files: unknown[], tabOverrides: Record<string, unknown> = {}) {
  return {
    registrationVersion: SESSION_BROKER_REGISTRATION_VERSION,
    sessionId: "session-1",
    pid: 123,
    cwd: "/repo",
    launchedAt: "2026-03-22T00:00:00.000Z",
    info: {
      activeTabId: TAB_ID,
      tabs: [
        {
          tabId: TAB_ID,
          name: "repo",
          cwd: "/repo",
          repoRoot: "/repo",
          input: { kind: "vcs", staged: false, options: {} },
          inputKind: "vcs",
          title: "repo working tree",
          sourceLabel: "/repo",
          files,
          ...tabOverrides,
        },
      ],
    },
  };
}

function createSnapshotState(tabOverrides: Record<string, unknown> = {}) {
  return {
    activeTabId: TAB_ID,
    tabs: [
      {
        tabId: TAB_ID,
        selectedHunkIndex: 0,
        showAgentNotes: true,
        liveComments: [],
        ...tabOverrides,
      },
    ],
  };
}

function createFile(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-1",
    path: "src/example.ts",
    additions: 1,
    deletions: 0,
    hunks: [{ index: 0, header: "@@ -1 +1 @@" }],
    ...overrides,
  };
}

function createValidComment(overrides: Record<string, unknown> = {}) {
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

describe("hunk session wire parsing", () => {
  test("snapshot comment counts only include validated comment summaries", () => {
    const snapshot = parseSessionSnapshot({
      updatedAt: "2026-03-22T00:00:00.000Z",
      state: createSnapshotState({
        selectedFileId: "file-1",
        selectedFilePath: "src/example.ts",
        liveCommentCount: 5,
        liveComments: [
          createValidComment(),
          { filePath: "src/example.ts", summary: "Missing comment id and line." },
        ],
      }),
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.state.tabs[0]?.liveComments).toHaveLength(1);
    expect(snapshot?.state.tabs[0]?.liveCommentCount).toBe(1);
  });

  test("snapshot carries each tab's live note markup width and drops invalid values", () => {
    const parse = (noteMarkupWidth: unknown) =>
      parseSessionSnapshot({
        updatedAt: "2026-03-22T00:00:00.000Z",
        state: createSnapshotState({ noteMarkupWidth }),
      });

    expect(parse(112)?.state.tabs[0]?.noteMarkupWidth).toBe(112);
    expect(parse("wide")?.state.tabs[0]?.noteMarkupWidth).toBeUndefined();
    expect(parse(undefined)?.state.tabs[0]?.noteMarkupWidth).toBeUndefined();
  });

  test("registration parses the ordered tab hierarchy", () => {
    const registration = parseSessionRegistration(createRegistration([]));

    expect(registration?.info).toEqual({
      activeTabId: TAB_ID,
      tabs: [
        {
          tabId: TAB_ID,
          name: "repo",
          cwd: "/repo",
          repoRoot: "/repo",
          input: { kind: "vcs", staged: false, options: {} },
          inputKind: "vcs",
          title: "repo working tree",
          sourceLabel: "/repo",
          experimentalFeatures: [],
          files: [],
        },
      ],
    });
  });

  test("registration preserves the exact validated reload input", () => {
    const input: CliInput = {
      kind: "vcs",
      range: "main...HEAD",
      staged: false,
      pathspecs: ["src", "README.md"],
      options: {
        mode: "stack",
        cursorLine: "number",
        vcs: "git",
        theme: "paper",
        agentContext: ".hunk/context.json",
        pager: false,
        watch: true,
        experimental: true,
        excludeUntracked: true,
        lineNumbers: true,
        tabWidth: 4,
        wrapLines: false,
        hunkHeaders: true,
        menuBar: false,
        agentNotes: true,
        copyDecorations: false,
        promptSaveViewPreferences: true,
        transparentBackground: false,
        colorMoved: true,
        extensions: true,
        extensionPaths: ["./extension.ts"],
      },
    };
    const registration = parseSessionRegistration(
      createRegistration([], { input, inputKind: "vcs" }),
    );

    expect(registration?.info.tabs[0]?.input).toEqual(input);
  });

  test.each([
    ["unknown input field", { input: { kind: "vcs", staged: false, options: {}, extra: true } }],
    ["unknown option", { input: { kind: "vcs", staged: false, options: { extra: true } } }],
    [
      "missing required field",
      { input: { kind: "diff", left: "before.ts", options: {} }, inputKind: "diff" },
    ],
    [
      "mixed pathspec list",
      { input: { kind: "show", pathspecs: ["src", 1], options: {} }, inputKind: "show" },
    ],
    ["mismatched input kind", { input: { kind: "show", options: {} }, inputKind: "vcs" }],
  ])("rejects %s in a registered reload input", (_label, overrides) => {
    expect(parseSessionRegistration(createRegistration([], overrides))).toBeNull();
  });

  test("registration preserves only recognized experimental feature ids per tab", () => {
    const registration = parseSessionRegistration(
      createRegistration([], { experimentalFeatures: ["stml", "future-feature", "stml", 42] }),
    );

    expect(registration?.info.tabs[0]?.experimentalFeatures).toEqual(["stml"]);
  });

  test("rejects registration and snapshot hierarchies without their active tab", () => {
    const registration = createRegistration([]);
    registration.info.activeTabId = "missing";
    expect(parseSessionRegistration(registration)).toBeNull();

    const state = createSnapshotState();
    state.activeTabId = "missing";
    expect(parseSessionSnapshot({ updatedAt: "2026-03-22T00:00:00.000Z", state })).toBeNull();
  });

  test("rejects duplicate tab ids and normalized names", () => {
    const registration = createRegistration([]);
    const first = registration.info.tabs[0]!;
    registration.info.tabs.push({ ...first });
    expect(parseSessionRegistration(registration)).toBeNull();

    registration.info.tabs[1] = { ...first, tabId: "tab-2", name: " repo " };
    expect(parseSessionRegistration(registration)).toBeNull();
  });

  test("rejects registrations with more files than the per-tab cap", () => {
    const files = Array.from({ length: MAX_REGISTRATION_FILES + 1 }, (_, index) =>
      createFile({ id: `file-${index}`, path: `src/file-${index}.ts` }),
    );

    expect(parseSessionRegistration(createRegistration(files))).toBeNull();
  });

  test("rejects files with more hunks than the per-file cap", () => {
    const hunks = Array.from({ length: MAX_REGISTRATION_HUNKS_PER_FILE + 1 }, (_, index) => ({
      index,
      header: `@@ hunk ${index} @@`,
    }));

    expect(parseSessionRegistration(createRegistration([createFile({ hunks })]))).toBeNull();
  });

  test("rejects files whose patch exceeds the byte cap", () => {
    const patch = "x".repeat(MAX_REGISTRATION_PATCH_BYTES + 1);
    expect(parseSessionRegistration(createRegistration([createFile({ patch })]))).toBeNull();
  });

  test("rejects one tab with more live comments than the cap", () => {
    const liveComments = Array.from({ length: MAX_SNAPSHOT_LIVE_COMMENTS + 1 }, (_, index) =>
      createValidComment({ commentId: `comment-${index}` }),
    );
    const snapshot = parseSessionSnapshot({
      updatedAt: "2026-03-22T00:00:00.000Z",
      state: createSnapshotState({ liveComments }),
    });
    expect(snapshot).toBeNull();
  });

  test("rejects one tab with more review notes than the cap", () => {
    const reviewNotes = Array.from({ length: MAX_SNAPSHOT_REVIEW_NOTES + 1 }, (_, index) => ({
      noteId: `note-${index}`,
      source: "user",
      filePath: "src/example.ts",
      body: "Looks good",
      createdAt: "2026-03-22T00:00:00.000Z",
    }));
    const snapshot = parseSessionSnapshot({
      updatedAt: "2026-03-22T00:00:00.000Z",
      state: createSnapshotState({ reviewNotes }),
    });
    expect(snapshot).toBeNull();
  });
});
