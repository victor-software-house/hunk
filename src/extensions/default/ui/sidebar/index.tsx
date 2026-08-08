import type { KeyEvent, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  ExtensionReviewHistory,
  ExtensionSidebarViewProps,
} from "../../../../extension-api/types";
import { sidebarEntryStatsWidth } from "../../../../ui/lib/files";
import { FileGroupHeader, FileListItem } from "../../../../ui/components/panes/FileListItem";
import { HUNK_VENDOR_EXTENSION_ID } from "../../../extensionIds";
import { runExtensionFactory } from "../../../runExtension";
import {
  createEmptyExtensionRegistry,
  type ExtensionFactory,
  type ExtensionLoadIssue,
  type RegisteredSidebarView,
} from "../../../types";
import { buildSidebarFileTree } from "../../../../ui/lib/sidebarFileTree";
import { fitText } from "../../../../ui/lib/text";

/**
 * Hunk's file-navigation sidebar, shipped as a bundled extension.
 *
 * Like the Git backend, the built-in sidebar registers through the public API —
 * `registerSidebarView` — and its component consumes exactly the published
 * `ExtensionSidebarViewProps`: the frozen file views for its entries, the theme
 * token slice for its colors, `actions.selectFile` for navigation, and the
 * host-served `@opentui/react` for its hooks. That is what keeps the sidebar
 * contract honest: anything this pane needs that the props cannot express is a
 * real gap in what third-party sidebars can build.
 *
 * Unlike the VCS tier this module is UI code, so it is deliberately *not* part
 * of `loadBundledExtensions` — that list is imported from VCS adapter
 * resolution, which must stay renderer-free. The sidebar instead loads through
 * `getBundledSidebarView` at the one place the app resolves its active sidebar.
 * Rendering helpers (row components, the render window) are imported from Hunk
 * directly: this is host code, and the dogfooding boundary is the data,
 * actions, and theme crossing the props — not utility code.
 *
 * The scrollbox usage below is itself part of the published contract: the ref
 * reads (`scrollTop`, `viewport.height`), the scrollbar/viewport change
 * events, and `scrollChildIntoView` over child `id` props are documented in
 * docs/extensions.md as the supported way third-party sidebars scroll and
 * follow the selection. Changing how this component talks to its scrollbox
 * means updating that contract — same honesty mechanism as the props.
 */

/**
 * The bundled sidebar registers under Hunk's vendor id, not under `sidebar`.
 *
 * View keys are `<extensionId>:<viewId>`, and extension ids are file stems a
 * user picks, so `sidebar.ts` on disk would otherwise mint `sidebar:files` and
 * collide with this view. `hunk` is reserved at load, so this key cannot be
 * taken. The `sourcePath` below still names the module, since that is what it
 * describes.
 */
export const BUNDLED_SIDEBAR_EXTENSION_ID = HUNK_VENDOR_EXTENSION_ID;
export const BUNDLED_SIDEBAR_VIEW_ID = "files";

