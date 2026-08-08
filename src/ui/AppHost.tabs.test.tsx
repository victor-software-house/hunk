import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { createTestVcsAppBootstrap } from "../../test/helpers/app-bootstrap";
import { createTestDiffFile } from "../../test/helpers/diff-helpers";
import {
  createInitialSessionSnapshot,
  createSessionRegistration,
} from "../session/app/registration";
import { loadStartupExtensions } from "../extensions/startup";
import type {
  HunkSessionBrokerClient,
  HunkSessionRegistration,
  HunkSessionServerMessage,
  HunkSessionSnapshot,
} from "../session/types";
import { AppHost } from "./AppHost";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function createBootstrap() {
  return createTestVcsAppBootstrap({
    sourceLabel: "/repo-one",
    title: "repo-one working tree",
    files: [
      createTestDiffFile({
        id: "one",
        path: "one.ts",
        before: "export const one = 1;\n",
        after: "export const one = 2;\n",
      }),
    ],
  });
}

function createHostClient(bootstrap: ReturnType<typeof createBootstrap>) {
  let registration = createSessionRegistration(bootstrap);
  let snapshot = createInitialSessionSnapshot(bootstrap, registration.info.activeTabId);
  let bridge: { dispatchCommand(message: HunkSessionServerMessage): Promise<unknown> } | null =
    null;

  const hostClient = {
    getRegistration: () => registration,
    replaceSession: (
      nextRegistration: HunkSessionRegistration,
      nextSnapshot: HunkSessionSnapshot,
    ) => {
      registration = nextRegistration;
      snapshot = nextSnapshot;
    },
    updateSnapshot: (nextSnapshot: HunkSessionSnapshot) => {
      snapshot = nextSnapshot;
    },
    setBridge: (nextBridge: typeof bridge) => {
      bridge = nextBridge;
    },
  } as unknown as HunkSessionBrokerClient;

  return {
    hostClient,
    dispatch: async (message: HunkSessionServerMessage) => {
      if (!bridge) throw new Error("AppHost did not register its process bridge.");
      return bridge.dispatchCommand(message);
    },
    registration: () => registration,
    snapshot: () => snapshot,
  };
}

async function flush(setup: Awaited<ReturnType<typeof testRender>>) {
  await act(async () => {
    await setup.renderOnce();
    await Bun.sleep(20);
    await setup.renderOnce();
  });
}

