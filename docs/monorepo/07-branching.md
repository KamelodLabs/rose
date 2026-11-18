# Branching model

Three long-lived branches with one-way promotions: work lands in `dev`, is validated in `staging`, and only
then reaches `main`. Production releases are tags on `main`.

## Quick path

```powershell
git switch dev                     # integration branch (default working branch)
git switch -c feat/my-change       # branch from dev
# ...commit...
git push -u origin feat/my-change  # open a PR targeting dev
```

## Branch roles

| Branch    | Purpose                                   | Accepts merges from          | Promotes to | Who pushes              |
| --------- | ----------------------------------------- | ---------------------------- | ----------- | ----------------------- |
| `dev`     | Integration of finished feature work      | `feat/*`, `fix/*`, `chore/*` | `staging`   | PR only                 |
| `staging` | Pre-production validation / QA            | `dev` (and back-merges)      | `main`      | PR only                 |
| `main`    | Production-ready code, source of releases | `staging` (and hotfixes)     | tags only   | PR only, no direct push |

Short-lived branches:

| Prefix    | Use                            | Cut from | Merges into |
| --------- | ------------------------------ | -------- | ----------- |
| `feat/`   | New functionality              | `dev`    | `dev`       |
| `fix/`    | Non-urgent bug fix             | `dev`    | `dev`       |
| `chore/`  | Tooling, deps, docs, refactors | `dev`    | `dev`       |
| `hotfix/` | Urgent production fix          | `main`   | `main`      |

## Flow

```text
feat/x ──PR──> dev ──PR──> staging ──PR──> main ──tag──> v1.2.3
                                     ▲
hotfix/y ──PR──> main ───────────────┘ then back-merge main -> staging -> dev
```

Rules that keep it honest:

1. **Promotions are one-way.** Never merge `staging` into `dev` or `main` into `staging` except for the
   explicit hotfix back-merge.
2. **Squash into `dev`.** One feature branch becomes one reviewable commit.
3. **Merge commits for promotions.** `dev -> staging -> main` uses `--no-ff` so the promoted batch stays
   traceable.
4. **No direct pushes** to any long-lived branch. Everything arrives through a PR/MR.
5. **Releases are tags**, not branches: `vMAJOR.MINOR.PATCH` on `main`.
6. **Hotfixes** are the only branches cut from `main`, and they must return to `dev` and `staging`
   afterwards.

## Local commands

```powershell
# Sync your long-lived branches
git switch dev;     git pull
git switch staging; git pull
git switch main;    git pull

# Start work
git switch dev; git pull
git switch -c feat/my-change

# Promote (when the host allows direct merges; otherwise open a PR)
git switch staging; git pull; git merge --no-ff dev
git switch main;    git pull; git merge --no-ff staging

# Release
git switch main; git pull
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0

# Hotfix
git switch main; git pull; git switch -c hotfix/critical-fix
# ...fix, PR to main...
git switch main; git pull
git merge --no-ff hotfix/critical-fix   # or already merged via PR
git tag -a v0.1.1 -m "v0.1.1"; git push origin v0.1.1
git switch staging; git merge --no-ff main; git push
git switch dev;     git merge --no-ff main; git push
```

## Host-side protection (required)

These rules live in GitHub/GitLab, not in the repository. Apply after `git remote add origin <url>` and the
first push. GitHub documents the relevant rules as **required pull requests**, **required status checks**,
**block force pushes**, **restrict deletions**, and optional **required deployments** per environment;
GitLab exposes the same idea as **protected branches** with separate push/merge access levels.

| Setting                         | `dev`                | `staging`            | `main`               |
| ------------------------------- | -------------------- | -------------------- | -------------------- |
| Allow direct pushes             | No                   | No                   | No                   |
| Require pull/merge request      | Yes                  | Yes                  | Yes                  |
| Required approvals                        | 0 (solo)     | 0 (solo)         | 0 (solo)         |
| Required status checks          | lint + types + build | lint + types + build | lint + types + build |
| Block force push                | Yes                  | Yes                  | Yes                  |
| Restrict deletions              | Yes                  | Yes                  | Yes                  |
| Required deployment environment | No                   | `staging`            | `production`         |
| Linear history                  | Optional             | Optional             | Optional             |

Required checks map to the root scripts: `pnpm lint`, `pnpm check-types`, `pnpm build`.

Two practical notes:

- **Solo maintainer:** GitHub does not let you approve your own pull request. Requiring 1 approval on a
  one-person repo blocks every merge. Keep approvals at 0 until there is a second reviewer.
- **Plan limits:** branch protection and rulesets are available on public repositories for free. Private
  repositories need a paid plan. If protection is unavailable, the model still works by convention; do
  not pretend it is enforced.

## Checklist

- [ ] `dev`, `staging`, and `main` exist and point to the same commit on a fresh repo.
- [ ] Every change reaches `main` through `staging`, except documented hotfixes.
- [ ] Branch protection is configured on the host, not assumed.
- [ ] Releases are annotated tags on `main`.

## Next step

Back to the index: [README.md](./README.md).
