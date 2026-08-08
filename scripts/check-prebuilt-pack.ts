#!/usr/bin/env bun

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { releaseNpmDir } from "./prebuilt-package-helpers";
import { runBunPackDryRun } from "./bun-pack";

interface PackedFile {
  path: string;
}

interface PackResult {
  name: string;
  version: string;
  files: PackedFile[];
}

function runPackDryRun(cwd: string): PackResult {
  return runBunPackDryRun(cwd);
}

function assertPaths(pack: PackResult, requiredPaths: string[]) {
  const publishedPaths = new Set(pack.files.map((file) => file.path));

  for (const requiredPath of requiredPaths) {
    if (!publishedPaths.has(requiredPath)) {
      throw new Error(`Expected ${pack.name} to include ${requiredPath}.`);
    }
  }
}

const repoRoot = path.resolve(import.meta.dir, "..");
const releaseRoot = releaseNpmDir(repoRoot);
const metaDir = path.join(releaseRoot, "hunk");

if (!existsSync(metaDir)) {
  throw new Error(`Missing staged top-level package at ${metaDir}`);
}

const metaPack = runPackDryRun(metaDir);
assertPaths(metaPack, [
  "bin/hunk.cjs",
  "dist/npm/main.js",
  "dist/npm/extension/index.d.ts",
  "dist/npm/extension/index.js",
  "dist/npm/opentui/index.d.ts",
  "dist/npm/opentui/index.js",
  "skills/hunk-review/SKILL.md",
  "README.md",
  "LICENSE",
  "package.json",
]);

const packageDirectories = readdirSync(releaseRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "hunk")
  .map((entry) => path.join(releaseRoot, entry.name))
  .sort();

if (packageDirectories.length === 0) {
  throw new Error(`No staged platform packages found in ${releaseRoot}`);
}

const verifiedNames = [metaPack.name];
for (const packageDirectory of packageDirectories) {
  const pack = runPackDryRun(packageDirectory);
  assertPaths(pack, ["LICENSE", "package.json"]);
  const binaryPath = pack.files.find((file) => file.path.startsWith("bin/"))?.path;
  if (!binaryPath) {
    throw new Error(`Expected ${pack.name} to publish one binary under bin/.`);
  }
  verifiedNames.push(pack.name);
}

console.log(
  `Verified prebuilt GitHub Packages for ${metaPack.version}: ${verifiedNames.join(", ")}`,
);
