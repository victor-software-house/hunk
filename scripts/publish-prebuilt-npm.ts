#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  buildPublishArgs,
  classifyPackageSetPublication,
  releaseNpmDir,
} from "./prebuilt-package-helpers";

type PackageJson = {
  name: string;
  version: string;
};

function parseArgs(argv: string[]) {
  let dryRun = false;
  let npmTag = "latest";

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (argument === "--tag") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --tag");
      }
      npmTag = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return {
    dryRun,
    npmTag,
  };
}

function packageExists(name: string, version: string) {
  const proc = Bun.spawnSync(["bun", "pm", "view", `${name}@${version}`], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    env: process.env,
  });

  return proc.exitCode === 0;
}

function publishDirectory(
  directory: string,
  bunConfigPath: string,
  dryRun: boolean,
  npmTag: string,
) {
  const packageJson = JSON.parse(
    readFileSync(path.join(directory, "package.json"), "utf8"),
  ) as PackageJson;

  const args = buildPublishArgs({ bunConfigPath, dryRun, npmTag });
  const proc = Bun.spawnSync(["bun", ...args], {
    cwd: directory,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });

  if (proc.exitCode !== 0) {
    throw new Error(`bun publish failed for ${packageJson.name}@${packageJson.version}`);
  }
}

const repoRoot = path.resolve(import.meta.dir, "..");
const bunConfigPath = path.join(repoRoot, "bunfig.toml");
const releaseRoot = releaseNpmDir(repoRoot);
const options = parseArgs(process.argv.slice(2));

if (!existsSync(releaseRoot)) {
  throw new Error(`Missing staged npm release directory at ${releaseRoot}`);
}

const directories = readdirSync(releaseRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(releaseRoot, entry.name))
  .sort((left, right) => {
    const leftName = (
      JSON.parse(readFileSync(path.join(left, "package.json"), "utf8")) as PackageJson
    ).name;
    const rightName = (
      JSON.parse(readFileSync(path.join(right, "package.json"), "utf8")) as PackageJson
    ).name;
    if (leftName === "@victor-software-house/hunk") return 1;
    if (rightName === "@victor-software-house/hunk") return -1;
    return leftName.localeCompare(rightName);
  });

if (directories.length === 0) {
  throw new Error(`No staged packages found in ${releaseRoot}`);
}

const packages = directories.map((directory) => {
  const manifest = JSON.parse(
    readFileSync(path.join(directory, "package.json"), "utf8"),
  ) as PackageJson;
  return { directory, manifest, exists: packageExists(manifest.name, manifest.version) };
});
const publication = classifyPackageSetPublication(
  packages.map((entry) => ({ ...entry.manifest, exists: entry.exists })),
);

if (publication === "all") {
  console.log(
    `All ${packages.length} staged packages already exist at ${packages[0]!.manifest.version}; nothing to publish.`,
  );
} else {
  for (const { directory } of packages) {
    publishDirectory(directory, bunConfigPath, options.dryRun, options.npmTag);
  }
}

console.log(
  options.dryRun
    ? `Completed Bun publish dry-run for staged GitHub Packages with dist-tag "${options.npmTag}".`
    : `Published staged GitHub Packages with dist-tag "${options.npmTag}".`,
);
