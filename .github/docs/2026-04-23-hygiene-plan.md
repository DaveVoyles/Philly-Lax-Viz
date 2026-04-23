# Hygiene & Manual Review Plan — 2026-04-23

> Goal: surface every cleanup item that's either (a) safe enough for an automated wave, or (b) needs a 30-second human decision so the agent can move fast on the next pass. Nothing here is functional/feature work — this is purely "make the system easier to operate".

## 🚨 Top manual items (you decide; agent can't)

These are the highest-leverage human-in-the-loop checks. ~5 minutes of your time will unblock hours of downstream agent work.

### 1. **GitHub Actions billing — nightly cron is FAILING every night**
- Last run (today 06:00 UTC): _"The job was not started because recent account payments have failed or your spending limit needs to be increased."_
- Workflow: `.github/workflows/ingest-nightly.yml` on `DaveVoyles/Philly-Lax-Viz`.
- **Action:** Check Settings → Billing on `DaveVoyles`. Either fix payment, raise spending limit, or move the workflow to `dvoyles_microsoft`/an org with a different plan.
- **Impact:** Right now the DB only updates when we manually re-ingest. Every "the site is stale" question traces back to this.
- **✅ 2026-04-23 Wave H1 UPDATE:** Resolved by sidestep — workflows now run on a self-hosted runner (`myoung34/github-runner` container in `~/docker-stack/github-runner/` on the Mac Mini, labels `[self-hosted, pll]`). Cloud billing is no longer on the critical path. Nightly cron works end-to-end through `Install` step; downstream steps (Azure login, ACA deploy) now gated on the separate **Secrets gap** item below.

### 1a. **Repo Actions secrets — none configured**
- `gh secret list --repo DaveVoyles/Philly-Lax-Viz` → _"no secrets found"_.
- Both workflows reference: `AZURE_CREDENTIALS`, `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_KEY`, `ACA_NAME`, `ACA_RESOURCE_GROUP`, `AZURE_STATIC_WEB_APPS_API_TOKEN`, `DISCORD_WEBHOOK_URL` (optional).
- **Action:** Create the service principal + storage credentials, add them as repo secrets. Until this is done, nightly ingest fails at "Azure login" and deploy fails at ACA deploy.
- **Impact:** Blocks automated DB refresh and automated server-image deploys. Manual `az` commands from your laptop still work.

### 2. **LaxNumbers team-alias gaps (160 anomalies, ~30 distinct teams)**
We're scraping LaxNumbers PA scoreboard but failing to map ~30 team names because they're spelled differently than our `teams` table. Examples:
- `Bonner-Prendergast` (we have `Monsignor Bonner / Archbishop Prendergast`?)
- `St Josephs Prep` (we have `St. Joseph's Prep`)
- `Cardinal OHara` (we have `Cardinal O'Hara`)
- `Upper St Clair`, `Meadville-Crawford Cty`, `Lampeter-Strasburg`, `Susquehannock`, `Spring Grove`, `Gateway`, `Ephrata`, `Conestoga Valley`, `Cedar Crest`, `Northeast`, `Kingston`, `West York`, …
- **Action:** Decide which of these correspond to teams we already have in the DB. For ones that don't (Western PA / Central PA), confirm the rule: ignore them (don't expand the team set). I can dump a side-by-side `proposed_alias → existing_team` CSV for you to ✅/❌ in 60 seconds.
- **Impact:** Fixing the 5–10 real aliases recovers cross-validation data for ~30+ games we're currently silently dropping.

### 3. **Bonner-Prendergast wrong-team attribution (game_id=154)**
Three players (`49412`, `49413`, `49414`) on `Pottsgrove` in the 2026-04-16 Spring-Ford vs Pottsgrove recap have goals greater than Pottsgrove's score. Almost certainly the parser attributed Spring-Ford goals to Pottsgrove (or vice versa). Recap: `https://phillylacrosse.com/2026/thursday-boys-summaries-sponsored-by-fusion-lacrosse-5/`.
- **Action:** Open the recap, eyeball the right side, tell me "swap sides" or "delete those 3 rows" or "keep, real."
- **Impact:** Fix removes 3 of the 12 cross-check anomalies + restores accurate per-team season totals.

