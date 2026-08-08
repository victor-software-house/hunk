import { describe, expect, test } from "bun:test";
import { createTestVcsAppBootstrap } from "../../test/helpers/app-bootstrap";
import {
  addReviewTab,
  closeReviewTab,
  createReviewTabsState,
  defaultReviewTabName,
  MAX_REVIEW_TAB_NAME_CODE_POINTS,
  normalizeReviewTabName,
  renameReviewTab,
  replaceReviewTabBootstrap,
  selectReviewTab,
} from "./reviewTabs";

const bootstrap = (sourceLabel: string) =>
  createTestVcsAppBootstrap({ files: [], sourceLabel, title: `${sourceLabel} review` });

const initial = () =>
  createReviewTabsState({
    tabId: "tab-a",
    name: "Alpha",
    cwd: "/work/alpha",
    bootstrap: bootstrap("/work/alpha"),
  });

describe("review tab data model", () => {
  test("normalizes safe bounded names without byte-counting Unicode", () => {
    expect(normalizeReviewTabName("  Alpha\nReview  ")).toBe("Alpha Review");
    expect(normalizeReviewTabName("🧪".repeat(MAX_REVIEW_TAB_NAME_CODE_POINTS))).toHaveLength(
      MAX_REVIEW_TAB_NAME_CODE_POINTS * 2,
    );
    expect(() => normalizeReviewTabName("🧪".repeat(MAX_REVIEW_TAB_NAME_CODE_POINTS + 1))).toThrow(
      `at most ${MAX_REVIEW_TAB_NAME_CODE_POINTS} Unicode code points`,
    );
    expect(() => normalizeReviewTabName("\u001b[2J")).toThrow("must not be empty");
  });

  test("derives the initial name from the review root basename", () => {
    const review = bootstrap("/workspace/victor/hunk");
    review.reloadContext.repoRoot = "/workspace/victor/hunk";
    expect(defaultReviewTabName(review)).toBe("hunk");
  });

  test("adds, selects, renames, and replaces tabs by stable id", () => {
    const betaBootstrap = bootstrap("/work/beta");
    const added = addReviewTab(initial(), {
      tabId: "tab-b",
      name: "Beta",
      cwd: "/work/beta",
      bootstrap: betaBootstrap,
    });
    expect(added.activeTabId).toBe("tab-b");
    expect(added.tabs.map((tab) => [tab.tabId, tab.name])).toEqual([
      ["tab-a", "Alpha"],
      ["tab-b", "Beta"],
    ]);

    const selected = selectReviewTab(added, "tab-a");
    const renamed = renameReviewTab(selected, "tab-a", "Core");
    const replacement = bootstrap("/work/core-next");
    const replaced = replaceReviewTabBootstrap(renamed, "tab-a", replacement, "/work/core-next");
    expect(replaced.tabs[0]).toMatchObject({
      tabId: "tab-a",
      name: "Core",
      cwd: "/work/core-next",
      bootstrap: replacement,
    });
  });

  test("rejects duplicate names and ids instead of making selectors ambiguous", () => {
    const state = addReviewTab(initial(), {
      tabId: "tab-b",
      name: "Beta",
      cwd: "/work/beta",
      bootstrap: bootstrap("/work/beta"),
    });
    expect(() =>
      addReviewTab(state, {
        tabId: "tab-c",
        name: "Beta",
        cwd: "/work/gamma",
        bootstrap: bootstrap("/work/gamma"),
      }),
    ).toThrow("name already exists");
    expect(() =>
      addReviewTab(state, {
        tabId: "tab-b",
        name: "Gamma",
        cwd: "/work/gamma",
        bootstrap: bootstrap("/work/gamma"),
      }),
    ).toThrow("id already exists");
  });

  test("closing the active tab chooses right then left and never closes the last", () => {
    const withBeta = addReviewTab(initial(), {
      tabId: "tab-b",
      name: "Beta",
      cwd: "/work/beta",
      bootstrap: bootstrap("/work/beta"),
    });
    const withGamma = addReviewTab(withBeta, {
      tabId: "tab-c",
      name: "Gamma",
      cwd: "/work/gamma",
      bootstrap: bootstrap("/work/gamma"),
    });

    const selectedBeta = selectReviewTab(withGamma, "tab-b");
    const closedBeta = closeReviewTab(selectedBeta, "tab-b");
    expect(closedBeta.activeTabId).toBe("tab-c");
    const closedGamma = closeReviewTab(closedBeta, "tab-c");
    expect(closedGamma.activeTabId).toBe("tab-a");
    expect(() => closeReviewTab(closedGamma, "tab-a")).toThrow("at least one review tab");
  });
});
