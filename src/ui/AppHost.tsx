import { useTerminalDimensions } from "@opentui/react";
import { resolve } from "node:path";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  addReviewTab,
  closeReviewTab,
  createReviewTabsState,
  defaultReviewTabName,
  renameReviewTab,
  replaceReviewTabBootstrap,
  selectReviewTab,
  type ReviewTab,
  type ReviewTabsState,
} from "../app/reviewTabs";
import { loadConfiguredSessionBootstrap } from "../app/sessionBootstrap";
import { resolveConfiguredCliInput } from "../core/config";
import { normalizeReviewTabName } from "../core/reviewTabName";
import type { StartupNotice } from "../core/startupNotice";
import { resolveRuntimeCliInput } from "../core/terminal";
import type { AppBootstrap, CliInput, PersistedViewPreferences } from "../core/types";
import { createUnknownVcsNotice, reportExtensionApplyIssues } from "../extensions/apply";
import { loadStartupExtensions } from "../extensions/startup";
import type { HunkSessionAppBridge } from "../session/app/bridge";
import {
  buildInitialReviewTabState,
  buildReviewTabInfo,
  createInitialSessionSnapshot,
  createSessionRegistration,
} from "../session/app/registration";
import type {
  ClosedReviewTabResult,
  HunkReviewTabState,
  HunkSessionBrokerClient,
  HunkSessionRegistration,
  HunkSessionServerMessage,
  HunkSessionSnapshot,
  MutatedReviewTabResult,
} from "../session/types";
import { NewReviewTabDialog } from "./components/chrome/NewReviewTabDialog";
import { ReviewTabHost } from "./ReviewTabHost";
import { ReviewTabStrip } from "./components/chrome/ReviewTabStrip";
import { resolveTheme } from "./themes";
import type { AppTheme } from "./themes/types";
import type { HunkSessionBinding } from "./hooks/useHunkSessionBridge";
import type { WatchedInputRuntime } from "./hooks/useWatchedInput";

function summarizeReviewTab(sessionId: string, state: ReviewTabsState, tab: ReviewTab) {
  const result: MutatedReviewTabResult = {
    sessionId,
    activeTabId: state.activeTabId,
    tab: {
      tabId: tab.tabId,
      name: tab.name,
      cwd: tab.cwd,
      repoRoot: tab.bootstrap.reloadContext.repoRoot,
      inputKind: tab.bootstrap.input.kind,
      title: tab.bootstrap.changeset.title,
      sourceLabel: tab.bootstrap.changeset.sourceLabel,
      fileCount: tab.bootstrap.changeset.files.length,
    },
  };
  return result;
}

function resolveReviewTab(state: ReviewTabsState, selector: string) {
  const byId = state.tabs.find((tab) => tab.tabId === selector);
  if (byId) return byId;

  let name: string;
  try {
    name = normalizeReviewTabName(selector);
  } catch {
    throw new Error(`Unknown review tab: ${selector}`);
  }
  const byName = state.tabs.find((tab) => tab.name === name);
  if (!byName) throw new Error(`Unknown review tab: ${selector}`);
  return byName;
}

function resolveInitialSharedViewPreferences(bootstrap: AppBootstrap): PersistedViewPreferences {
  return {
    mode: bootstrap.initialMode,
    theme: resolveTheme(
      bootstrap.initialTheme,
      bootstrap.initialThemeMode ?? null,
      bootstrap.customThemes,
    ).id,
    showLineNumbers: bootstrap.initialShowLineNumbers ?? true,
    wrapLines: bootstrap.initialWrapLines ?? false,
    showHunkHeaders: bootstrap.initialShowHunkHeaders ?? true,
    showMenuBar: bootstrap.initialShowMenuBar ?? true,
    showAgentNotes: bootstrap.initialShowAgentNotes ?? false,
    copyDecorations: bootstrap.initialCopyDecorations ?? false,
    cursorLine: bootstrap.initialCursorLine ?? "row",
  };
}

function sameViewPreferences(left: PersistedViewPreferences, right: PersistedViewPreferences) {
  return (
    left.mode === right.mode &&
    left.theme === right.theme &&
    left.showLineNumbers === right.showLineNumbers &&
    left.wrapLines === right.wrapLines &&
    left.showHunkHeaders === right.showHunkHeaders &&
    left.showMenuBar === right.showMenuBar &&
    left.showAgentNotes === right.showAgentNotes &&
    left.copyDecorations === right.copyDecorations &&
    left.cursorLine === right.cursorLine
  );
}