describe("AppHost review tabs", () => {
  test("agent commands add, select, rename, and close independently registered reviews", async () => {
    const source = mkdtempSync(join(tmpdir(), "hunk-review-tab-"));
    tempDirs.push(source);
    const before = join(source, "before.ts");
    const after = join(source, "after.ts");
    writeFileSync(before, "export const two = 1;\n");
    writeFileSync(after, "export const two = 2;\n");

    const bootstrap = createBootstrap();
    const client = createHostClient(bootstrap);
    const initialTabId = client.registration().info.activeTabId;
    const setup = await testRender(
      <AppHost bootstrap={bootstrap} hostClient={client.hostClient} onQuit={() => undefined} />,
      { width: 120, height: 24 },
    );

    try {
      await flush(setup);
      await act(async () => setup.mockInput.pressTab());
      await act(async () => setup.mockInput.typeText("one"));
      await flush(setup);
      expect(setup.captureCharFrame()).toContain("filter: one");

      let added!: { tab: { tabId: string } };
      await act(async () => {
        added = (await client.dispatch({
          type: "command",
          requestId: "add",
          command: "add_review_tab",
          input: {
            sessionId: client.registration().sessionId,
            name: "second project",
            sourcePath: source,
            input: { kind: "diff", left: before, right: after, options: {} },
          },
        })) as typeof added;
      });
      await flush(setup);

      expect(client.registration().info.activeTabId).toBe(added.tab.tabId);
      expect(client.registration().info.tabs.map((tab) => tab.name)).toEqual([
        "repo-one",
        "second project",
      ]);
      expect(client.snapshot().state.tabs).toHaveLength(2);
      expect(setup.captureCharFrame()).toContain("second project");

      await act(async () => {
        await client.dispatch({
          type: "command",
          requestId: "select",
          command: "select_review_tab",
          input: { sessionId: client.registration().sessionId, tab: "repo-one" },
        });
      });
      await flush(setup);
      expect(client.registration().info.activeTabId).toBe(initialTabId);
      expect(setup.captureCharFrame()).toContain("filter: one");

      await act(async () => {
        await client.dispatch({
          type: "command",
          requestId: "rename",
          command: "rename_review_tab",
          input: {
            sessionId: client.registration().sessionId,
            tab: added.tab.tabId,
            name: "backend",
          },
        });
      });
      expect(client.registration().info.tabs[1]?.name).toBe("backend");

      await act(async () => {
        await client.dispatch({
          type: "command",
          requestId: "close",
          command: "close_review_tab",
          input: { sessionId: client.registration().sessionId, tab: "backend" },
        });
      });
      await flush(setup);
      expect(client.registration().info.tabs.map((tab) => tab.tabId)).toEqual([initialTabId]);
      expect(client.snapshot().state.tabs.map((tab) => tab.tabId)).toEqual([initialTabId]);
    } finally {
      await act(async () => setup.renderer.destroy());
    }
  }, 15_000);

  test("process quit shuts down extensions in every mounted review tab", async () => {
    const source = mkdtempSync(join(tmpdir(), "hunk-review-tab-shutdown-"));
    tempDirs.push(source);
    const before = join(source, "before.ts");
    const after = join(source, "after.ts");
    const extensionPath = join(source, "shutdown.ts");
    const shutdownLog = join(source, "shutdown.log");
    writeFileSync(before, "export const two = 1;\n");
    writeFileSync(after, "export const two = 2;\n");
    writeFileSync(
      extensionPath,
      `import { appendFileSync } from "node:fs";\n` +
        `export default function (hunk) {\n` +
        `  hunk.on("shutdown", () => appendFileSync(${JSON.stringify(shutdownLog)}, "shutdown\\n"));\n` +
        `}\n`,
    );

    const bootstrap = createBootstrap();
    bootstrap.input.options.extensions = true;
    bootstrap.input.options.extensionPaths = [extensionPath];
    bootstrap.extensions = await loadStartupExtensions({
      extensions: { enabled: true, paths: [], repoPaths: [], extensionConfigs: {} },
      cwd: source,
      cliExtensionPaths: [extensionPath],
    });
    let quit = false;
    const client = createHostClient(bootstrap);
    const setup = await testRender(
      <AppHost
        bootstrap={bootstrap}
        hostClient={client.hostClient}
        onQuit={() => {
          quit = true;
        }}
      />,
      { width: 120, height: 24 },
    );

    try {
      await flush(setup);
      await act(async () => {
        await client.dispatch({
          type: "command",
          requestId: "add",
          command: "add_review_tab",
          input: {
            sessionId: client.registration().sessionId,
            name: "second project",
            sourcePath: source,
            input: { kind: "diff", left: before, right: after, options: {} },
          },
        });
      });
      await flush(setup);

      await act(async () => setup.mockInput.typeText("q"));
      for (let attempt = 0; attempt < 20 && !quit; attempt += 1) {
        await flush(setup);
      }

      expect(quit).toBe(true);
      expect(readFileSync(shutdownLog, "utf8").trim().split("\n")).toEqual([
        "shutdown",
        "shutdown",
      ]);
    } finally {
      await act(async () => setup.renderer.destroy());
    }
  });

  test("Ctrl-T creates a named working-tree tab from the entered project", async () => {
    const source = mkdtempSync(join(tmpdir(), "hunk-review-tab-form-"));
    tempDirs.push(source);
    Bun.spawnSync(["git", "init", source], { stdout: "ignore", stderr: "ignore" });
    const file = join(source, "project.ts");
    writeFileSync(file, "export const value = 1;\n");
    Bun.spawnSync(["git", "-C", source, "add", "project.ts"]);
    Bun.spawnSync([
      "git",
      "-C",
      source,
      "-c",
      "user.name=Hunk Test",
      "-c",
      "user.email=hunk@example.invalid",
      "commit",
      "-m",
      "baseline",
    ]);
    writeFileSync(file, "export const value = 2;\n");

    const bootstrap = createBootstrap();
    const setup = await testRender(<AppHost bootstrap={bootstrap} onQuit={() => undefined} />, {
      width: 120,
      height: 24,
    });

    try {
      await flush(setup);
      const initialRows = setup.captureCharFrame().split("\n");
      expect(initialRows[0]).toContain("File");
      expect(initialRows[0]).toContain("View");
      expect(initialRows[1]).toContain("● repo-one");

      await act(async () => setup.mockInput.pressKey("\x14"));
      await flush(setup);
      let frame = setup.captureCharFrame();
      expect(frame).toContain("New review tab");
      expect(frame).toContain("Project");
      expect(frame).toContain("Range");

      await act(async () => setup.mockInput.typeText("worktree"));
      await act(async () => setup.mockInput.pressTab());
      await flush(setup);
      await act(async () => setup.mockInput.typeText(source));
      await act(async () => setup.mockInput.pressTab());
      await flush(setup);
      await act(async () => setup.mockInput.pressEnter());
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await flush(setup);
        frame = setup.captureCharFrame();
        if (!frame.includes("New review tab") && frame.includes("worktree")) break;
      }
      expect(frame).not.toContain("New review tab");
      expect(frame).toContain("● worktree");
      expect(frame).toContain("project.ts");
    } finally {
      await act(async () => setup.renderer.destroy());
    }
  });
});
