import type {
  ExtensionReviewHistory,
  ExtensionReviewHistoryRef,
} from "../../../../extension-api/types";

const REF_KIND_ORDER = { branch: 0, remote: 1, tag: 2 } as const;
const REF_KIND_LABEL = { branch: "branch", remote: "remote", tag: "tag" } as const;
const REF_KIND_MARKER = { branch: "b", remote: "r", tag: "t" } as const;

export interface HistoryTimelineRow {
  key: string;
  target: string;
  shortId: string;
  subject: string;
  refs: readonly ExtensionReviewHistoryRef[];
  compactRef: string;
  refDetail: string;
}

/** Order attached refs by operator relevance rather than Git's global ref date order. */
function compareRefs(left: ExtensionReviewHistoryRef, right: ExtensionReviewHistoryRef) {
  if (Boolean(left.current) !== Boolean(right.current)) return left.current ? -1 : 1;
  const kindDifference = REF_KIND_ORDER[left.kind] - REF_KIND_ORDER[right.kind];
  return kindDifference || left.name.localeCompare(right.name);
}

/** Build one topological commit timeline with branch, remote, and tag aliases attached. */
export function buildHistoryTimeline(history: ExtensionReviewHistory | null): HistoryTimelineRow[] {
  if (!history) return [];

  const refsByCommit = new Map<string, ExtensionReviewHistoryRef[]>();
  const seenRefs = new Set<string>();
  const commitIds = new Set(history.commits.map((commit) => commit.id));
  for (const ref of history.refs) {
    const key = `${ref.kind}\0${ref.name}\0${ref.commitId}`;
    if (seenRefs.has(key) || !commitIds.has(ref.commitId)) continue;
    seenRefs.add(key);
    const refs = refsByCommit.get(ref.commitId) ?? [];
    refs.push(ref);
    refsByCommit.set(ref.commitId, refs);
  }

  return history.commits.map((commit) => {
    const refs = (refsByCommit.get(commit.id) ?? []).sort(compareRefs);
    const primary = refs[0];
    const compactRef = primary
      ? `${primary.current ? "*" : REF_KIND_MARKER[primary.kind]} ${primary.name}${refs.length > 1 ? ` +${refs.length - 1}` : ""}`
      : "";
    return {
      key: `commit:${commit.id}`,
      target: commit.id,
      shortId: commit.id.slice(0, 7),
      subject: commit.subject,
      refs,
      compactRef,
      refDetail: refs.map((ref) => `${REF_KIND_LABEL[ref.kind]} ${ref.name}`).join(" · "),
    };
  });
}
