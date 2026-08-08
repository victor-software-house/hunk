import { describe, expect, test } from "bun:test";
import type { CliInput, VcsDiffCommandInput } from "../../core/types";
import {
  normalizeExtensionReviewRange,
  resolveExtensionReviewRangeState,
  withExtensionReviewRange,
} from "./extensionReview";

const vcsInput: VcsDiffCommandInput = {
  kind: "vcs",
  staged: false,
  pathspecs: ["src"],
  options: { mode: "stack" },
};

describe("extension review range policy", () => {
  test("exposes the current VCS range without losing working-tree eligibility", () => {
    expect(resolveExtensionReviewRangeState(vcsInput)).toEqual({ available: true });
    expect(resolveExtensionReviewRangeState({ ...vcsInput, range: "main...HEAD" })).toEqual({
      available: true,
      value: "main...HEAD",
    });
  });

  test("refuses review kinds that cannot express a VCS range", () => {
    const input: CliInput = {
      kind: "diff",
      left: "before.ts",
      right: "after.ts",
      options: {},
    };

    expect(resolveExtensionReviewRangeState(input)).toEqual({
      available: false,
      detail: "Review ranges are available only for VCS diff sessions.",
    });
  });

  test("normalizes a range and rejects blank extension requests", () => {
    expect(normalizeExtensionReviewRange("  main...HEAD  ")).toBe("main...HEAD");
    expect(() => normalizeExtensionReviewRange("   ")).toThrow(
      "review.setRange requires a non-empty range string.",
    );
  });

  test("changes only range semantics and preserves the rest of the VCS input", () => {
    expect(withExtensionReviewRange({ ...vcsInput, staged: true }, "main...HEAD")).toEqual({
      ...vcsInput,
      range: "main...HEAD",
      staged: false,
    });
  });
});
