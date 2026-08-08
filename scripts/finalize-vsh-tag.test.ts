import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { finalizeVshTag } from "./finalize-vsh-tag";

const roots: string[] = [];

function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(Buffer.from(result.stderr).toString("utf8"));
  return Buffer.from(result.stdout).toString("utf8").trim();
}

function createRepos() {
  const root = mkdtempSync(path.join(tmpdir(), "hunk-vsh-tag-"));
  roots.push(root);
  const remote = path.join(root, "remote.git");
  const repo = path.join(root, "repo");
  git(root, "init", "--bare", remote);
  git(root, "init", "-b", "main", repo);
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.com");
  writeFileSync(
    path.join(repo, "package.json"),
    `${JSON.stringify({ name: "@victor-software-house/hunk", version: "0.18.0-beta.1" })}\n`,
  );
  git(repo, "add", "package.json");
  git(repo, "commit", "-m", "release");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-u", "origin", "main");
  return { repo, remote };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("finalizeVshTag", () => {
  test("creates and verifies the exact scoped package tag idempotently", async () => {
    const { repo, remote } = createRepos();
    const output = path.join(repo, "output.txt");

    const first = await finalizeVshTag({ repoRoot: repo, outputPath: output });
    const second = await finalizeVshTag({ repoRoot: repo, outputPath: output });

    expect(first).toEqual(second);
    expect(first.tag).toBe("@victor-software-house/hunk@0.18.0-beta.1");
    expect(git(remote, "rev-parse", `${first.tag}^{}`)).toBe(first.releaseSha);
    expect(readFileSync(output, "utf8").trim().split("\n")).toEqual([
      `tag=${first.tag}`,
      `tag=${first.tag}`,
    ]);
  });

  test("rejects a tag already attached to another commit", async () => {
    const { repo } = createRepos();
    const firstSha = git(repo, "rev-parse", "HEAD");
    git(repo, "tag", "-a", "@victor-software-house/hunk@0.18.0-beta.1", firstSha, "-m", "old");
    git(repo, "push", "origin", "refs/tags/@victor-software-house/hunk@0.18.0-beta.1");
    writeFileSync(path.join(repo, "next.txt"), "next\n");
    git(repo, "add", "next.txt");
    git(repo, "commit", "-m", "next");

    await expect(finalizeVshTag({ repoRoot: repo })).rejects.toThrow("not");
  });
});
