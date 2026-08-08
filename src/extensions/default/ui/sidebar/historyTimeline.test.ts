import { describe, expect, test } from "bun:test";
import type { ExtensionReviewHistory } from "../../../../extension-api/types";
import { buildHistoryTimeline } from "./historyTimeline";

const FIRST = "a".repeat(40);
const SECOND = "b".repeat(40);

function history(): ExtensionReviewHistory {
  return {
    commits: [
      {
        id: SECOND,
        parentIds: [FIRST],
        subject: "second subject",
        committedAt: "2026-08-09T01:00:00.000Z",
      },
      {
        id: FIRST,
        parentIds: [],
        subject: "first subject",
        committedAt: "2026-08-08T01:00:00.000Z",
      },
    ],
    refs: [
      { name: "origin/main", kind: "remote", commitId: SECOND },
      { name: "v2", kind: "tag", commitId: SECOND },
      { name: "main", kind: "branch", commitId: SECOND, current: true },
      { name: "feature/very-long-history-name", kind: "branch", commitId: FIRST },
      { name: "v1", kind: "tag", commitId: FIRST },
      { name: "outside-window", kind: "branch", commitId: "c".repeat(40) },
    ],
  };
}

describe("buildHistoryTimeline", () => {
  test("keeps commit topology and attaches refs to their target commit", () => {
    const rows = buildHistoryTimeline(history());

    expect(rows.map((row) => row.target)).toEqual([SECOND, FIRST]);
    expect(rows[0]).toMatchObject({
      subject: "second subject",
      compactRef: "* main +2",
      refDetail: "branch main · remote origin/main · tag v2",
    });
    expect(rows[1]).toMatchObject({
      subject: "first subject",
      compactRef: "b feature/very-long-history-name +1",
      refDetail: "branch feature/very-long-history-name · tag v1",
    });
  });

  test("deduplicates identical ref records and omits refs outside the bounded commits", () => {
    const input = history();
    input.refs = [...input.refs, input.refs[2]!];

    const rows = buildHistoryTimeline(input);
    expect(rows[0]!.refs).toHaveLength(3);
    expect(rows.flatMap((row) => row.refs).some((ref) => ref.name === "outside-window")).toBe(
      false,
    );
  });
});
