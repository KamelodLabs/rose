# Branching model

Three long-lived branches with one-way promotions: work lands in `dev`, is validated in `staging`, and
only then reaches `main`. Production releases are tags on `main`. All three branches are protected on
the host; promotions happen through pull requests, never by pushing to a long-lived branch.

## Quick path

```powershell
git switch dev                     # integration branch (default working branch)
git switch -c feat/my-change       # branch from dev
# ...commit...
git push -u origin feat/my-change  # open a PR targeting dev
```

## Branch roles

| Branch    | Purpose                                   | Accepts merges from                       | Promotes to | Who pushes              |
| --------- | ----------------------------------------- | ----------------------------------------- | ----------- | ----------------------- |
| `dev`     | Integration of finished feature work      | `feat/*`, `fix/*`, `chore/*`, back-merges | `staging`   | PR only                 |
| `staging` | Pre-production validation / QA            | `promote/*` hybrids, back-merges          | `main`      | PR only                 |
| `main`    | Production-ready code, source of releases | `staging` PRs and `hotfix/*`              | tags only   | PR only, no direct push |

Short-lived branches:

| Prefix       | Use                            | Cut from                 | Merges into                             |
| ------------ | ------------------------------ | ------------------------ | --------------------------------------- |
| `feat/`      | New functionality              | `dev`                    | `dev` (squash)                          |
| `fix/`       | Non-urgent bug fix             | `dev`                    | `dev` (squash)                          |
| `chore/`     | Tooling, deps, docs, refactors | `dev`                    | `dev` (squash)                          |
| `promote/`   | Promotion hybrid branch        | `main`                   | `staging` (merge commit)                |
| `backmerge/` | Hotfix back-merge branch       | target long-lived branch | its base (merge commit)                 |
| `hotfix/`    | Urgent production fix          | `main`                   | `main` (merge commit), then back-merges |

## Flow

```text
feat/x ──PR (squash)──> dev ──promote/<name> PR (merge)──> staging ──PR (merge)──> main ──tag──> v1.2.3
hotfix/y ──PR──> main ──back-merge PRs──> staging ──back-merge PR──> dev
```

Rules that keep it honest:

1. **Promotions are one-way.** Never merge `staging` into `dev`. `main` reaches `staging` only through
   the `promote/<name>` hybrid PR and the explicit hotfix back-merge PRs.
2. **Squash into `dev`.** One feature branch becomes one reviewable commit.
3. **Merge commits for promotions and back-merges.** Never squash or rebase a promotion PR; the merge
   commit keeps the promoted batch traceable and preserves the ancestry the next promotion needs.
4. **No direct pushes to a long-lived branch.** Do not merge locally and push the result either; the
   host rejects the push, including for admins (`enforce_admins=true`).
5. **Releases are tags**, not branches: `vMAJOR.MINOR.PATCH` on `main`.
6. **Besides `promote/<name>` hybrids, hotfixes are the only branches cut from `main`; they return
   through PRs to `staging` and `dev`.

## Automated promotion

`pnpm promote <name>` prints the plan. `node docs/scripts/promote.mjs <name> --yes` executes it:
creates `promote/<name>` from `origin/main`, merges `origin/dev`, opens the staging PR, waits for
`js`/`go`, merges, opens `staging -> main`, waits, and merges. It refuses a dirty tree, a non-`dev`
branch, an empty `origin/main..origin/dev`, or unauthenticated `gh`. The manual procedure below is the
fallback.

## Promotion procedure

A direct `dev -> staging` PR does not work after the first promotion. `staging` gains a merge commit
that `dev` does not have, so the PR is **BEHIND**. `gh pr update-branch` cannot fix it either: it would
push a merge into `dev`, and `dev` is protected, so GitHub fails with
`Changes must be made through a pull request`. The same applies to a direct `staging -> main` PR after a
promotion, because `main` gains a promotion merge commit that `staging` does not have.

The fix is a short-lived **hybrid promotion branch**:

