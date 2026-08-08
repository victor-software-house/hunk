import type {
  ChangelogFunctions,
  ModCompWithPackage,
  NewChangesetWithCommit,
  VersionType,
} from "@changesets/types";

type ChangelogOptions = {
  repo?: string;
};

function repositoryFrom(options: unknown): string {
  if (
    typeof options !== "object" ||
    options === null ||
    !("repo" in options) ||
    typeof (options as ChangelogOptions).repo !== "string" ||
    (options as ChangelogOptions).repo === ""
  ) {
    throw new Error("options.repo is required for VSH changelog entries");
  }

  return (options as ChangelogOptions).repo as string;
}

function terminalPunctuation(summary: string): string {
  return /[.!?:;]$/.test(summary) ? "" : ".";
}

/** Render deterministic VSH-owned release provenance without upstream repository links. */
export async function getReleaseLine(
  changeset: NewChangesetWithCommit,
  _type: VersionType,
  options: unknown,
): Promise<string> {
  const repository = repositoryFrom(options);
  const [firstLine = "", ...continuations] = changeset.summary
    .split("\n")
    .map((line) => line.trimEnd());
  const commit = changeset.commit;
  const provenance =
    commit == null || commit === ""
      ? ""
      : ` ([\`${commit.slice(0, 7)}\`](https://github.com/${repository}/commit/${commit}))`;
  const continuationLines = continuations
    .map((line) => (line === "" ? "" : `  ${line.trim()}`))
    .join("\n");
  const releaseLine =
    provenance === ""
      ? `${firstLine}${terminalPunctuation(firstLine)}`
      : `${firstLine.replace(/\.+$/, "")}${provenance}.`;

  return `\n\n- ${releaseLine}\n${continuationLines}`;
}

export async function getDependencyReleaseLine(
  _changesets: NewChangesetWithCommit[],
  dependenciesUpdated: ModCompWithPackage[],
  _options: unknown,
): Promise<string> {
  if (dependenciesUpdated.length === 0) return "";

  return [
    "- Updated dependencies:",
    ...dependenciesUpdated.map((dependency) => `  - ${dependency.name}@${dependency.newVersion}`),
  ].join("\n");
}

const changelog: ChangelogFunctions = {
  getReleaseLine,
  getDependencyReleaseLine,
};

export default changelog;