### 4. **Short-name "players" — real or parser garbage?**
16 players have ≤4-char single-token names. Mix of real surnames and parser fragments:
```
Kane, Kobb, Ward, Ryan (x2), Hume, Nagy, Fry, Winn, Ray,
Coor, Ford, Dame, Doll, Cobb (x2)
```
- **Action:** I'll diff each against its `team_id` and recap URL. You glance at the list and mark: keep / delete / rename. ~2 min.
- **Impact:** Removes the long tail of "who is Doll?" rows from leaderboards.

### 5. **Cross-check anomaly triage (12 items, 1 line each)**
With v9 deployed, `/api/anomalies?strategy=cross-check-*` returns 12 entries. They're all currently flagged but not acted on. Decide:
  - Auto-clamp player>team rows to 0 (high blast radius)? Or just leave flagged?
  - Same for season-concentration outliers (Brady Flynn 7/11 goals in one game = legit hot game OR parser bug).
- **Action:** One sentence per category — "auto-fix" or "flag only."

---

## 🧹 Safe-to-automate hygiene (no human input needed)

Wave plan once you give Wave 1 the go-ahead.

### Wave H1 — Quick wins (3 lanes, all S, parallelizable)

| Lane | Fleet name | Effort | Scope | Blocked by | Status |
| ---- | ---------- | ------ | ----- | ---------- | ------ |
| 1 | Han 😉🚀 | S | DB-backup rotation: keep last 3 `.bak-*`, delete the other 31 (~58 MB freed). Add `data/lacrosse.db.bak*` to `.gitignore` if not already. Add a `pnpm --filter @pll/ingest run backup-prune` script. | — | 📋 planned |
| 2 | Yoda 👽✨ | S | `auditCleanShortNames.ts`: idempotent script that flags (dry-run) and optionally deletes (--apply) players where name is single-token ≤4 chars AND no recap-page mention. Tests included. | — | 📋 planned |
| 3 | Leia 👑💁‍♀️ | S | Audit-script README: one short doc at `packages/ingest/src/scripts/README.md` listing all `audit*.ts` scripts with one-liner + run command. Cuts onboarding time for next agent. | — | 📋 planned |

### Wave H2 — LaxNumbers alias resolution (only after manual item #2 above)

| Lane | Fleet name | Effort | Scope | Blocked by | Status |
| ---- | ---------- | ------ | ----- | ---------- | ------ |
| 1 | Han 😉🚀 | M | `seedLaxnumbersAliases.ts`: read user-approved alias mapping, insert into `team_aliases`, add idempotency guard. | manual #2 | ⏸ blocked |
| 2 | Yoda 👽✨ | M | Re-run LaxNumbers ingest for the recent date range. Verify the 160 unknown-team anomalies drop to <20. | Lane 1 | ⏸ blocked |

### Wave H3 — Cross-check remediation (only after manual items #3 and #5)

| Lane | Fleet name | Effort | Scope | Blocked by | Status |
| ---- | ---------- | ------ | ----- | ---------- | ------ |
| 1 | Han 😉🚀 | M | Apply user's decisions from #3 + #5: surgical SQL fixes for game_id=154 + 8 other cross-check rows. Backup before. | manual #3, #5 | ⏸ blocked |

### Wave H4 — Parser anomaly funnel (long-tail, not yet sized)

The 212 `player-stat-line` anomalies and 223 `quarter-line` anomalies are the next-tier signal. Most of the player-stat-line ones say `sub-header did not match either game team`. That's a different parser class (score-line bleed) — likely a separate plan once H1–H3 land.

---

## 🔧 Smaller polish items (drop-in any time)

These are too small to justify a wave — agent can fold them into the next opportunistic edit:

