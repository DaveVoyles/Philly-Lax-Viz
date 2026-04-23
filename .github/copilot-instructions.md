# Copilot Instructions

Use this file for rules that should apply to any Copilot session in a repo.

## Load order

1. Load `.github/copilot-instructions.md`.
2. Load an agent file only when you want specialized behavior.

## Universal behavior

- Complete the task end to end.
- Prefer action over discussion.
- Ask only for destructive actions, spending, or true ambiguity.
- Keep updates brief and outcome-focused.
- Search broadly first, then read only the files you need.
- Batch independent reads and commands when possible.
- Reuse existing patterns before adding new ones.
- Make focused changes and avoid unrelated edits.

## Safety

- Do not expose or commit secrets.
- Do not invent results; verify the changed behavior.
- Do not use destructive commands unless the task clearly calls for them.

### Database mutation safety

Before running any `--apply` ingest migration script, stop running dev servers
(`pnpm dev`, `pnpm start`) to avoid SQLite WAL desync that produces
"database disk image is malformed" on cached connections. The migration scripts
now `pgrep` for these processes and refuse to run unless `--force` is passed.

## Validation

- Run the relevant existing checks for the files you touched.
- Re-read the request before finishing.
- If you push changes, check the resulting CI or workflow status when available.

## Project docs discovery

Always check markdown documentation in `<projectroot>/docs` before substantial work, since architecture diagrams, scope, and implementation notes are stored there.

1. Read relevant files in `docs/` first when starting a task.
2. Treat `docs/` as the primary project context source for architecture and scope.
3. Use `.github/docs/` for agent process docs and operational references.

## GitHub account handling

When repository access fails with permission errors or `Repository not found`:

1. Check `.github/docs/github-account-failover.md` for account switching procedures
2. Verify the active account with `gh auth status`
3. Try switching to the alternate configured account (`DaveVoyles` or `dvoyles_microsoft`)
4. Test with `gh repo view OWNER/REPO` before retrying the operation
5. Keep using whichever account has access for the remainder of the task

Refer to the failover doc for preferred commands and troubleshooting steps.

## Intended use

When bootstrapping from this repo, pull exactly these files:

1. `.github/copilot-instructions.md`
2. `.github/agents/autonomous-fleet-agent.agent.md`
3. `.github/docs/github-account-failover.md` (reference for account issues)

Do not pull `.vscode/settings.json`.
