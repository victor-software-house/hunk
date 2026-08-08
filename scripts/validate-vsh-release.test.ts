import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cleanGitEnv } from "./git-env";
import { validateVshRelease } from "./validate-vsh-release";

const roots: string[] = [];

function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: cleanGitEnv(),
  });
  if (result.exitCode !== 0) throw new Error(Buffer.from(result.stderr).toString("utf8"));
}

function createReleaseRepo(changelogBody = "- Scoped release.\n") {
  const root = mkdtempSync(path.join(tmpdir(), "hunk-release-validate-"));
  roots.push(root);
  const remote = path.join(root, "remote.git");
  const repo = path.join(root, "repo");
  mkdirSync(repo);
  git(root, "init", "--bare", remote);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.com");
  writeFileSync(
    path.join(repo, "package.json"),
    `${JSON.stringify({
      name: "@victor-software-house/hunk",
      version: "0.18.0-beta.0",
      repository: { url: "git+https://github.com/victor-software-house/hunk.git" },
      publishConfig: { registry: "https://npm.pkg.github.com", access: "restricted" },
    })}\n`,
  );
  writeFileSync(path.join(repo, "CHANGELOG.md"), "# Changelog\n\n## 0.18.0-beta.0\n\n- Old.\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "baseline");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-u", "origin", "main");

  const manifest = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8"));
  manifest.version = "0.18.0-beta.1";
  writeFileSync(path.join(repo, "package.json"), `${JSON.stringify(manifest)}\n`);
  writeFileSync(
    path.join(repo, "CHANGELOG.md"),
    `# Changelog\n\n## 0.18.0-beta.1\n\n${changelogBody}\n## 0.18.0-beta.0\n\n- Old.\n`,
  );
  git(repo, "add", ".");
  git(repo, "commit", "-m", "chore(release): version packages");
  git(repo, "push", "origin", "main");
  return repo;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("validateVshRelease", () => {
  test("accepts a scoped Version Packages commit on main", async () => {
    const repo = createReleaseRepo();
    await expect(
      validateVshRelease({ repoRoot: repo, eventName: "pull_request" }),
    ).resolves.toMatchObject({
      name: "@victor-software-house/hunk",
      version: "0.18.0-beta.1",
    });
  });

  test("accepts the exact Version Packages subject for a manual retry", async () => {
    const repo = createReleaseRepo();
    await expect(
      validateVshRelease({ repoRoot: repo, eventName: "workflow_dispatch" }),
    ).resolves.toMatchObject({ version: "0.18.0-beta.1" });
  });

  test("rejects upstream links in the current release section", async () => {
    const repo = createReleaseRepo("- See https://github.com/modem-dev/hunk/pull/1.\n");
    await expect(validateVshRelease({ repoRoot: repo, eventName: "pull_request" })).rejects.toThrow(
      "modem-dev/hunk",
    );
  });
});
