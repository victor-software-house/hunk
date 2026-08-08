import { readFileSync } from "node:fs";
import path from "node:path";

export interface BunPackDryRun {
  name: string;
  version: string;
  entryCount: number;
  files: Array<{ path: string }>;
}

/** Inspect the exact files Bun would publish without creating a tarball. */
export function runBunPackDryRun(cwd: string): BunPackDryRun {
  const repoRoot = path.resolve(import.meta.dir, "..");
  const proc = Bun.spawnSync(["bun", "pm", "pack", "--dry-run"], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      PATH: `${path.join(repoRoot, "node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  });
  const stdout = Buffer.from(proc.stdout).toString("utf8");
  const stderr = Buffer.from(proc.stderr).toString("utf8");
  if (proc.exitCode !== 0) {
    throw new Error(stderr || stdout || `bun pm pack --dry-run failed in ${cwd}`);
  }

  const files = [...`${stdout}\n${stderr}`.matchAll(/^packed\s+\S+\s+(.+)$/gmu)].map((match) => ({
    path: match[1]!,
  }));
  const uniqueFiles = [...new Map(files.map((file) => [file.path, file])).values()];
  if (uniqueFiles.length === 0) {
    throw new Error(`bun pm pack --dry-run reported no files for ${cwd}.\n${stdout}\n${stderr}`);
  }

  const manifest = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")) as {
    name: string;
    version: string;
  };
  return {
    name: manifest.name,
    version: manifest.version,
    entryCount: uniqueFiles.length,
    files: uniqueFiles,
  };
}
