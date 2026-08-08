import { readHunkStateRecord, updateHunkStateRecord } from "./hunkState";
import { resolveHunkStatePath } from "./paths";
import type { StartupNotice } from "./startupNotice";
import { resolveCliVersion, UNKNOWN_CLI_VERSION } from "./version";

const RELEASES_URL = "https://api.github.com/repos/victor-software-house/hunk/releases?per_page=20";
const RELEASE_TAG_PREFIX = "@victor-software-house/hunk@";
const STABLE_SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const PRERELEASE_SEMVER_PATTERN = /^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/;
const DEFAULT_UPDATE_NOTICE_FETCH_TIMEOUT_MS = 5_000;
const DISABLE_STARTUP_UPDATE_NOTICE_ENV = "HUNK_DISABLE_UPDATE_NOTICE";
const INSTALL_SOURCE_ENV = "HUNK_INSTALL_SOURCE";
const STARTUP_STATE_VERSION = 1;

interface PersistedStartupState {
  version: number;
  lastSeenCliVersion?: string;
}

export type UpdateChannel = "latest" | "beta";
export type InstallSource = "npm" | "homebrew" | "nix";

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ParsedDistTags {
  latest?: string;
  beta?: string;
}

export interface UpdateNoticeDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchImpl;
  fetchTimeoutMs?: number;
  resolveInstalledVersion?: () => string;
  resolveInstallSource?: () => InstallSource;
  resolveExecutablePath?: () => string;
  statePath?: string;
}

/** Return whether one version string is a normalized stable semver. */
function isStableVersion(version: string) {
  return STABLE_SEMVER_PATTERN.test(version);
}

/** Return whether one version string looks like a prerelease semver. */
function isPrereleaseVersion(version: string) {
  return PRERELEASE_SEMVER_PATTERN.test(version);
}

/** Parse VSH GitHub Releases, with dist-tag objects retained as a test seam. */
function parseDistTags(payload: unknown): ParsedDistTags {
  if (Array.isArray(payload)) {
    const versions = payload.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const release = entry as Record<string, unknown>;
      const tag = typeof release.tag_name === "string" ? release.tag_name : "";
      if (
        release.draft === true ||
        !tag.startsWith(RELEASE_TAG_PREFIX) ||
        typeof release.prerelease !== "boolean"
      ) {
        return [];
      }
      return [{ version: tag.slice(RELEASE_TAG_PREFIX.length), prerelease: release.prerelease }];
    });
    const newest = (prerelease: boolean) =>
      versions
        .filter((entry) => entry.prerelease === prerelease)
        .map((entry) => entry.version)
        .filter((version) => isStableVersion(version) || isPrereleaseVersion(version))
        .sort((left, right) => Bun.semver.order(right, left))[0];
    return { latest: newest(false), beta: newest(true) };
  }

  if (typeof payload !== "object" || payload === null) {
    return {};
  }
  const record = payload as Record<string, unknown>;
  return {
    latest: typeof record.latest === "string" ? record.latest : undefined,
    beta: typeof record.beta === "string" ? record.beta : undefined,
  };
}

/** Compare two versions and return whether the candidate is strictly newer. */
function isNewerVersion(current: string, candidate: string) {
  try {
    return Bun.semver.order(current, candidate) < 0;
  } catch {
    return false;
  }
}

/** Resolve which package manager installed this binary, defaulting to the npm package path. */
function resolveInstallSourceFromRuntime(
  env: NodeJS.ProcessEnv = process.env,
  executablePath = process.execPath,
): InstallSource {
  const installSource = env[INSTALL_SOURCE_ENV];
  if (installSource === "homebrew" || installSource === "nix") {
    return installSource;
  }

  return executablePath.startsWith("/nix/store/") ? "nix" : "npm";
}

/** Build the install-aware update instruction shown for one release channel. */
function updateInstructionForChannel(channel: UpdateChannel, installSource: InstallSource) {
  if (installSource === "homebrew") {
    return "brew update && brew upgrade hunk";
  }

  if (installSource === "nix") {
    return "update Hunk through your Nix configuration";
  }

  return channel === "latest"
    ? "bun add -g @victor-software-house/hunk"
    : "bun add -g @victor-software-house/hunk@beta";
}

/** Build the session-local notice payload for the chosen version and channel. */
function createUpdateNotice(
  version: string,
  channel: UpdateChannel,
  installSource: InstallSource,
): StartupNotice {
  const instruction = updateInstructionForChannel(channel, installSource);
  return {
    key: `${channel}:${version}`,
    message: `Update available: ${version} (${channel}) • ${instruction}`,
  };
}

/** Return whether the installed version can participate in update comparisons. */
function isComparableInstalledVersion(version: string) {
  if (version === UNKNOWN_CLI_VERSION) {
    return false;
  }

  return isStableVersion(version) || isPrereleaseVersion(version);
}