- **`/api/leaders` 404** — the actual endpoints are `/api/leaders/players` and `/api/leaders/teams`. Either add a redirect/index endpoint at `/api/leaders` returning `{players: '...', teams: '...'}`, or update Leia's recon doc to use the correct paths. (5 min.)
- **`packages/ingest/data/` ghost dir** — created when running `pnpm --filter @pll/ingest exec` from the wrong dir. Add `packages/*/data/` to `.gitignore` so it never sneaks into a commit again. (1 min.)
- **34 backup files in git status noise** — already covered by Lane H1.1 but worth doing immediately if H1 is delayed.
- **AGENTS.md / project-conventions skill drift** — `~/.copilot/skills/project-conventions/SKILL.md` may be stale relative to recent v8/v9 patterns (PROSE_MARKERS, STAT_CAPS, audit script idiom). Re-read once and reconcile. (10 min.)
- **Anomaly summary endpoint** — `/api/anomalies/summary` exists but isn't surfaced in the web UI. A small "Data Quality" page would let you eyeball anomaly trends without `curl`-ing. (Out of hygiene scope; flag for future feature wave.)

---

## 📦 Communication log

| Time | Lane | Fleet Name | Update |
| ---- | ---- | ---------- | ------ |
| 10:25 | — | orchestrator | 📋 plan written; awaiting user approval and decisions on items #1–#5 above |
| 10:32 | — | orchestrator | ✅ shipped PIAA-authoritative API+UI change (commit `2234952`); Wave H0 added below to deploy v10 in parallel with Wave H1 hygiene lanes |
| 10:33 | 4 | Chewy 🐻💪 | ✅ `h1-shortname-audit` done — `auditShortNames.ts` + tests + npm script shipped; live DB flagged 16 players (matches estimate); report at `.github/docs/2026-04-23-short-names-report.json`; 353/353 tests pass |
| 10:31 | 1 | Han 😉🚀 | 🚀 starting v10-deploy; ACR=`pllacr3087`, ACA=`pll-server`. Docker daemon not running locally → using `az acr build` remote build |
| 10:36 | 1 | Han 😉🚀 | ✅ v10-deploy DONE: `pll-server--v10` Running+Healthy; `/api/teams/39` (Garnet Valley) → `recordSource:'piaa'`, `record:{8-4-0}` matches `team.piaa`, `derivedRecord:{7-5-0}` preserved. ACR build run id `ca1` (1m10s). |
| 10:32 | 3 | Leia 👑💁‍♀️ | ✅ `h1-audit-readme` shipped: `packages/ingest/src/scripts/README.md` (139 LoC) covers all 17 ingest scripts grouped by Audit / Seeding / Maintenance / Sync, plus pending Wave H0/H2 entries (`pruneBackups`, `auditShortNames`, `seedLaxnumbersAliases`) |

---

## 🌊 Wave H0 — Ship PIAA-authoritative + Wave H1 hygiene (4 lanes, parallel)

| Lane | Fleet name | Effort | Scope | Blocked by | Status | Hard stop |
| ---- | ---------- | ------ | ----- | ---------- | ------ | --------- |
| 1 | Han 😉🚀 | M | `v10-deploy`: docker build pll-server:v10 (PIAA-as-truth API), push to ACR `pllacr`, deploy ACA revision `pll-server--v10` in rg `pll-rg`, smoke-verify `/api/teams/{garnet-valley-id}` returns `recordSource:'piaa'` + `record` matches PIAA wins/losses. | — | ✅ done | 30m |
| 2 | Yoda 👽✨ | S | `h1-backup-rotate`: `.gitignore` polish (`packages/*/data/`, `data/lacrosse.db.bak*`), write `pruneBackups.ts` (keeps 3 most recent), add `pnpm` script, run it once. | — | 🎯 launching | 15m |
| 3 | Leia 👑💁‍♀️ | S | `h1-audit-readme`: `packages/ingest/src/scripts/README.md` indexing every `audit*.ts` / `scan*.ts` with purpose + run command + flags. | — | 🎯 launching | 15m |
| 4 | Chewy 🐻💪 | M | `h1-shortname-audit`: `auditShortNames.ts` dry-run-by-default script that prints `{id, name, team, game_count, recap_url}` for each ≤4-char single-token player. Tests. NO auto-delete. | — | 🎯 launching | 30m |

