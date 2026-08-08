import { canReloadInput } from "../../core/inputReload";
import type { CliInput, VcsDiffCommandInput } from "../../core/types";
import type { ExtensionReviewRangeState } from "../../extension-api/types";

/** Describe whether one current input may be replaced with a VCS comparison range. */
export function resolveExtensionReviewRangeState(input: CliInput): ExtensionReviewRangeState {
  if (input.kind !== "vcs") {
    return {
      available: false,
      detail: "Review ranges are available only for VCS diff sessions.",
    };
  }

  if (!canReloadInput(input)) {
    return {
      available: false,
      detail: "Review ranges need a session whose inputs can be reloaded.",
    };
  }

  return input.range === undefined ? { available: true } : { available: true, value: input.range };
}

/** Normalize one extension-authored range, rejecting malformed requests as extension bugs. */
export function normalizeExtensionReviewRange(range: unknown): string {
  if (typeof range !== "string" || range.trim().length === 0) {
    throw new Error("review.setRange requires a non-empty range string.");
  }

  return range.trim();
}

/** Replace only the VCS range, keeping pathspecs and every host-owned review option. */
export function withExtensionReviewRange(
  input: VcsDiffCommandInput,
  range: string,
): VcsDiffCommandInput {
  return { ...input, range, staged: false };
}