/** Choose the single best update notice from the fetched dist-tags and installed version. */
function selectUpdateNotice(
  installedVersion: string,
  distTags: ParsedDistTags,
  installSource: InstallSource,
): StartupNotice | null {
  if (!isComparableInstalledVersion(installedVersion)) {
    return null;
  }

  const validLatest =
    distTags.latest && isStableVersion(distTags.latest) ? distTags.latest : undefined;
  const validBeta =
    installSource === "npm" && distTags.beta && isPrereleaseVersion(distTags.beta)
      ? distTags.beta
      : undefined;
  const installedIsStable = isStableVersion(installedVersion);

  if (installedIsStable) {
    if (validLatest && isNewerVersion(installedVersion, validLatest)) {
      return createUpdateNotice(validLatest, "latest", installSource);
    }

    if (validBeta && isNewerVersion(installedVersion, validBeta)) {
      return createUpdateNotice(validBeta, "beta", installSource);
    }

    return null;
  }

  const newerCandidates: Array<{ channel: UpdateChannel; version: string }> = [];
  if (validLatest && isNewerVersion(installedVersion, validLatest)) {
    newerCandidates.push({ channel: "latest", version: validLatest });
  }

  if (validBeta && isNewerVersion(installedVersion, validBeta)) {
    newerCandidates.push({ channel: "beta", version: validBeta });
  }

  if (newerCandidates.length === 0) {
    return null;
  }

  const selected = newerCandidates.reduce((best, candidate) =>
    isNewerVersion(best.version, candidate.version) ? candidate : best,
  );

  return createUpdateNotice(selected.version, selected.channel, installSource);
}

/** Build one fetch timeout signal for the dist-tag lookup, if supported by the runtime. */
function createFetchTimeoutSignal(timeoutMs: number) {
  if (typeof AbortController === "undefined") {
    return { signal: undefined, dispose: () => {} };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
    },
  };
}

/** Read the persisted startup state from disk, falling back cleanly on missing or invalid files. */
function readPersistedStartupState(path: string): PersistedStartupState {
  const record = readHunkStateRecord(path);
  return {
    version: typeof record.version === "number" ? record.version : STARTUP_STATE_VERSION,
    lastSeenCliVersion:
      typeof record.lastSeenCliVersion === "string" ? record.lastSeenCliVersion : undefined,
  };
}

/** Persist the current installed CLI version without discarding unrelated state keys. */
function writePersistedStartupState(path: string, installedVersion: string) {
  updateHunkStateRecord(path, {
    version: STARTUP_STATE_VERSION,
    lastSeenCliVersion: installedVersion,
  } satisfies PersistedStartupState);
}

/** Return whether the transient startup notice should stay disabled for deterministic sessions like CI. */
function startupUpdateNoticeDisabled(env: NodeJS.ProcessEnv = process.env) {
  return env[DISABLE_STARTUP_UPDATE_NOTICE_ENV] === "1";
}

/** Resolve the one-time copied-skill refresh notice shown after a version change. */
function resolveStartupSkillRefreshNotice(deps: UpdateNoticeDeps = {}): StartupNotice | null {
  const resolveInstalledVersion = deps.resolveInstalledVersion ?? resolveCliVersion;
  const installedVersion = resolveInstalledVersion();
  if (installedVersion === UNKNOWN_CLI_VERSION) {
    return null;
  }

  const statePath = deps.statePath ?? resolveHunkStatePath(deps.env ?? process.env);
  if (!statePath) {
    return null;
  }

  const previousVersion = readPersistedStartupState(statePath).lastSeenCliVersion;

  try {
    writePersistedStartupState(statePath, installedVersion);
  } catch {
    return null;
  }

  if (!previousVersion || previousVersion === installedVersion) {
    return null;
  }

  return {
    key: `skill:${installedVersion}`,
    message: `Hunk ${installedVersion} installed • If your agent copied Hunk's skill, run hunk skill path`,
  };
}

/** Resolve the transient startup notice directly from local state or npm dist-tags. */
export async function resolveStartupUpdateNotice(
  deps: UpdateNoticeDeps = {},
): Promise<StartupNotice | null> {
  const env = deps.env ?? process.env;
  if (startupUpdateNoticeDisabled(env)) {
    return null;
  }

  const skillRefreshNotice = resolveStartupSkillRefreshNotice(deps);
  if (skillRefreshNotice) {
    return skillRefreshNotice;
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const fetchTimeoutMs = deps.fetchTimeoutMs ?? DEFAULT_UPDATE_NOTICE_FETCH_TIMEOUT_MS;
  const resolveInstalledVersion = deps.resolveInstalledVersion ?? resolveCliVersion;
  const resolveInstallSource =
    deps.resolveInstallSource ??
    (() => resolveInstallSourceFromRuntime(env, deps.resolveExecutablePath?.()));
  const { signal, dispose } = createFetchTimeoutSignal(fetchTimeoutMs);

  try {
    const response = await fetchImpl(RELEASES_URL, { signal });
    if (!response.ok) {
      return null;
    }

    const parsedPayload = parseDistTags(await response.json());
    return selectUpdateNotice(resolveInstalledVersion(), parsedPayload, resolveInstallSource());
  } catch {
    return null;
  } finally {
    dispose();
  }
}
