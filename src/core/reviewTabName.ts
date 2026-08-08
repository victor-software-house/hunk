import { sanitizeTerminalLine } from "../lib/terminalText";

export const MAX_REVIEW_TAB_NAME_CODE_POINTS = 48;

/** Normalize one user- or agent-authored tab name into its stored identity label. */
export function normalizeReviewTabName(name: unknown): string {
  if (typeof name !== "string") {
    throw new Error("Review tab name must be a string.");
  }

  const normalized = sanitizeTerminalLine(name.replaceAll(/\s+/gu, " ")).trim();
  if (normalized.length === 0) {
    throw new Error("Review tab name must not be empty.");
  }
  if ([...normalized].length > MAX_REVIEW_TAB_NAME_CODE_POINTS) {
    throw new Error(
      `Review tab name must be at most ${MAX_REVIEW_TAB_NAME_CODE_POINTS} Unicode code points.`,
    );
  }
  return normalized;
}