```powershell
git fetch origin

# 1. Start from main, then bring dev in. The branch now contains both tips.
git switch -c promote/<name> origin/main
git merge --no-ff origin/dev
git push -u origin promote/<name>

# 2. PR into staging. Merge commit, not squash or rebase.
gh pr create --base staging --head promote/<name> --title "promote: <name>"
gh pr merge --merge --delete-branch

# 3. PR staging -> main. staging now contains main, so strict passes.
gh pr create --base main --head staging --title "release: <name>"
gh pr merge --merge

# 4. Tag the release on main when you want to ship it.
git switch main
git pull
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

Wait for `js` and `go` to pass on each PR before running `gh pr merge`; the merge fails while required
checks are pending.

Why it works: the hybrid branch starts at `origin/main` and merges `origin/dev`, so between the two it
contains `staging` — after a promotion `main` contains `staging`; after a hotfix, the back-merge put
`staging` into `dev`. The `promote/<name> -> staging` PR is therefore up to date and passes
`strict=true`. That merge puts `main` into `staging`, so the `staging -> main` PR is up to date too.
Both moves happen on the host through `gh pr merge`; nothing is pushed to `staging` or `main` locally.

## Hotfix procedure

```powershell
git fetch origin
git switch -c hotfix/<name> origin/main
# ...fix and commit...
git push -u origin hotfix/<name>
gh pr create --base main --head hotfix/<name> --title "fix: <name>"
gh pr merge --merge

# Back-merge main -> staging (PR, merge commit).
git switch -c backmerge/main-to-staging origin/staging
git merge --no-ff origin/main
git push -u origin backmerge/main-to-staging
gh pr create --base staging --head backmerge/main-to-staging
gh pr merge --merge

# Back-merge staging -> dev (PR, merge commit).
git switch -c backmerge/staging-to-dev origin/dev
git merge --no-ff origin/staging
git push -u origin backmerge/staging-to-dev
gh pr create --base dev --head backmerge/staging-to-dev
gh pr merge --merge
```

No step pushes or merges directly into `main`, `staging`, or `dev`; the host applies each change
through its PR. Finish both back-merges before the next promotion: they are what keeps the hybrid
branch containing `staging`.

## Local commands

```powershell
# Sync your long-lived branches (read-only pulls are fine).
git switch dev;     git pull
git switch staging; git pull
git switch main;    git pull

# Start work.
git switch dev; git pull
git switch -c feat/my-change

# Release tags (tags are not protected branches).
git switch main; git pull
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

## Host-side protection

The rules live in GitHub, not in the repository. All three long-lived branches are configured the same
way:

| Setting                                   | `dev`               | `staging`           | `main`              |
| ----------------------------------------- | ------------------- | ------------------- | ------------------- |
| Direct push (incl. local merge then push) | No                  | No                  | No                  |
| Require pull request                      | Yes                 | Yes                 | Yes                 |
| Required approvals                        | 0 (solo)            | 0 (solo)            | 0 (solo)            |
| Required status checks                    | `js`, `go`          | `js`, `go`          | `js`, `go`          |
| Require branches up to date               | Yes (`strict=true`) | Yes (`strict=true`) | Yes (`strict=true`) |
| Enforce for admins                        | Yes                 | Yes                 | Yes                 |
| Require conversation resolution           | Yes                 | Yes                 | Yes                 |
| Block force push                          | Yes                 | Yes                 | Yes                 |
| Restrict deletions                        | Yes                 | Yes                 | Yes                 |
| GitHub environments                       | None                | None                | None                |
| Linear history                            | Off                 | Off                 | Off                 |

CI runs on pull requests into all three branches and on pushes to `main`. The two required checks are
the jobs in `.github/workflows/ci.yml`:

- `js` — Prettier, lint, type-check, tests (web/mobile), quality gates, and the web build.
- `go` — `go vet`, gocyclo, `go test -race`, and `go build`.

There are **no GitHub environments** and no required deployment gates; promotions are controlled by
branch protection alone.

Two practical notes:

- **Solo maintainer:** GitHub does not let you approve your own pull request. Required approvals are 0
  on all branches; raise it only when a second reviewer exists.
- **Plan limits:** branch protection and rulesets are free on public repositories. Private repositories
  need a paid plan. If protection is unavailable, the model still works by convention; do not pretend
  it is enforced.

## Checklist

- [ ] `dev`, `staging`, and `main` exist and are protected on the host.
- [ ] Every change reaches `main` through `staging`, except documented hotfixes.
- [ ] Promotions use `pnpm promote` (or the manual `promote/<name>` hybrid branch) and merge commits.
- [ ] Hotfixes return through back-merge PRs to `staging` and `dev`.
- [ ] Releases are annotated tags on `main`.

## Next step

Back to the index: [README.md](./README.md).
