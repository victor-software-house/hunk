import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { preparePublishedSmokeWorkspace } from "./smoke-published-package";

describe("published-package smoke workspace", () => {
  test("initializes the project and scoped registry before querying packages", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "hunk-published-workspace-test-"));

    try {
      const workspace = await preparePublishedSmokeWorkspace(root);
      const manifest = await Bun.file(path.join(root, "package.json")).json();
      const bunfig = await Bun.file(workspace.bunfig).text();

      expect(manifest).toEqual({
        name: "hunk-published-smoke",
        private: true,
        version: "0.0.0",
      });
      expect(bunfig).toContain('"@victor-software-house"');
      expect(existsSync(workspace.bunInstall)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
