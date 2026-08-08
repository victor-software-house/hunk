---
title: Live session control
description: Inspect, target, navigate, and reload Hunk windows through the local session broker.
---

Each normal Hunk TUI registers one process session with the loopback daemon. A process owns ordered `tabs[]` plus `activeTabId`; each tab keeps its own project, exact review input, files, selection, filters, notes, dialogs, and watcher. `hunk session ...` finds a registered process and sends review actions to its active tab.

## Find the session

```bash
hunk session list
hunk session get --repo .
hunk session context --repo .
```

Use `--repo <path>` to match the active tab's repository. Use `--session-path <path>` or an explicit session ID to identify a process independently of whichever project tab is active.

## Inspect without overloading context

```bash
hunk session review --repo . --json
```

This returns files and hunks. Add flags only when required:

```bash
hunk session review --repo . --include-notes --json
hunk session review --repo . --include-patch --json
```

## Navigate the visible window

```bash
hunk session navigate --repo . --file src/App.tsx --hunk 2
hunk session navigate --repo . --file src/App.tsx --new-line 372
hunk session navigate --repo . --next-comment
```

Hunk numbers are 1-based. Absolute navigation needs a file and exactly one hunk, old-line, or new-line target.

## Reload the review

Always place `--` before the nested Hunk command:

```bash
hunk session reload --repo . -- diff
hunk session reload --repo . -- show HEAD~1 -- README.md
```

Advanced reloads can target the live window by `--session-path` and load from a separate `--source` directory. Prefer `--repo` until those roles genuinely need to differ.

## Manage project review tabs

Create and activate a named tab by selecting its project directory and complete Hunk review command:

```bash
hunk session tab add <session-id> --name "api" --source /path/to/api -- diff main...feature
hunk session tab add --session-path /path/to/hunk-window --name "release" --source /path/to/app -- show v2.0.0
```

Then target a stable tab ID or unique name:

```bash
hunk session tab select <session-id> --tab api
hunk session tab rename <session-id> --tab api --name backend
hunk session tab close <session-id> --tab backend
```

The TUI's `＋` tab action (or `Ctrl-T`) opens the same project/range creation flow. The tab strip scrolls horizontally and always reveals the active tab. Ordinary navigation, reload, and comment commands act only on the active tab.

## Diagnose local access

If a visible Hunk window does not appear in `session list`, an agent sandbox may block loopback access. Hunk's daemon is intentionally local-only; retry with the agent's network/sandbox permission rather than exposing it remotely. `hunk daemon serve` is available for manual startup or daemon debugging.