/** Own one Hunk process, its ordered review tabs, and the active app bridge. */
export function AppHost({
  bootstrap,
  hostClient,
  onQuit = () => process.exit(0),
  startupNoticeResolver,
  watchRuntime,
}: {
  bootstrap: AppBootstrap;
  hostClient?: HunkSessionBrokerClient;
  onQuit?: () => void;
  startupNoticeResolver?: () => Promise<StartupNotice | null>;
  watchRuntime?: WatchedInputRuntime;
}) {
  const [initialRegistration] = useState(() => {
    const registered = hostClient?.getRegistration();
    if (registered?.info) return registered;
    const created = createSessionRegistration(bootstrap);
    return registered?.sessionId ? { ...created, sessionId: registered.sessionId } : created;
  });
  const initialTabId = initialRegistration.info.activeTabId;
  const registrationRef = useRef(initialRegistration);
  const [tabsState, setTabsState] = useState(() =>
    createReviewTabsState({
      tabId: initialTabId,
      name: defaultReviewTabName(bootstrap),
      cwd: bootstrap.reloadContext.cwd,
      bootstrap,
    }),
  );
  const [newTabDialogOpen, setNewTabDialogOpen] = useState(false);
  const [newTabFocus, setNewTabFocus] = useState(0);
  const [newTabValues, setNewTabValues] = useState<[string, string, string]>(["", "", ""]);
  const [newTabError, setNewTabError] = useState<string>();
  const terminal = useTerminalDimensions();
  const tabsStateRef = useRef(tabsState);
  tabsStateRef.current = tabsState;
  const snapshotsRef = useRef(
    new Map<string, HunkReviewTabState>([
      [initialTabId, createInitialSessionSnapshot(bootstrap, initialTabId).state.tabs[0]!],
    ]),
  );
  const bridgesRef = useRef(new Map<string, HunkSessionAppBridge>());
  const bindingsRef = useRef(new Map<string, HunkSessionBinding>());
  const shutdownsRef = useRef(new Map<string, () => Promise<void>>());
  const launchExperimental = bootstrap.input.options.experimental === true;
  const launchExtensionsEnabled = bootstrap.input.options.extensions;
  const launchExtensionPaths = bootstrap.input.options.extensionPaths;
  const sessionId = initialRegistration.sessionId;
  const [sharedViewPreferences, setSharedViewPreferences] = useState(() =>
    resolveInitialSharedViewPreferences(bootstrap),
  );
  const [processTheme, setProcessTheme] = useState<AppTheme>(() =>
    resolveTheme(
      sharedViewPreferences.theme,
      bootstrap.initialThemeMode ?? null,
      bootstrap.customThemes,
    ),
  );

  const buildSnapshot = useCallback((state: ReviewTabsState): HunkSessionSnapshot => {
    const tabs = state.tabs.map((tab) => {
      const snapshot = snapshotsRef.current.get(tab.tabId);
      if (!snapshot) throw new Error(`Review tab snapshot is missing: ${tab.tabId}`);
      return snapshot;
    });
    return { updatedAt: new Date().toISOString(), state: { activeTabId: state.activeTabId, tabs } };
  }, []);

  const buildRegistration = useCallback((state: ReviewTabsState): HunkSessionRegistration => {
    return {
      ...registrationRef.current,
      info: {
        activeTabId: state.activeTabId,
        tabs: state.tabs.map((tab) =>
          buildReviewTabInfo(tab.bootstrap, {
            tabId: tab.tabId,
            name: tab.name,
            cwd: tab.cwd,
          }),
        ),
      },
    };
  }, []);

  const publishState = useCallback(
    (state: ReviewTabsState, registrationChanged: boolean) => {
      if (!hostClient) return;
      const snapshot = buildSnapshot(state);
      if (registrationChanged) {
        const registration = buildRegistration(state);
        registrationRef.current = registration;
        hostClient.replaceSession(registration, snapshot);
      } else {
        hostClient.updateSnapshot(snapshot);
      }
    },
    [buildRegistration, buildSnapshot, hostClient],
  );

  const commitTabsState = useCallback(
    (state: ReviewTabsState, registrationChanged: boolean) => {
      tabsStateRef.current = state;
      setTabsState(state);
      publishState(state, registrationChanged);
    },
    [publishState],
  );

  const loadNewTab = useCallback(
    async (input: CliInput, sourcePath: string): Promise<AppBootstrap> => {
      const cwd = resolve(sourcePath);
      const runtimeInput = resolveRuntimeCliInput({
        ...input,
        options: {
          ...input.options,
          experimental: launchExperimental,
          extensions: launchExtensionsEnabled,
          extensionPaths: launchExtensionPaths,
        },
      });
      const configured = resolveConfiguredCliInput(runtimeInput, { cwd });
      const extensions = await loadStartupExtensions({
        extensions: configured.extensions,
        cwd,
        cliExtensionPaths: configured.input.options.extensionPaths,
      });
      const loaded = await loadConfiguredSessionBootstrap({
        configured,
        cwd,
        extensions,
        loadAtCwd: true,
      });
      reportExtensionApplyIssues(loaded.applied.issues, extensions.context);
      loaded.bootstrap.startupNotices =
        loaded.sessionVcs.unknownVcsId === undefined
          ? configured.startupNotices
          : [
              ...(configured.startupNotices ?? []),
              createUnknownVcsNotice(
                loaded.sessionVcs.unknownVcsId,
                String(loaded.input.options.vcs),
              ),
            ];
      return loaded.bootstrap;
    },
    [launchExperimental, launchExtensionsEnabled, launchExtensionPaths],
  );

  const onBridge = useCallback((tabId: string, bridge: HunkSessionAppBridge | null) => {
    if (bridge) bridgesRef.current.set(tabId, bridge);
    else bridgesRef.current.delete(tabId);
  }, []);

  const onRegisterShutdown = useCallback(
    (tabId: string, shutdown: (() => Promise<void>) | null) => {
      if (shutdown) shutdownsRef.current.set(tabId, shutdown);
      else shutdownsRef.current.delete(tabId);
    },
    [],
  );

  /** Give every mounted tab a bounded extension-shutdown window before exiting. */
  const quitAllTabs = useCallback(() => {
    void Promise.all([...shutdownsRef.current.values()].map((shutdown) => shutdown())).finally(
      onQuit,
    );
  }, [onQuit]);

  const onSnapshot = useCallback(
    (snapshot: HunkReviewTabState) => {
      snapshotsRef.current.set(snapshot.tabId, snapshot);
      publishState(tabsStateRef.current, false);
    },
    [publishState],
  );

  const getSessionBinding = useCallback(
    (tabId: string): HunkSessionBinding => {
      const existing = bindingsRef.current.get(tabId);
      if (existing) return existing;
      const binding = { tabId, onBridge, onSnapshot };
      bindingsRef.current.set(tabId, binding);
      return binding;
    },
    [onBridge, onSnapshot],
  );

  const addTab = useCallback(
    async (name: string, sourcePath: string, input: CliInput) => {
      const nextBootstrap = await loadNewTab(input, sourcePath);
      const next = addReviewTab(tabsStateRef.current, {
        name,
        cwd: nextBootstrap.reloadContext.cwd,
        bootstrap: nextBootstrap,
      });
      const added = next.tabs.at(-1)!;
      snapshotsRef.current.set(added.tabId, buildInitialReviewTabState(nextBootstrap, added.tabId));
      commitTabsState(next, true);
      return summarizeReviewTab(sessionId, next, added);
    },
    [commitTabsState, loadNewTab, sessionId],
  );

  const openNewTabDialog = useCallback(() => {
    setNewTabValues(["", "", ""]);
    setNewTabFocus(0);
    setNewTabError(undefined);
    setNewTabDialogOpen(true);
  }, []);

  const submitNewTab = useCallback(() => {
    const [name, sourcePath, range] = newTabValues;
    if (!name.trim() || !sourcePath.trim()) {
      setNewTabError("Name and project directory are required.");
      return;
    }
    const input: CliInput = {
      kind: "vcs",
      staged: false,
      ...(range.trim() ? { range: range.trim() } : {}),
      options: {},
    };
    void addTab(name, sourcePath, input)
      .then(() => setNewTabDialogOpen(false))
      .catch((error) => setNewTabError(error instanceof Error ? error.message : String(error)));
  }, [addTab, newTabValues]);

  const editNewTabValue = useCallback(
    (update: (value: string) => string) => {
      setNewTabError(undefined);
      setNewTabValues((current) => {
        const next: [string, string, string] = [...current];
        next[newTabFocus] = update(next[newTabFocus] ?? "");
        return next;
      });
    },
    [newTabFocus],
  );

  const onReloaded = useCallback(
    (tabId: string, nextBootstrap: AppBootstrap, snapshot: HunkSessionSnapshot) => {
      const current = tabsStateRef.current;
      const next = replaceReviewTabBootstrap(
        current,
        tabId,
        nextBootstrap,
        nextBootstrap.reloadContext.cwd,
      );
      const tabState = snapshot.state.tabs.find((tab) => tab.tabId === tabId);
      if (!tabState) throw new Error(`Reloaded review tab snapshot is missing: ${tabId}`);
      snapshotsRef.current.set(tabId, tabState);
      commitTabsState(next, true);
    },
    [commitTabsState],
  );

  const closeTab = useCallback(
    (tabId: string): ClosedReviewTabResult => {
      const current = tabsStateRef.current;
      const next = closeReviewTab(current, tabId);
      snapshotsRef.current.delete(tabId);
      bridgesRef.current.delete(tabId);
      bindingsRef.current.delete(tabId);
      void shutdownsRef.current.get(tabId)?.();
      shutdownsRef.current.delete(tabId);
      commitTabsState(next, true);
      const active = next.tabs.find((tab) => tab.tabId === next.activeTabId)!;
      return {
        sessionId,
        activeTabId: next.activeTabId,
        closedTabId: tabId,
        activeTab: summarizeReviewTab(sessionId, next, active).tab,
      };
    },
    [commitTabsState, sessionId],
  );

  useEffect(() => {
    if (!hostClient) return;

    hostClient.setBridge({
      dispatchCommand: async (message: HunkSessionServerMessage) => {
        const current = tabsStateRef.current;
        switch (message.command) {
          case "add_review_tab": {
            return addTab(message.input.name, message.input.sourcePath, message.input.input);
          }
          case "select_review_tab": {
            const selected = resolveReviewTab(current, message.input.tab);
            const next = selectReviewTab(current, selected.tabId);
            commitTabsState(next, true);
            return summarizeReviewTab(sessionId, next, selected);
          }
          case "rename_review_tab": {
            const selected = resolveReviewTab(current, message.input.tab);
            const next = renameReviewTab(current, selected.tabId, message.input.name);
            const renamed = next.tabs.find((tab) => tab.tabId === selected.tabId)!;
            commitTabsState(next, true);
            return summarizeReviewTab(sessionId, next, renamed);
          }
          case "close_review_tab": {
            const selected = resolveReviewTab(current, message.input.tab);
            return closeTab(selected.tabId);
          }
          default: {
            const bridge = bridgesRef.current.get(current.activeTabId);
            if (!bridge) throw new Error(`Active review tab is not ready: ${current.activeTabId}`);
            return bridge.dispatchCommand(message);
          }
        }
      },
    });
    return () => hostClient.setBridge(null);
  }, [addTab, closeTab, commitTabsState, hostClient, sessionId]);

  const selectTab = useCallback(
    (tabId: string) => {
      commitTabsState(selectReviewTab(tabsStateRef.current, tabId), true);
    },
    [commitTabsState],
  );
  const updateSharedViewPreferences = useCallback((next: PersistedViewPreferences) => {
    setSharedViewPreferences((current) => (sameViewPreferences(current, next) ? current : next));
  }, []);
  const updateProcessTheme = useCallback((next: AppTheme) => {
    setProcessTheme((current) =>
      current.id === next.id &&
      current.background === next.background &&
      current.panel === next.panel &&
      current.accentMuted === next.accentMuted
        ? current
        : next,
    );
  }, []);

  return (
    <box style={{ width: "100%", height: "100%" }}>
      <box style={{ width: "100%", height: "100%" }}>
        {tabsState.tabs.map((tab) => {
          return (
            <ReviewTabHost
              active={tab.tabId === tabsState.activeTabId}
              bootstrap={tab.bootstrap}
              interactive={tab.tabId === tabsState.activeTabId && !newTabDialogOpen}
              key={tab.tabId}
              onOpenNewReviewTab={openNewTabDialog}
              onQuit={quitAllTabs}
              onRegisterShutdown={onRegisterShutdown}
              onReloaded={onReloaded}
              sharedViewPreferences={sharedViewPreferences}
              onSharedViewPreferencesChange={updateSharedViewPreferences}
              onActiveThemeChange={updateProcessTheme}
              reviewTabs={
                <ReviewTabStrip
                  activeTabId={tabsState.activeTabId}
                  tabs={tabsState.tabs}
                  theme={processTheme}
                  onAdd={openNewTabDialog}
                  onClose={closeTab}
                  onSelect={selectTab}
                />
              }
              sessionBinding={getSessionBinding(tab.tabId)}
              sessionId={sessionId}
              startupNoticeResolver={startupNoticeResolver}
              watchRuntime={watchRuntime}
            />
          );
        })}
      </box>
      {newTabDialogOpen ? (
        <NewReviewTabDialog
          error={newTabError}
          focusIndex={newTabFocus}
          terminalHeight={terminal.height}
          terminalWidth={terminal.width}
          theme={processTheme}
          values={newTabValues}
          onBackspace={() => editNewTabValue((value) => [...value].slice(0, -1).join(""))}
          onClose={() => setNewTabDialogOpen(false)}
          onMoveFocus={(delta) => setNewTabFocus((index) => (index + delta + 3) % 3)}
          onSubmit={() => {
            if (newTabFocus < 2) setNewTabFocus(newTabFocus + 1);
            else submitNewTab();
          }}
          onText={(text) => editNewTabValue((value) => value + text)}
        />
      ) : null}
    </box>
  );
}
