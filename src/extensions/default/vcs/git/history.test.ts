import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { removeTestDirectory } from "../../../../../test/helpers/filesystem";
import { loadGitReviewHistory } from "./history";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await removeTestDirectory(dir);
  }
});

function createHistoryRepo() {
  const repo = mkdtempSync(join(tmpdir(), "hunk-git-history-"));
  tempDirs.push(repo);
  execFileSync("git", ["init", "-b", "main"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@test"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "test"], { cwd: repo });

  const file = join(repo, "history.txt");
  writeFileSync(file, "first\n");
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-m", "first subject"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["tag", "v1"], { cwd: repo });

  writeFileSync(file, "first\nsecond\n");
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-m", "second subject"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["branch", "feature/history"], { cwd: repo });
  execFileSync("git", ["remote", "add", "origin", repo], { cwd: repo });
  execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], { cwd: repo });
  execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], {
    cwd: repo,
  });
  return repo;
}

describe("Git review history", () => {
  test("returns bounded commits and selectable branch, remote, and tag refs", async () => {
    const repo = createHistoryRepo();
    const history = await loadGitReviewHistory({ cwd: repo });

    expect(history.commits.map((commit) => commit.subject)).toEqual([
      "second subject",
      "first subject",
    ]);
    const [head, base] = history.commits;
    if (!head || !base) throw new Error("Expected two history commits.");
    expect(head.parentIds).toEqual([base.id]);
    expect(history.commits.every((commit) => !Number.isNaN(Date.parse(commit.committedAt)))).toBe(
      true,
    );

    expect(history.refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "main", kind: "branch", current: true }),
        expect.objectContaining({ name: "feature/history", kind: "branch" }),
        expect.objectContaining({ name: "origin/main", kind: "remote" }),
        expect.objectContaining({ name: "v1", kind: "tag" }),
      ]),
    );
    expect(history.refs.some((ref) => ref.name === "origin/HEAD")).toBe(false);
  });
});
