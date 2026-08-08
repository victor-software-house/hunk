import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import type { ReviewTab } from "../../../app/reviewTabs";
import { createTestVcsAppBootstrap } from "../../../../test/helpers/app-bootstrap";
import { resolveTheme } from "../../themes";
import { ReviewTabStrip } from "./ReviewTabStrip";

function createTabs(count: number): ReviewTab[] {
  return Array.from({ length: count }, (_, index) => ({
    tabId: `tab-${index}`,
    name: `project-${index}-with-a-descriptive-name`,
    cwd: `/repo-${index}`,
    bootstrap: createTestVcsAppBootstrap({ files: [], sourceLabel: `/repo-${index}` }),
  }));
}

describe("ReviewTabStrip", () => {
  test("horizontally reveals an active tab beyond the initial viewport", async () => {
    const tabs = createTabs(8);
    const setup = await testRender(
      <ReviewTabStrip
        activeTabId="tab-7"
        tabs={tabs}
        theme={resolveTheme("github-dark-default", null)}
        onAdd={() => undefined}
        onClose={() => undefined}
        onSelect={() => undefined}
      />,
      { width: 42, height: 2 },
    );

    try {
      await act(async () => {
        await setup.renderOnce();
        await Bun.sleep(20);
        await setup.renderOnce();
      });
      const frame = setup.captureCharFrame();
      expect(frame).toContain("● project-7-with-a-descriptiv…");
      expect(frame).not.toContain("project-0-with-a-descriptiv…");
    } finally {
      await act(async () => setup.renderer.destroy());
    }
  });
});
