import type {
  ExtensionReviewHistory,
  ExtensionReviewHistoryCommit,
  ExtensionReviewHistoryRef,
  ExtensionVcsDiffInput,
  ExtensionVcsLoadContext,
} from "../../../../extension-api/types";
import { runGitText } from "../../../../core/vcs/git";

const HISTORY_LIMIT = 200;
const HISTORY_INPUT: ExtensionVcsDiffInput = {
  kind: "vcs",
  staged: false,
  options: {},
};

/** Run one read-only Git history command through Hunk's ordinary Git error boundary. */
function readGitHistoryText(args: string[], context: ExtensionVcsLoadContext) {
  return runGitText({
    input: HISTORY_INPUT,
    args,
    cwd: context.cwd,
    gitExecutable: context.gitExecutable,
    preventOptionalLocks: true,
  });
}

/** Parse one NUL-delimited commit record emitted by `git log`. */
function parseCommit(record: string): ExtensionReviewHistoryCommit | null {
  const [id, parents = "", committedAt = "", subject = ""] = record.split("\0");
  if (!id || !/^\d+$/.test(committedAt)) return null;

  return {
    id,
    parentIds: parents.length === 0 ? [] : parents.split(" "),
    subject,
    committedAt: new Date(Number(committedAt) * 1_000).toISOString(),
  };
}

/** Resolve one full ref name into the public history kind and display name. */
function describeRef(ref: string): Pick<ExtensionReviewHistoryRef, "kind" | "name"> | null {
  if (ref.startsWith("refs/heads/")) {
    return { kind: "branch", name: ref.slice("refs/heads/".length) };
  }
  if (ref.startsWith("refs/remotes/")) {
    return { kind: "remote", name: ref.slice("refs/remotes/".length) };
  }
  if (ref.startsWith("refs/tags/")) {
    return { kind: "tag", name: ref.slice("refs/tags/".length) };
  }
  return null;
}

/** Parse one NUL-delimited ref record emitted by `git for-each-ref`. */
function parseRef(record: string): ExtensionReviewHistoryRef | null {
  const [objectId, peeledId = "", ref = "", head = "", symbolicTarget = ""] = record.split("\0");
  const described = describeRef(ref);
  if (!objectId || !described || symbolicTarget.length > 0) return null;

  return {
    ...described,
    commitId: peeledId || objectId,
    ...(head === "*" ? { current: true } : {}),
  };
}

/** Load bounded local commits and refs for Hunk's read-only history navigator. */
export async function loadGitReviewHistory(
  context: ExtensionVcsLoadContext,
): Promise<ExtensionReviewHistory> {
  const commits = readGitHistoryText(
    [
      "log",
      "--all",
      "--topo-order",
      `--max-count=${HISTORY_LIMIT}`,
      "--format=%H%x00%P%x00%ct%x00%s",
    ],
    context,
  )
    .trimEnd()
    .split("\n")
    .flatMap((record) => {
      const commit = parseCommit(record);
      return commit ? [commit] : [];
    });

  const refs = readGitHistoryText(
    [
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(objectname)%00%(*objectname)%00%(refname)%00%(HEAD)%00%(symref)",
      "refs/heads",
      "refs/remotes",
      "refs/tags",
    ],
    context,
  )
    .trimEnd()
    .split("\n")
    .flatMap((record) => {
      const ref = parseRef(record);
      return ref ? [ref] : [];
    });

  return { commits, refs };
}
