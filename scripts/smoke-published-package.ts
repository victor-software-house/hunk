#!/usr/bin/env bun

import { $ } from "bun";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export async function preparePublishedSmokeWorkspace(root: string) {
  const bunInstall = path.join(root, "bun-install");
  const cache = path.join(root, "cache");
  const bunfig = path.join(root, "bunfig.toml");
  mkdirSync(bunInstall, { recursive: true });
  await Bun.write(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "hunk-published-smoke", private: true, version: "0.0.0" }, null, 2)}\n`,
  );
  await Bun.write(
    bunfig,
    '[install.scopes]\n"@victor-software-house" = { url = "https://npm.pkg.github.com", token = "$GITHUB_TOKEN" }\n',
  );
  return { bunInstall, cache, bunfig };
}

export async function smokePublishedPackage() {
  const repoRoot = path.resolve(import.meta.dir, "..");
  const manifest = (await Bun.file(path.join(repoRoot, "package.json")).json()) as {
    name: string;
    version: string;
  };
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required for the published-package smoke test.");

  const root = mkdtempSync(path.join(tmpdir(), "hunk-published-smoke-"));
  const { bunInstall, cache, bunfig } = await preparePublishedSmokeWorkspace(root);
  const env = {
    ...process.env,
    GITHUB_TOKEN: token,
    BUN_INSTALL: bunInstall,
    BUN_INSTALL_CACHE_DIR: cache,
  };
  const releasePackages = [
    manifest.name,
    "@victor-software-house/hunk-darwin-arm64",
    "@victor-software-house/hunk-linux-x64",
  ];

  try {
    let registryFailure = "";
    let complete = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const results = await Promise.all(
        releasePackages.map((name) =>
          $`bun --config=${bunfig} pm view ${`${name}@${manifest.version}`}`
            .env(env)
            .cwd(root)
            .nothrow()
            .quiet(),
        ),
      );
      complete = results.every((result) => result.exitCode === 0);
      if (complete) break;
      registryFailure = results
        .filter((result) => result.exitCode !== 0)
        .map((result) => result.stderr.toString() || result.stdout.toString())
        .join("\n");
      await Bun.sleep(3_000);
    }
    if (!complete) {
      throw new Error(
        `GitHub Packages did not serve the complete ${manifest.version} release within 30 seconds.\n${registryFailure}`,
      );
    }

    let installFailure = "";
    let installed = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result =
        await $`bun --config=${bunfig} add --global --exact --force ${`${manifest.name}@${manifest.version}`}`
          .env(env)
          .cwd(root)
          .nothrow()
          .quiet();
      if (result.exitCode === 0) {
        installed = true;
        break;
      }
      installFailure = result.stderr.toString() || result.stdout.toString();
      await Bun.sleep(3_000);
    }
    if (!installed) {
      throw new Error(
        `GitHub Packages did not serve ${manifest.name}@${manifest.version} within 30 seconds.\n${installFailure}`,
      );
    }
    const executable = path.join(
      bunInstall,
      "bin",
      process.platform === "win32" ? "hunk.exe" : "hunk",
    );
    if (process.platform !== "win32") chmodSync(executable, 0o755);
    const installedVersion = (await $`${executable} --version`.env(env).text()).trim();
    if (installedVersion !== manifest.version) {
      throw new Error(`Expected installed version ${manifest.version}, got ${installedVersion}.`);
    }
    console.log(
      `Verified ${releasePackages.map((name) => `${name}@${manifest.version}`).join(", ")} from GitHub Packages.`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await smokePublishedPackage();
}
