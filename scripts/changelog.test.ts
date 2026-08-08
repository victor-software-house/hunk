import { describe, expect, test } from "bun:test";
import { getReleaseLine } from "../.changeset/changelog";

const options = { repo: "victor-software-house/hunk" };

describe("VSH changelog provenance", () => {
  test("links inherited changes only to commits in the VSH fork", async () => {
    const line = await getReleaseLine(
      {
        id: "upstream-change",
        commit: "efa2203f86845e1da5849ae64fe7cd50ceeba06e",
        releases: [{ name: "@victor-software-house/hunk", type: "minor" }],
        summary: "Add file views.",
      },
      "minor",
      options,
    );

    expect(line).toBe(
      "\n\n- Add file views ([`efa2203`](https://github.com/victor-software-house/hunk/commit/efa2203f86845e1da5849ae64fe7cd50ceeba06e)).\n",
    );
    expect(line).not.toContain("modem-dev/hunk");
  });

  test("keeps entries without commit metadata readable", async () => {
    const line = await getReleaseLine(
      {
        id: "uncommitted-change",
        commit: undefined,
        releases: [{ name: "@victor-software-house/hunk", type: "patch" }],
        summary: "Keep release provenance local",
      },
      "patch",
      options,
    );

    expect(line).toBe("\n\n- Keep release provenance local.\n");
  });
});
