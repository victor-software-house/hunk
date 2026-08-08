#!/usr/bin/env bun

import { $ } from "bun";
import { appendFileSync } from "node:fs";
import path from "node:path";

export interface FinalizeVshTagOptions {
  repoRoot?: string;
  outputPath?: string;
}

/** Create and remotely verify the scoped package tag for one exact release commit. */
export async function finalizeVshTag(options: FinalizeVshTagOptions = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? path.resolve(import.meta.dir, ".."));
  const manifest = (await Bun.file(path.join(repoRoot, "package.json")).json()) as {
    version: string;
  };
  const releaseSha = (await $`git rev-parse HEAD`.cwd(repoRoot).text()).trim();
  const tag = `@victor-software-house/hunk@${manifest.version}`;

  const remoteRef = async (ref: string) => {
    const output = await $`git ls-remote --tags origin ${ref}`.cwd(repoRoot).text();
    return output.trim().split(/\s+/, 1)[0] ?? "";
  };

  const tagRef = await remoteRef(`refs/tags/${tag}`);
  const peeled = await remoteRef(`refs/tags/${tag}^{}`);
  const resolved = peeled || tagRef;
  if (resolved && resolved !== releaseSha) {
    throw new Error(`Tag ${tag} resolves to ${resolved}, not ${releaseSha}.`);
  }

  if (!tagRef) {
    await $`git config user.name github-actions[bot]`.cwd(repoRoot);
    await $`git config user.email 41898282+github-actions[bot]@users.noreply.github.com`.cwd(
      repoRoot,
    );
    await $`git tag -a ${tag} ${releaseSha} -m ${tag}`.cwd(repoRoot);
    await $`git push origin ${`refs/tags/${tag}:refs/tags/${tag}`}`.cwd(repoRoot);
  }

  const verified = await remoteRef(`refs/tags/${tag}^{}`);
  if (verified !== releaseSha) {
    throw new Error(`Remote tag ${tag} resolves to ${verified || "nothing"}, not ${releaseSha}.`);
  }

  const outputPath = options.outputPath ?? process.env.GITHUB_OUTPUT;
  if (outputPath) appendFileSync(outputPath, `tag=${tag}\n`);
  console.log(`Verified ${tag} at ${releaseSha}.`);
  return { tag, releaseSha };
}

if (import.meta.main) {
  await finalizeVshTag();
}