All 4 lanes touch disjoint surfaces (infra/docker, .gitignore+ingest/scripts, ingest/scripts/README, new ingest script). No blockers.

---

## 🎯 Recommended order of operations

1. **You handle items #1–#5** (~5–10 min, mostly browser tabs and one-line answers).
2. **Agent launches Wave H1** in parallel (no blocker).
3. **After your alias decisions land**, agent launches Wave H2.
4. **After your cross-check decisions land**, agent launches Wave H3.
5. **Wave H4** scoped fresh once H1–H3 anomaly counts settle.

Total agent effort once unblocked: ~15–25 min wall-clock for H1–H3.
Total human effort to unblock: ~10 min total across items #1–#5.
| 10:33 | H0/2 | Yoda 👽✨ | ✅ `h1-backup-rotate` complete: pruneBackups.ts shipped + tested (4/4), `.gitignore` adds `data/*.db.bak*` and `packages/*/data/`, npm script `prune-backups` added, ran `--apply --keep 3` → 33 files removed, `data/` 81M → 28M (52.7 MB freed) |

---

## Wave H2 — Outcomes (2026-04-23)

### Decisions landed (from user)

**#3 — Cross-check policy (NEW, applies repo-wide):**
> When a player's goals in a single game exceed the stored team score, **trust PhillyLacrosse player stats** and **reconcile team score from an external authoritative source** (PIAA official → MaxPreps fallback). PhillyLacrosse team-score typos are overridden by PIAA/MaxPreps, same pattern as the existing team-record override in `packages/server/src/routes/teams.ts`.

**#3 — Reference fix (game_id=154, Spring-Ford @ Pottsgrove, 2026-04-16):**
- PhillyLacrosse said Pottsgrove 0. Per-player stats sum to 5 (Raggazino 3g + Henzes 1g + Hires 1g). MaxPreps confirms Pottsgrove 5. Rule: **trust the 5**, not the 0.
- Applied: `UPDATE games SET away_score = 5 WHERE id = 154` against `data/lacrosse.db`. Backup: `data/lacrosse.db.bak-pre-g154-fix` (pre-fix local snapshot preserved for audit).
- Status: committed to repo DB. Will propagate on next successful server-image rebuild.

**#4 — Short-name report:** All 16 entries flagged in `2026-04-23-short-names-report.json` marked `triage_decision: "keep"` with reviewer + date. All surface as legitimate last-name-only stat attributions; no merge/delete needed. Parser's last-name-only resolution fallback is working as intended.

### Deploy-infra findings discovered while shipping H2

1. **Live API is stale from the baked image.** `DB_PATH=/tmp/lacrosse.db` on the ACA, and the Dockerfile CMD seeds `/tmp` from `/app/seed/lacrosse.db` (baked into the image at build time), ignoring the `/data` Azure Files mount entirely. Azure Files upload path that works for `/data/lacrosse.db` is a **no-op** against live traffic.
2. **Image registry `pllacr3087.azurecr.io` is stale.** The referenced ACR does not exist in this subscription (live ACR is `adovizacr1771621563` in `ado-viz-rg`). `az acr build --registry pllacr3087` fails with ResourceNotFound. This means the current v10 image cannot be rebuilt in-place — ACA must be re-pointed to the live registry (or the dead registry name re-provisioned) before image updates work again.
3. **Consequence:** game 154 fix is in `data/lacrosse.db` (repo source of truth) and in Azure Files, but will only reach the live server when someone either (a) re-provisions the image pipeline to the live ACR, or (b) flips `DB_PATH` to `/data/lacrosse.db` (read direct from Azure Files — requires `DB_JOURNAL_MODE=DELETE` which is already set; caveat is Azure Files SMB + SQLite historically caused locking issues, which is the reason for the copy-to-/tmp pattern in the first place).

### New H3 items (deferred, blocking automated deploys)

