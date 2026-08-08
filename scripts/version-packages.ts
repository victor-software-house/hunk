#!/usr/bin/env bun

import { $ } from "bun";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");

await $`bun run changeset version`.cwd(repoRoot);
await $`bun install --lockfile-only`.cwd(repoRoot);
