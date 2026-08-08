# VSH Hunk Fork

This repository is the public `victor-software-house/hunk` downstream of `modem-dev/hunk`.

## Remotes and branch

- `origin` is the VSH publication authority.
- `upstream` is the fetch-only canonical source; its push URL stays `DISABLED`.
- The current audited stack predates the stable-release-only decision; every future upstream intake uses stable release merges, not rebases.
- Package releases, scoped tags, and GitHub Releases belong only to `victor-software-house/hunk`.

## Patch stack

The generated [PATCHES.md](PATCHES.md) records the ordered downstream concerns:

1. bounded review history and range APIs;
2. independent named project reviews;
3. Files/History navigation;
4. VSH package identity and distribution;
5. Forkctl policy and generated evidence.

Every downstream change starts in an explicit active patch. Source behavior belongs in the owning source patch; VSH release and repository policy belongs in `vsh-distribution`; manifest, generated evidence, and Forkctl integration belongs in `fork-tooling`.

```sh
mise run fork status
mise run fork check
mise run fork patch create NAME --kind source --purpose "..." --upstream-status "..." --drop-when "..." --scope 'path/**'
git add <owned paths>
mise run fork check -s
mise run fork patch refresh
mise run fork patch finish
```

Do not create ordinary downstream commits, manually edit `patches/fork.yaml`, `PATCHES.md`, or `patches/downstream/`, run plain Git rebase, or force-push `main`.

## Upstream updates

**Operator decision (2026-08-09): only integrate the latest stable upstream GitHub Release tag. Never use unreleased `upstream/main`, and do not rebase or rewrite downstream history for routine upstream intake.**

1. Read the upstream GitHub Release and verify its tag resolves to the intended commit.
2. Fetch that exact tag.
3. Merge the stable release into downstream `main`.
4. Resolve each conflict deliberately, preserving documented downstream intent and the complete released upstream behavior.
5. Run `mise run fork check`, `mise run verify`, and `mise run verify:terminal`.
6. Publish through the normal reviewed downstream path without rewriting prior history.

Forkctl's current upstream-update primitive is rebase-based. If it cannot represent this merge workflow, stop and evolve or retire the Forkctl contract; never rewrite history merely to satisfy the tool.

## Verification

```sh
mise run fork check
mise run verify
mise run verify:terminal
```

Release candidates additionally require package staging, exact-version GitHub Packages smoke, tag verification, and GitHub Release verification through the repository workflows.
