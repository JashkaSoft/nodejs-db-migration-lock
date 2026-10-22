---
name: conventional-commit
description: >-
  Create git commits using Conventional Commits, split by logical change, and
  follow this repo's git safety protocol. Use when the user asks to commit,
  make commits, write a commit message, split work into commits, or mentions
  conventional commits.
---

# Conventional commits

When the user asks to commit, follow this workflow. Do not commit unless they asked.

## Inspect first

Run these in parallel:

```bash
git status
git diff
git diff --staged
git log -15 --oneline
```

Use the existing log style. This repo uses Conventional Commits:

```
<type>(<optional-scope>): <imperative summary>

<optional body: why, not what>
```

Types: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`, `ci`, `build`, `perf`, `style`.

Keep the subject ~72 chars, lowercase after the colon, no trailing period.

## Split commits

Make **multiple commits** when the working tree has more than one logical change. Group by intent, for example:

- driver/lock behavior vs tests vs e2e harness vs CI vs docs vs skills
- do not mix a new skill with product code
- do not mix unrelated refactors with a bug fix

Stage only the files for the current commit (`git add` those paths). Never `git add -A` when that would mix groups.

If a single file contains two intents (for example `package.json` scripts), keep it with the dominant change rather than hand-editing the file apart.

## Commit command

Always pass the message via HEREDOC. Never `-i`, `--amend` (unless every amend rule below is met), `--no-verify`, or `--no-gpg-sign`.

```bash
git commit -m "$(cat <<'EOF'
fix(postgres): pin NodePgDriver to one pool session

Advisory locks require a stable backend; pooling per query dropped them.

EOF
)"
```

After each commit, run `git status`.

## Safety

- Never update git config
- Never skip hooks
- Never force-push to main/master; warn if the user asks
- Never `push` unless the user asked
- Never commit secrets (`.env`, credentials, keys)
- Never destructive git (`push --force`, `reset --hard`, etc.) unless the user explicitly asked
- Do not commit if there is nothing to commit

### Amend only when all are true

1. User explicitly asked to amend, **or** the commit succeeded and a hook modified files that must be included
2. `HEAD` was created by you in this conversation (`git log -1 --format='%an %ae'`)
3. The commit has not been pushed (`git status` shows ahead of remote, or no upstream)

If a hook **rejected** the commit, fix and create a **new** commit. Do not amend.

## Examples

```
fix(postgres): reuse one client from pg Pool
test(core): tolerate timer slack in retry duration
ci: run unit tests and postgres e2e
docs: document e2e commands and postgres-only scope
chore(skills): add conventional commit workflow
```
