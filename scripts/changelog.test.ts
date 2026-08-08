import { describe, expect, test } from "bun:test";
import { normalizeVshChangelog } from "../.changeset/changelog";

describe("VSH changelog provenance", () => {
  test("keeps upstream PR numbers without linking the upstream repository", () => {
    const line =
      "- [#675](https://github.com/modem-dev/hunk/pull/675) [`efa2203`](https://github.com/victor-software-house/hunk/commit/efa2203) - Add file views.";

    expect(normalizeVshChangelog(line)).toBe(
      "- #675 [`efa2203`](https://github.com/victor-software-house/hunk/commit/efa2203) - Add file views.",
    );
  });

  test("does not change VSH pull-request links", () => {
    const line = "- [#1](https://github.com/victor-software-house/hunk/pull/1) - Add tabs.";

    expect(normalizeVshChangelog(line)).toBe(line);
  });
});
