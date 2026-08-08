# VSH Hunk Fork

This repository is the public `victor-software-house/hunk` downstream of `modem-dev/hunk`.

## Remotes and branch

- `origin` is the VSH publication authority.
- `upstream` is the fetch-only canonical source; its push URL stays `DISABLED`.
- `main` is an audited Forkctl/StGit patch stack over `upstream/main`.
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

```sh
git fetch upstream main
mise run fork rebase --onto refs/heads/main --dry-run
mise run fork rebase --onto refs/heads/main
mise run fork operation status
```

Review Forkctl's range-diff, dropped-patch history, and path-change evidence. Then run Hunk's full verification gates. `mise run fork publish` is a separate exact-lease atomic publication step and requires explicit operator approval.

## Verification

```sh
mise run fork check
mise run verify
mise run verify:terminal
```

Release candidates additionally require package staging, exact-version GitHub Packages smoke, tag verification, and GitHub Release verification through the repository workflows.