- **H3-a:** Update `azure-bootstrap.sh` + `deploy.yml` to reference `adovizacr1771621563.azurecr.io/pll-server` instead of `pllacr3087.azurecr.io/pll-server`. Verify ACA managed-identity has AcrPull on the live registry.
- **H3-b:** Decide architecturally: either (1) change server CMD to `cp /data/lacrosse.db /tmp/lacrosse.db` on startup (preferring the mount over the seed), or (2) set `DB_PATH=/data/lacrosse.db` directly. Option 1 keeps the SMB-safety reputation of the copy-to-tmp pattern without requiring image rebuild for each DB refresh. This is the cleanest long-term ops model: nightly ingest writes `data/lacrosse.db` → uploads to Azure Files → ACA picks it up on next scheduled restart without a new image.
- **H3-c:** Secrets gap (item 1a above) still blocks the nightly auto-refresh path.

---

## Azure service-principal runbook (unblocks item 1a)

Run these once from a locally-authenticated `az` session (subscription already set to `0e46d2c0-9a8f-4bfb-b032-f8f2dd819ec6`):

```bash
# 1. Service principal scoped to the resource group
az ad sp create-for-rbac \
  --name "pll-github-actions" \
  --role "Contributor" \
  --scopes "/subscriptions/0e46d2c0-9a8f-4bfb-b032-f8f2dd819ec6/resourceGroups/pll-rg" \
  --sdk-auth
# → copy the full JSON output
gh secret set AZURE_CREDENTIALS --repo DaveVoyles/Philly-Lax-Viz   # paste JSON

# 2. Azure Files account name + key (for nightly DB upload)
ACCT=pllstorage3426
gh secret set AZURE_STORAGE_ACCOUNT --repo DaveVoyles/Philly-Lax-Viz --body "$ACCT"
KEY=$(az storage account keys list -g pll-rg --account-name "$ACCT" --query "[0].value" -o tsv)
gh secret set AZURE_STORAGE_KEY --repo DaveVoyles/Philly-Lax-Viz --body "$KEY"

# 3. ACA target (literals)
gh secret set ACA_NAME --repo DaveVoyles/Philly-Lax-Viz --body "pll-server"
gh secret set ACA_RESOURCE_GROUP --repo DaveVoyles/Philly-Lax-Viz --body "pll-rg"

# 4. Static Web Apps deploy token — grab from portal
# Azure Portal → Static Web Apps → victorious-pond-0c5ff000f → Manage deployment token → Copy
gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --repo DaveVoyles/Philly-Lax-Viz --body "<paste-token>"

# 5. (optional) Discord notifications
gh secret set DISCORD_WEBHOOK_URL --repo DaveVoyles/Philly-Lax-Viz --body "<webhook-url>"
```

After step 5, re-run the `deploy` workflow manually from the Actions tab to verify each secret resolves.

> ⚠️ Before a green deploy will actually update production, H3-a and H3-b (registry repoint + DB-path strategy) must also land. Otherwise the workflow will push a v11 image to a registry that ACA isn't pulling from.

## Wave H3 outcomes

- **Lane 4 (Chewy):** Synced `.github/copilot-instructions.md` and `.github/agents/autonomous-fleet-agent.agent.md` from home defaults into the repo. No divergence with existing `AGENTS.md` / `README.md` / `docs/` (AGENTS.md is project-specific onboarding; complementary, not contradictory). `pnpm -r typecheck` clean.
- **Lane 5 (R2 🤖🔧):** Investigated suspected Pierce/Peirce Merril duplicate on team 80 (Harriton). Query `SELECT id, name, name_normalized FROM players WHERE team_id=80 AND LOWER(name) LIKE '%merril%'` returned exactly **one row** (id=50907, "Peirce Merrill", norm="peirce merrill"). Broader sweep for `%pierce%` / `%peirce%` also showed no team-80 collision. `ingest_anomalies` has zero Merril/Peirce/Pierce entries. No merge performed — no duplicate exists. No canonical/dup ids to report; `player_stats` untouched (0 rows repointed). Safety backup `data/lacrosse.db.bak-pre-merril-dedup` retained per protocol. Root cause of the false-alarm report: likely a stale checkpoint note from an earlier wave; the normalization path in `packages/ingest/src/pipelines/summaries.ts` (delegating to `normalizePlayerName` + the `UNIQUE (team_id, name_normalized)` constraint on `players`) already prevents this exact dup class at insert time.
