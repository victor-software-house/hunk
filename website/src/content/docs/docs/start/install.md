---
title: Install
description: Install the VSH Hunk fork from GitHub Packages with Bun and verify the CLI.
---

The VSH fork publishes macOS arm64 and Linux x64 binaries through the scoped `@victor-software-house/hunk` package. GitHub Packages requires authentication even though the source repository is public.

## Configure Bun

Add the VSH scope once:

```toml
# ~/.bunfig.toml
[install.scopes]
"@victor-software-house" = { url = "https://npm.pkg.github.com", token = "$GITHUB_TOKEN" }
```

Export a GitHub token with `read:packages`, then install the current beta:

```bash
GITHUB_TOKEN="$(gh auth token)" bun add --global @victor-software-house/hunk@beta
hunk --version
```

The package exposes both `hunk` and `hunkdiff`; the docs use `hunk`.

## Verify the install

```bash
hunk --help
```

You should see `Usage: hunk <command> [options]`. If the shell cannot find Hunk, ensure `$(bun pm bin -g)` is on `PATH`, then open a new shell.

Next, [review your first working tree](/docs/start/quick-start/).
