#!/usr/bin/env bun

import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  binaryFilenameForSpec,
  getHostPlatformPackageSpec,
  releaseNpmDir,
} from "./prebuilt-package-helpers";
import { envWithPath } from "./script-helpers";

function run(command: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
  const proc = Bun.spawnSync(command, {
    cwd: options?.cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: options?.env ?? process.env,
  });

  const stdout = Buffer.from(proc.stdout).toString("utf8");
  const stderr = Buffer.from(proc.stderr).toString("utf8");

  if (proc.exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} failed with exit ${proc.exitCode}\n${stderr || stdout}`.trim(),
    );
  }

  return { stdout, stderr };
}

/** Resolve a command path for a sanitized PATH that still works cross-platform. */
function commandPath(command: string) {
  const proc = Bun.spawnSync(
    process.platform === "win32" ? ["where", command] : ["bash", "-lc", `command -v ${command}`],
    {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    },
  );
  const resolved = Buffer.from(proc.stdout).toString("utf8").split(/\r?\n/, 1)[0]?.trim();
  if (proc.exitCode !== 0 || !resolved) {
    throw new Error(`Could not resolve ${command} on PATH for the prebuilt install smoke test.`);
  }

  return resolved;
}

/** Resolve a command directory for a sanitized PATH that still works cross-platform. */
function commandDirectory(command: string) {
  return path.dirname(commandPath(command));
}

const repoRoot = path.resolve(import.meta.dir, "..");
const packageVersion = JSON.parse(await Bun.file(path.join(repoRoot, "package.json")).text())
  .version as string;
const releaseRoot = releaseNpmDir(repoRoot);
const hostSpec = getHostPlatformPackageSpec();
const tempRoot = path.join(tmpdir(), "hunk-prebuilt-smoke");
mkdirSync(tempRoot, { recursive: true });
let packageDir: string | undefined;
let installDir: string | undefined;
let smokeMetaDir: string | undefined;

try {
  packageDir = mkdtempSync(path.join(tempRoot, "hunk-prebuilt-pack-"));
  installDir = mkdtempSync(path.join(tempRoot, "hunk-prebuilt-install-"));
  smokeMetaDir = mkdtempSync(path.join(tempRoot, "hunk-prebuilt-meta-"));

  const nodePath = commandPath("node");
  const nodeDir = path.dirname(nodePath);
  // bash is required on Unix where the npm-installed wrapper shells out via `#!/usr/bin/env bash`,
  // but the Windows `hunk.cmd` shim does not need bash on PATH.
  const bashDir = process.platform === "win32" ? undefined : commandDirectory("bash");

  const platformPack = run(["bun", "pm", "pack", "--destination", packageDir, "--quiet"], {
    cwd: path.join(releaseRoot, hostSpec.artifactName),
  });

  const platformFilename = platformPack.stdout.trim().split(/\r?\n/).at(-1)!;
  const platformTarball = path.isAbsolute(platformFilename)
    ? platformFilename
    : path.join(packageDir, platformFilename);

  // Point a temp copy of the staged meta package at the local platform tarball.
  // The real manifest uses semver ranges, but this smoke test runs before publish.
  const smokePackageDir = path.join(smokeMetaDir, "hunk");
  cpSync(path.join(releaseRoot, "hunk"), smokePackageDir, { recursive: true });
  const smokeManifestPath = path.join(smokePackageDir, "package.json");
  const smokeManifest = JSON.parse(readFileSync(smokeManifestPath, "utf8")) as {
    optionalDependencies?: Record<string, string>;
  };
  smokeManifest.optionalDependencies = {
    ...smokeManifest.optionalDependencies,
    [hostSpec.packageName]: `file:${platformTarball}`,
  };
  writeFileSync(smokeManifestPath, `${JSON.stringify(smokeManifest, null, 2)}\n`);

  const metaPack = run(["bun", "pm", "pack", "--destination", packageDir, "--quiet"], {
    cwd: smokePackageDir,
  });
  const metaFilename = metaPack.stdout.trim().split(/\r?\n/).at(-1)!;
  const metaTarball = path.isAbsolute(metaFilename)
    ? metaFilename
    : path.join(packageDir, metaFilename);

  const bunInstallEnv = {
    ...process.env,
    BUN_INSTALL: installDir,
    BUN_INSTALL_CACHE_DIR: path.join(installDir, "cache"),
  };
  run(["bun", "add", "--global", "--exact", "--force", metaTarball], {
    cwd: smokeMetaDir,
    env: bunInstallEnv,
  });

  const installedBinDir = path.join(installDir, "bin");
  const installedPackageRoot = path.join(
    installDir,
    "install",
    "global",
    "node_modules",
    "@victor-software-house",
    "hunk",
  );
  const sanitizedPath = [installedBinDir, nodeDir, bashDir].filter(Boolean).join(path.delimiter);
  const installedHunk = path.join(
    installedBinDir,
    process.platform === "win32" ? "hunk.cmd" : "hunk",
  );
  const globalNodeModules = path.join(installDir, "install", "global", "node_modules");
  const installedPlatformBinaryCandidates = [
    path.join(
      installedPackageRoot,
      "node_modules",
      hostSpec.packageName,
      "bin",
      binaryFilenameForSpec(hostSpec),
    ),
    path.join(globalNodeModules, hostSpec.packageName, "bin", binaryFilenameForSpec(hostSpec)),
  ];
  const installedPlatformBinary = installedPlatformBinaryCandidates.find((candidate) =>
    existsSync(candidate),
  );
  if (!installedPlatformBinary) {
    throw new Error(
      `Expected installed platform binary at ${installedPlatformBinaryCandidates.join(" or ")}.`,
    );
  }
  const commandEnv = envWithPath(sanitizedPath);

  if (process.platform !== "win32") {
    const installedBinaryMode = statSync(installedPlatformBinary).mode & 0o777;
    if ((installedBinaryMode & 0o111) === 0) {
      throw new Error(
        `Expected installed platform binary to keep execute bits, got mode ${installedBinaryMode.toString(8)} at ${installedPlatformBinary}`,
      );
    }
  }

  const help = run([installedHunk, "--help"], {
    env: commandEnv,
  });

  if (help.stdout.includes("Usage: hunk") === false) {
    throw new Error(`Expected help output to include 'Usage: hunk'.\n${help.stdout}`);
  }

  const version = run([installedHunk, "--version"], {
    env: commandEnv,
  });
  if (version.stdout !== `${packageVersion}\n`) {
    throw new Error(
      `Expected installed hunk --version to print ${packageVersion}.\n${version.stdout}`,
    );
  }

  const skillPath = run([installedHunk, "skill", "path"], {
    env: commandEnv,
  }).stdout.trim();
  if (
    !skillPath.endsWith(path.join("skills", "hunk-review", "SKILL.md")) ||
    !existsSync(skillPath)
  ) {
    throw new Error(
      `Expected installed hunk skill path to resolve to the bundled skill.\n${skillPath}`,
    );
  }

  const bunCheck = Bun.spawnSync(
    [
      nodePath,
      "-e",
      "const {spawnSync}=require('node:child_process'); process.exit(spawnSync('bun',['--version'],{stdio:'ignore'}).status===0?1:0);",
    ],
    {
      env: commandEnv,
    },
  );

  if (bunCheck.exitCode !== 0) {
    throw new Error("bun unexpectedly available on the prebuilt install smoke-test PATH");
  }

  console.log(`Verified prebuilt Bun install smoke test with ${hostSpec.packageName}`);
} finally {
  if (packageDir) {
    rmSync(packageDir, { recursive: true, force: true });
  }
  if (installDir) {
    rmSync(installDir, { recursive: true, force: true });
  }
  if (smokeMetaDir) {
    rmSync(smokeMetaDir, { recursive: true, force: true });
  }
}
