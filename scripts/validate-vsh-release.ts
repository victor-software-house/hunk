#!/usr/bin/env bun

import { $ } from "bun";
import path from "node:path";

export interface ValidateVshReleaseOptions {
  repoRoot?: string;
  eventName?: string;
}

/** Validate one exact VSH package release commit before any registry mutation. */
export async function validateVshRelease(options: ValidateVshReleaseOptions = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? path.resolve(import.meta.dir, ".."));
  const manifest = (await Bun.file(path.join(repoRoot, "package.json")).json()) as {
    name: string;
    version: string;
    repository?: { url?: string };
    publishConfig?: { registry?: string; access?: string };
  };
  const changelog = await Bun.file(path.join(repoRoot, "CHANGELOG.md")).text();

  if (manifest.name !== "@victor-software-house/hunk") {
    throw new Error(`Unexpected release package: ${manifest.name}`);
  }
  if (manifest.repository?.url !== "git+https://github.com/victor-software-house/hunk.git") {
    throw new Error("package.json repository does not point at the VSH fork.");
  }
  if (
    manifest.publishConfig?.registry !== "https://npm.pkg.github.com" ||
    manifest.publishConfig.access !== "restricted"
  ) {
    throw new Error("package.json does not target restricted GitHub Packages publication.");
  }

  const heading = `## ${manifest.version}`;
  const start = changelog.indexOf(heading);
  if (start < 0) throw new Error(`CHANGELOG.md has no ${heading} section.`);
  const next = changelog.indexOf("\n## ", start + heading.length);
  const currentSection = changelog.slice(start, next < 0 ? undefined : next);
  if (currentSection.includes("modem-dev/hunk")) {
    throw new Error(`The ${heading} changelog section still links to modem-dev/hunk.`);
  }

  await $`git fetch origin main`.cwd(repoRoot);
  const ancestor = await $`git merge-base --is-ancestor HEAD origin/main`
    .cwd(repoRoot)
    .nothrow()
    .quiet();
  if (ancestor.exitCode !== 0) {
    throw new Error("The release SHA is not an ancestor of origin/main.");
  }

  const eventName = options.eventName ?? process.env.GITHUB_EVENT_NAME;
  if (eventName === "pull_request") {
    const changed = new Set(
      (await $`git diff --name-only HEAD^1 HEAD`.cwd(repoRoot).text()).trim().split("\n"),
    );
    for (const required of ["package.json", "CHANGELOG.md"]) {
      if (!changed.has(required)) {
        throw new Error(`The merged Version Packages PR did not change ${required}.`);
      }
    }
    const previousManifest = JSON.parse(
      await $`git show HEAD^1:package.json`.cwd(repoRoot).text(),
    ) as { version: string };
    if (previousManifest.version === manifest.version) {
      throw new Error(`Version Packages did not change ${manifest.version}.`);
    }
  }
  if (eventName === "workflow_dispatch") {
    const subject = (await $`git log -1 --pretty=%s`.cwd(repoRoot).text()).trim();
    if (subject !== "chore(release): version packages") {
      throw new Error(`Manual release SHA has unexpected subject: ${subject}`);
    }
  }

  const releaseSha = (await $`git rev-parse HEAD`.cwd(repoRoot).text()).trim();
  console.log(`Validated ${manifest.name}@${manifest.version} at ${releaseSha}.`);
  return { name: manifest.name, version: manifest.version, releaseSha };
}

if (import.meta.main) {
  await validateVshRelease();
}
