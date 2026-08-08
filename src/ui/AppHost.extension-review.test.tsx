import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { removeTestDirectory } from "../../test/helpers/filesystem";
import { loadAppBootstrap } from "../core/loaders";
import { loadStartupExtensions } from "../extensions/startup";
import { AppHost } from "./AppHost";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await removeTestDirectory(dir);
  }
});

function createTempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Build one linear three-commit history whose adjacent diffs have distinct lines. */
function createHistoryRepo() {
  const repo = createTempDir("hunk-ext-review-range-");
  const file = join(repo, "history.txt");
  execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@test"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "test"], { cwd: repo });

  writeFileSync(file, "base\n");
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-m", "base"], { cwd: repo, stdio: "ignore" });

  writeFileSync(file, "base\nmiddle range\n");
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-m", "middle"], { cwd: repo, stdio: "ignore" });

  writeFileSync(file, "base\nmiddle range\nhead range\n");
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-m", "head"], { cwd: repo, stdio: "ignore" });
  return repo;
}

function readProbe(logPath: string) {
  try {
    return readFileSync(logPath, "utf8");
  } catch {
    return "";
  }
}

async function flush(setup: Awaited<ReturnType<typeof testRender>>) {
  await act(async () => {
    await setup.renderOnce();
    await Bun.sleep(0);
    await setup.renderOnce();
  });
}

async function flushUntil(
  setup: Awaited<ReturnType<typeof testRender>>,
  predicate: () => boolean,
  description: string,
  timeoutMs = 4_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}.`);
    }
    await flush(setup);
    await act(async () => {
      await Bun.sleep(20);
    });
  }
}

/** Launch a range review with one fixture command that requests another range. */
async function launchRangeExtension(repo: string, range: string, logPath: string) {
  const extPath = join(createTempDir("hunk-ext-review-range-fixture-"), "range.ts");
  writeFileSync(
    extPath,
    `import { appendFileSync } from "node:fs";\n` +
      `export default function (hunk) {\n` +
      `  hunk.registerCommand({ id: "range", title: "Range", key: "y" }, async (ctx) => {\n` +
      `    appendFileSync(${JSON.stringify(logPath)}, "state " + JSON.stringify(ctx.review.range) + "\\n");\n` +
      `    const history = await ctx.review.loadHistory();\n` +
      `    appendFileSync(${JSON.stringify(logPath)}, "history " + JSON.stringify(history) + "\\n");\n` +
      `    const result = await ctx.review.setRange(${JSON.stringify(range)});\n` +
      `    appendFileSync(${JSON.stringify(logPath)}, "result " + JSON.stringify(result) + "\\n");\n` +
      `  });\n` +
      `}\n`,
  );

  const bootstrap = await loadAppBootstrap(
    {
      kind: "vcs",
      range: "HEAD~1...HEAD",
      staged: false,
      options: { mode: "stack", extensionPaths: [extPath] },
    },
    { cwd: repo },
  );
  bootstrap.extensions = await loadStartupExtensions({
    extensions: { enabled: true, paths: [], repoPaths: [], extensionConfigs: {} },
    cwd: repo,
    cliExtensionPaths: [extPath],
  });
  expect(bootstrap.extensions.issues).toEqual([]);
  return bootstrap;
}

describe("extension review range controls", () => {
  test("a command replaces the current range through the normal soft reload", async () => {
    const repo = createHistoryRepo();
    const logPath = join(createTempDir("hunk-ext-review-range-log-"), "probe.log");
    const bootstrap = await launchRangeExtension(repo, "HEAD~2...HEAD~1", logPath);
    const setup = await testRender(<AppHost bootstrap={bootstrap} onQuit={() => {}} />, {
      width: 120,
      height: 24,
    });

    try {
      await flushUntil(
        setup,
        () => setup.captureCharFrame().includes("head range"),
        "the initial head range",
      );

      await act(async () => {
        await setup.mockInput.typeText("y");
      });
      await flushUntil(
        setup,
        () =>
          setup.captureCharFrame().includes("middle range") &&
          !setup.captureCharFrame().includes("head range") &&
          readProbe(logPath).includes('result {"ok":true}'),
        "the extension-requested middle range",
      );

      expect(readProbe(logPath)).toContain('state {"available":true,"value":"HEAD~1...HEAD"}');
      expect(readProbe(logPath)).toContain('history {"ok":true');
      expect(readProbe(logPath)).toContain('"subject":"head"');
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("an invalid ref resolves as a contained failed result", async () => {
    const repo = createHistoryRepo();
    const logPath = join(createTempDir("hunk-ext-review-range-failure-log-"), "probe.log");
    const bootstrap = await launchRangeExtension(repo, "missing-ref...HEAD", logPath);
    const setup = await testRender(<AppHost bootstrap={bootstrap} onQuit={() => {}} />, {
      width: 120,
      height: 24,
    });

    try {
      await flush(setup);
      await act(async () => {
        await setup.mockInput.typeText("y");
      });
      await flushUntil(
        setup,
        () => readProbe(logPath).includes('"reason":"failed"'),
        "the failed range result",
      );

      expect(readProbe(logPath)).toContain("missing-ref...HEAD");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });
});