/** Render the built-in file navigation sidebar from the public sidebar props. */
export function BuiltInSidebarNavigator({
  active = true,
  files,
  selectedFileId,
  theme,
  width,
  actions,
  review,
  initialTab = "files",
}: ExtensionSidebarViewProps & { initialTab?: "files" | "history" }): ReactNode {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(() => new Set());
  // Mirrors the host layout: one column of row highlight plus row padding.
  const textWidth = Math.max(8, width - 2);
  const tree = useMemo(() => buildSidebarFileTree(files, collapsedPaths), [collapsedPaths, files]);
  const entries = tree.entries;
  const fileEntries = entries.filter((entry) => entry.kind === "file");
  const statsWidth = Math.max(0, ...fileEntries.map((entry) => sidebarEntryStatsWidth(entry)));

  const [activeTab, setActiveTab] = useState<"files" | "history">(initialTab);
  const [history, setHistory] = useState<ExtensionReviewHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [rangeBase, setRangeBase] = useState<string | null>(null);
  const [appliedRange, setAppliedRange] = useState<{ base: string; head: string } | null>(null);

  const historyRows = useMemo(
    () => [
      ...(history?.refs.map((ref) => ({
        key: `ref:${ref.kind}:${ref.name}`,
        target: ref.name,
        label: `${ref.current ? "*" : ref.kind === "branch" ? "b" : ref.kind === "remote" ? "r" : "t"} ${ref.name}`,
      })) ?? []),
      ...(history?.commits.map((commit) => ({
        key: `commit:${commit.id}`,
        target: commit.id,
        label: `${commit.id.slice(0, 7)} ${commit.subject}`,
      })) ?? []),
    ],
    [history],
  );
  const rangeBaseIndex = rangeBase ? historyRows.findIndex((row) => row.target === rangeBase) : -1;
  const appliedBaseIndex = appliedRange
    ? historyRows.findIndex((row) => row.target === appliedRange.base)
    : -1;
  const appliedHeadIndex = appliedRange
    ? historyRows.findIndex((row) => row.target === appliedRange.head)
    : -1;

  useEffect(() => {
    if (activeTab !== "history" || historyLoading || history || historyError) return;
    setHistoryLoading(true);
    void review.loadHistory().then((result) => {
      setHistoryLoading(false);
      if (result.ok) {
        setHistory(result.history);
        setHistoryIndex(0);
      } else {
        setHistoryError(result.detail);
      }
    });
  }, [activeTab, history, historyError, historyLoading, review]);

  const chooseHistoryTarget = async (target: string) => {
    if (!rangeBase) {
      setRangeBase(target);
      actions.notify(`Range base: ${target}`);
      return;
    }
    const range = `${rangeBase}...${target}`;
    const result = await review.setRange(range);
    if (!result.ok) actions.notify(result.detail, "warning");
    else setAppliedRange({ base: rangeBase, head: target });
    setRangeBase(null);
  };

  useKeyboard((key: KeyEvent) => {
    if (!active || key.defaultPrevented) return;
    const isRangeKey =
      key.name === "R" || (key.name.toLowerCase() === "r" && key.shift) || key.sequence === "R";
    if (isRangeKey) {
      key.preventDefault();
      key.stopPropagation();
      setActiveTab("history");
      setRangeBase(null);
      return;
    }
    if (activeTab !== "history") return;
    if (key.name === "escape") {
      key.preventDefault();
      key.stopPropagation();
      setActiveTab("files");
      return;
    }
    if (key.name === "up" || key.name === "down") {
      key.preventDefault();
      key.stopPropagation();
      const delta = key.name === "up" ? -1 : 1;
      setHistoryIndex((current) =>
        historyRows.length === 0 ? 0 : (current + delta + historyRows.length) % historyRows.length,
      );
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      const target = historyRows[historyIndex]?.target;
      if (!target) return;
      key.preventDefault();
      key.stopPropagation();
      void chooseHistoryTarget(target);
    }
  });

  // A selected file is never allowed to remain hidden under a collapsed ancestor.
  useEffect(() => {
    if (!selectedFileId) return;
    const ancestors = tree.ancestorsByFileId.get(selectedFileId);
    if (!ancestors?.some((path) => collapsedPaths.has(path))) return;
    setCollapsedPaths((current) => {
      const next = new Set(current);
      for (const path of ancestors) next.delete(path);
      return next;
    });
  }, [collapsedPaths, selectedFileId, tree.ancestorsByFileId]);

  const toggleDirectory = (path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // All lightweight file-tree rows stay mounted; OpenTUI owns viewport culling.
  // Reveal after OpenTUI has calculated final child geometry, not merely after
  // React committed the row nodes.
  useEffect(() => {
    if (!selectedFileId) return;
    const scrollBox = scrollRef.current;
    if (!scrollBox) return;
    const selectedIndex = entries.findIndex(
      (entry) => entry.kind === "file" && entry.id === selectedFileId,
    );
    if (selectedIndex < 0) return;

    let cancelled = false;
    const reveal = () => {
      queueMicrotask(() => {
        if (cancelled) return;
        const height = Math.max(1, scrollBox.viewport.height);
        const top = scrollBox.scrollTop;
        if (selectedIndex < top) scrollBox.scrollTop = selectedIndex;
        else if (selectedIndex >= top + height) scrollBox.scrollTop = selectedIndex - height + 1;
      });
    };
    reveal();
    scrollBox.viewport.on("layout-changed", reveal);
    scrollBox.viewport.on("resized", reveal);
    return () => {
      cancelled = true;
      scrollBox.viewport.off("layout-changed", reveal);
      scrollBox.viewport.off("resized", reveal);
    };
  }, [entries, selectedFileId]);

  return (
    <box style={{ width: "100%", height: "100%", flexDirection: "column" }}>
      <box style={{ width: "100%", height: 1, flexDirection: "row", backgroundColor: theme.panel }}>
        <box
          style={{
            width: 8,
            height: 1,
            paddingLeft: 1,
            backgroundColor: activeTab === "files" ? theme.panelAlt : theme.panel,
          }}
          onMouseUp={() => setActiveTab("files")}
        >
          <text fg={activeTab === "files" ? theme.accent : theme.muted}>Files</text>
        </box>
        <box
          style={{
            width: 10,
            height: 1,
            paddingLeft: 1,
            backgroundColor: activeTab === "history" ? theme.panelAlt : theme.panel,
          }}
          onMouseUp={() => setActiveTab("history")}
        >
          <text fg={activeTab === "history" ? theme.accent : theme.muted}>History</text>
        </box>
      </box>
      {activeTab === "files" ? (
        <scrollbox
          ref={scrollRef}
          width="100%"
          height="100%"
          focused={false}
          scrollY={true}
          viewportCulling={true}
          rootOptions={{ backgroundColor: theme.panel }}
          wrapperOptions={{ backgroundColor: theme.panel }}
          viewportOptions={{ backgroundColor: theme.panel }}
          contentOptions={{ backgroundColor: theme.panel }}
          verticalScrollbarOptions={{ visible: false }}
          horizontalScrollbarOptions={{ visible: false }}
        >
          <box style={{ width: "100%", flexDirection: "column" }}>
            {entries.map((entry) => {
              const depth = entry.depth ?? 0;
              return entry.kind === "group" ? (
                <FileGroupHeader
                  key={entry.id}
                  entry={entry}
                  paddingLeft={1 + depth * 2}
                  textWidth={Math.max(1, textWidth - depth * 2)}
                  theme={theme}
                  onToggle={toggleDirectory}
                />
              ) : (
                <FileListItem
                  key={entry.id}
                  entry={entry}
                  selected={entry.id === selectedFileId}
                  statsWidth={statsWidth}
                  paddingLeft={1 + depth * 2}
                  textWidth={Math.max(1, textWidth - depth * 2)}
                  theme={theme}
                  onSelectFile={actions.selectFile}
                />
              );
            })}
          </box>
        </scrollbox>
      ) : (
        <scrollbox
          width="100%"
          height="100%"
          scrollY={true}
          viewportCulling={true}
          rootOptions={{ backgroundColor: theme.panel }}
          wrapperOptions={{ backgroundColor: theme.panel }}
          viewportOptions={{ backgroundColor: theme.panel }}
          contentOptions={{ backgroundColor: theme.panel, flexDirection: "column" }}
          verticalScrollbarOptions={{ visible: false }}
          horizontalScrollbarOptions={{ visible: false }}
        >
          <text fg={theme.muted}>
            {rangeBase
              ? fitText(`Base ${rangeBase} · move to head · Enter apply · R reset`, textWidth)
              : "Choose base · Enter/click · Esc files"}
          </text>
          {historyLoading ? <text fg={theme.muted}>Loading history…</text> : null}
          {historyError ? (
            <text fg={theme.badgeRemoved}>{fitText(historyError, textWidth)}</text>
          ) : null}
          {historyRows.map((row, index) => {
            const current = index === historyIndex;
            const previewStart = Math.min(rangeBaseIndex, historyIndex);
            const previewEnd = Math.max(rangeBaseIndex, historyIndex);
            const previewed = rangeBaseIndex >= 0 && index >= previewStart && index <= previewEnd;
            const appliedStart = Math.min(appliedBaseIndex, appliedHeadIndex);
            const appliedEnd = Math.max(appliedBaseIndex, appliedHeadIndex);
            const applied =
              appliedBaseIndex >= 0 &&
              appliedHeadIndex >= 0 &&
              index >= appliedStart &&
              index <= appliedEnd;
            // A new preview temporarily supersedes the applied interval. Cancelling
            // or failing restores the last range because appliedRange is unchanged.
            const highlighted = rangeBaseIndex >= 0 ? previewed : applied;
            const base = index === (rangeBaseIndex >= 0 ? rangeBaseIndex : appliedBaseIndex);
            const head = index === (rangeBaseIndex >= 0 ? historyIndex : appliedHeadIndex);
            const marker = base ? "B" : head ? "H" : highlighted ? "│" : current ? "›" : " ";
            return (
              <box
                key={row.key}
                style={{
                  width: "100%",
                  height: 1,
                  paddingLeft: 1,
                  backgroundColor: highlighted
                    ? theme.selectedHunk
                    : current
                      ? theme.panelAlt
                      : theme.panel,
                }}
                onMouseOver={() => setHistoryIndex(index)}
                onMouseUp={() => {
                  setHistoryIndex(index);
                  void chooseHistoryTarget(row.target);
                }}
              >
                <text fg={base || head ? theme.accent : current ? theme.text : theme.muted}>
                  {fitText(`${marker} ${row.label}`, textWidth)}
                </text>
              </box>
            );
          })}
        </scrollbox>
      )}
    </box>
  );
}

/** Public-props wrapper registered as Hunk's bundled sidebar view. */
export function BuiltInSidebarView(props: ExtensionSidebarViewProps): ReactNode {
  return <BuiltInSidebarNavigator {...props} />;
}

/** The factory the bundled sidebar registers through, same as any extension. */
const registerBundledSidebar: ExtensionFactory = (hunk) => {
  hunk.registerSidebarView({ id: BUNDLED_SIDEBAR_VIEW_ID, component: BuiltInSidebarView });
};

export default registerBundledSidebar;

let cachedView: RegisteredSidebarView | undefined;

/**
 * Load the bundled sidebar registration, once per process.
 *
 * Runs the factory through `runExtensionFactory` — the same seal, validation,
 * and registry path user extensions take — and hands back the one registration
 * it produced. The app uses it as the default a user-registered sidebar view
 * overrides. A failure here is a Hunk bug, not an extension author's, so it
 * throws instead of degrading.
 */
export function getBundledSidebarView(): RegisteredSidebarView {
  if (cachedView) {
    return cachedView;
  }

  const registry = createEmptyExtensionRegistry();
  const issues: ExtensionLoadIssue[] = [];
  runExtensionFactory({
    metadata: {
      id: BUNDLED_SIDEBAR_EXTENSION_ID,
      sourcePath: "hunk:bundled/sidebar",
      origin: "bundled",
    },
    registry,
    issues,
    factory: registerBundledSidebar,
  });

  const view = registry.sidebarViews[0];
  if (issues.length > 0 || !view) {
    throw new Error(
      `Bundled sidebar failed to register: ${issues[0]?.message ?? "no view registered"}`,
    );
  }

  cachedView = view;
  return cachedView;
}
