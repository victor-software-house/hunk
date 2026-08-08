import type { ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useMemo, useRef } from "react";
import type { ReviewTab } from "../../../app/reviewTabs";
import { sanitizeTerminalLine } from "../../../lib/terminalText";
import type { AppTheme } from "../../themes/types";
import { measureTextWidth } from "../../lib/text";

const MAX_VISIBLE_TAB_NAME_CODE_POINTS = 28;

function visibleTabName(name: string) {
  const sanitized = sanitizeTerminalLine(name);
  const points = [...sanitized];
  return points.length <= MAX_VISIBLE_TAB_NAME_CODE_POINTS
    ? sanitized
    : `${points.slice(0, MAX_VISIBLE_TAB_NAME_CODE_POINTS - 1).join("")}…`;
}

function tabRowId(tabId: string) {
  return `review-tab-${tabId}`;
}

/** Render a horizontally scrollable tab strip that always reveals the active review. */
export function ReviewTabStrip({
  activeTabId,
  tabs,
  theme,
  onAdd,
  onClose,
  onSelect,
}: {
  activeTabId: string;
  tabs: readonly ReviewTab[];
  theme: AppTheme;
  onAdd: () => void;
  onClose: (tabId: string) => void;
  onSelect: (tabId: string) => void;
}) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const labels = useMemo(
    () => tabs.map((tab) => ({ tab, label: visibleTabName(tab.name) })),
    [tabs],
  );

  useEffect(() => {
    const reveal = () => scrollRef.current?.scrollChildIntoView(tabRowId(activeTabId));
    reveal();
    const afterLayout = setTimeout(reveal, 0);
    return () => clearTimeout(afterLayout);
  }, [activeTabId, labels]);

  return (
    <scrollbox
      ref={scrollRef}
      width="100%"
      height={1}
      focused={false}
      scrollX={true}
      scrollY={false}
      viewportCulling={true}
      rootOptions={{ backgroundColor: theme.panel }}
      wrapperOptions={{ backgroundColor: theme.panel }}
      viewportOptions={{ backgroundColor: theme.panel }}
      contentOptions={{ backgroundColor: theme.panel, flexDirection: "row" }}
      horizontalScrollbarOptions={{ visible: false }}
      verticalScrollbarOptions={{ visible: false }}
    >
      <box
        id="review-tab-add"
        style={{ width: 4, height: 1, paddingLeft: 1, backgroundColor: theme.panel }}
        onMouseUp={onAdd}
      >
        <text fg={theme.accent}>＋</text>
      </box>
      {labels.map(({ tab, label }) => {
        const selected = tab.tabId === activeTabId;
        return (
          <box
            id={tabRowId(tab.tabId)}
            key={tab.tabId}
            style={{
              width: measureTextWidth(label) + (tabs.length > 1 ? 6 : 4),
              height: 1,
              paddingLeft: 1,
              paddingRight: 1,
              backgroundColor: selected ? theme.accentMuted : theme.panel,
              flexDirection: "row",
            }}
            onMouseUp={() => onSelect(tab.tabId)}
          >
            <text fg={selected ? theme.text : theme.muted}>
              {selected ? "● " : "  "}
              {label}
            </text>
            {tabs.length > 1 ? (
              <box
                style={{ width: 2, height: 1, paddingLeft: 1 }}
                onMouseUp={(event) => {
                  event.stopPropagation();
                  onClose(tab.tabId);
                }}
              >
                <text fg={theme.muted}>×</text>
              </box>
            ) : null}
          </box>
        );
      })}
    </scrollbox>
  );
}
