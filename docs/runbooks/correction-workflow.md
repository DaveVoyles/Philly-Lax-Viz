# Correction Workflow Runbook

Community readers can suggest corrections to player stats, game scores, and
player identity fields. This document traces the full lifecycle from browser
click to nightly DB write, and explains how to debug each stage.

---

## Overview

```
Browser (pencil button)
  --> correctionModal.ts (client-side validation + warning)
      --> POST /api/corrections  (always Azure, even on GitHub Pages)
          --> corrections.ts route (server validation, outlier detection, rate limit)
              --> community_corrections table  (status = pending | outlier)
                  --> applyCorrections.ts nightly  (approve -> UPDATE or flag -> outlier)
                      --> adminCorrections view  (human review of flagged outliers)
```

---

## 1. What Can Be Corrected

Three entity types are supported. The `entityType` and `fieldName` must match
one of the following combinations:

| entityType   | fieldName        | DB table      | Constraint                  |
|--------------|------------------|---------------|-----------------------------|
| player_stat  | goals            | player_stats  | integer, hard cap 15        |
| player_stat  | assists          | player_stats  | integer, hard cap 15        |
| player_stat  | ground_balls     | player_stats  | integer, hard cap 30        |
| player_stat  | caused_turnovers | player_stats  | integer, hard cap 20        |
| player_stat  | saves            | player_stats  | integer, hard cap 40        |
| player_stat  | fo_won           | player_stats  | integer, hard cap 40        |
| player_stat  | fo_taken         | player_stats  | integer, hard cap 50        |
| game         | home_score       | games         | integer, hard cap 30        |
| game         | away_score       | games         | integer, hard cap 30        |
| player       | name             | players       | string, max 100 chars       |
| player       | jersey_number    | players       | integer, 0-99               |

Source of truth: `CORRECTABLE_FIELDS` in
`packages/server/src/routes/corrections.ts`.

---

## 2. UI Entry Points

### gameDetail.ts

Two kinds of correction buttons are rendered:

- **Player-stat buttons** (pencil icon) -- one per correctable stat cell in the
  per-game player table. Clicking opens the modal with `entityType =
  'player_stat'`, the row's `player_stats.id`, the field name, and a context
  label like `"John Smith - Harriton vs Haverford (2025-04-10)"`.

- **Score buttons** -- one each for home score and away score in the score
  display. Not rendered when the game is marked `postponed`. `entityType =
  'game'`, `entityId = games.id`.

Source: `createPlayerStatCorrectionButton()` and
`createGameScoreCorrectionButton()` in
`packages/web/src/views/gameDetail.ts`.

### playerDetail.ts

Pencil buttons appear next to each stat value in the per-game stats table.
`entityType = 'player_stat'`, context label is
`"PlayerName (YYYY-MM-DD)"`.

Source: correction button helper near the bottom of
`packages/web/src/views/playerDetail.ts`.

### Player identity corrections (name, jersey number)

These are NOT currently exposed through a UI pencil button. They are
supported end-to-end by the server and nightly script but require a direct
API call or a future UI addition. The `entityType = 'player'` path exists in
`CORRECTABLE_FIELDS` and `applyCorrections.ts`.

---

## 3. correctionModal.ts -- Client-Side Form

`openCorrectionModal(target: CorrectionTarget)` injects a modal overlay with:

- Submitter first name, last name (required)
- Submitter email (required, validated with `EMAIL_RE`)
- Proposed value (number >= 0, required, pre-filled with current value)
- Optional note (max 500 chars)

**Client-side outlier warning** (non-blocking; shown in amber):

| fieldName          | Threshold           |
|--------------------|---------------------|
| goals, assists     | proposed value > 15 |
| home_score, away_score | proposed value > 30 |

This is a UX hint only. The server re-checks outlier bounds independently.

On submit, the form calls `submitCorrection()` in `packages/web/src/api.ts`.

**Rate-limit UX:** HTTP 429 from the server is surfaced as: "You've submitted
too many corrections today. Please try again tomorrow."

---

## 4. api.ts -- submitCorrection()

`submitCorrection()` always constructs an absolute URL via `apiUrl()` using
`VITE_API_BASE_URL`, which points to the Azure Container App in production:

```
https://phillylaxstats.com/api/corrections
```

**This call is NOT gated by `IS_STATIC`.** Corrections submitted from the
GitHub Pages static site still hit the live Azure API. The static build
exports no corrections data to `public/data/`; the correction write path
is always live.

The payload fields sent:

```
submitterFirst, submitterLast, submitterEmail
entityType, entityId, fieldName
oldValue (current value as string), newValue (proposed as string)
note (optional)
```

---

## 5. Server Route -- POST /api/corrections

File: `packages/server/src/routes/corrections.ts`

**Validation order (400 returned on first failure):**

1. `submitterFirst` -- non-empty string
2. `submitterLast` -- non-empty string
3. `submitterEmail` -- valid email format (lowercased internally)
4. `fieldName` -- must be a key in `CORRECTABLE_FIELDS`
5. `entityType` -- must match `CORRECTABLE_FIELDS[fieldName].entityType`
6. `entityId` -- positive integer
7. `newValue` -- non-empty string; parsed as integer for numeric fields;
   for `name`: max 100 chars; for `jersey_number`: integer 0-99
8. `note` -- optional; if provided must be string <= 500 chars
9. Entity existence check -- 404 if the target row is not found in the DB

**Outlier detection (status assigned before INSERT):**

A correction is stored with `status = 'outlier'` (not `pending`) if either:

- `newValue > hardCap` for the field, OR
- `maxMultiplier` is defined AND `currentValue > 0` AND
  `newValue / currentValue > maxMultiplier`

Fields with a `maxMultiplier`:

| Field                  | maxMultiplier |
|------------------------|---------------|
| goals, assists         | 5             |
| home_score, away_score | 10            |

All other numeric fields have only a `hardCap` guard.

`name` and `jersey_number` do not use numeric outlier logic; they are
validated by type/range only.

**Rate limiting:**

In-memory per-email counter. Limit: 10 corrections per email per 24 hours.
Returns HTTP 429 when exceeded. Counter resets after 24 hours or on server
restart. Expired entries are purged on each new email's first request.

**IP hashing:**

`request.ip` is SHA-256 hashed and stored in `ip_hash`. The raw IP is never
persisted.

**Response:**

```json
{ "id": 42, "status": "pending" }
```

or `{ "id": 42, "status": "outlier" }` if flagged at submission time.

---

## 6. DB Schema -- community_corrections

Migration: `packages/ingest/src/migrations/005_community_corrections.sql`

Key columns:

| Column          | Type    | Notes                                        |
|-----------------|---------|----------------------------------------------|
| id              | INTEGER | PK, auto-increment                           |
| submitter_first | TEXT    |                                              |
| submitter_last  | TEXT    |                                              |
| submitter_email | TEXT    | lowercased at insert                         |
| entity_type     | TEXT    | player_stat / game / player                  |
| entity_id       | INTEGER |                                              |
| field_name      | TEXT    |                                              |
| old_value       | TEXT    | value at submission time (string)            |
| new_value       | TEXT    | proposed value (string)                      |
| note            | TEXT    | nullable                                     |
| status          | TEXT    | pending / approved / rejected / outlier      |
| submitted_at    | TEXT    | datetime (UTC)                               |
| reviewed_at     | TEXT    | set by applyCorrections nightly              |
| reviewer_notes  | TEXT    | reason string from nightly script            |
| ip_hash         | TEXT    | SHA-256 of submitter IP                      |

---

## 7. Nightly Apply -- applyCorrections.ts

File: `packages/ingest/src/scripts/applyCorrections.ts`

Runs in `ingest-nightly.yml` after ingestion and before DB upload to Azure:

```bash
pnpm --filter @pll/ingest exec tsx src/scripts/applyCorrections.ts \
  --db=data/lacrosse.db
```

The step uses `continue-on-error: true` so a failure does not abort the
nightly ingest.

**Processing logic (for each `pending` row):**

1. Verify `field_name` is in `ALLOWED_FIELDS[entity_type]` -- reject if not.
2. Resolve the target table via `getEntityTarget(entity_type)` -- reject if
   unrecognized entity type.
3. Look up current row value -- reject if row no longer exists.
4. Re-run `isOutlier(fieldName, newValue, currentValue)` -- flag as `outlier`
   if true. Outlier rows are NOT applied; status is updated to `outlier`.
5. For approved rows: execute the appropriate `UPDATE` statement, then set
   `status = 'approved'`, `reviewed_at = datetime('now')`,
   `reviewer_notes = 'auto-approved by nightly script'`.

Rejection reasons logged in `reviewer_notes`:
- `'auto-rejected by nightly script: invalid field for entity type'`
- `'auto-rejected by nightly script: unsupported entity type'`
- `'auto-rejected by nightly script: target row not found'`
- `'auto-rejected by nightly script: new_value is not an integer'`

Rows that were already set to `outlier` at submission time are NOT re-queried
by the nightly script (it only selects `WHERE status = 'pending'`).

**Dry-run mode:**

```bash
pnpm --filter @pll/ingest exec tsx src/scripts/applyCorrections.ts \
  --db=data/lacrosse.db --dry-run
```

Prints what would be applied/rejected/flagged without writing any rows.
Counts are logged under the `dryRun` summary key.

**Output summary line:**

```
[applyCorrections] Applied: N approved, N outliers skipped, N rejected, N dry-run
```

---

## 8. Admin Review -- #/admin/corrections

File: `packages/web/src/views/adminCorrections.ts`

Route: `#/admin/corrections`

Calls:

- `GET /api/corrections/flagged` -- returns up to 200 rows with
  `status = 'outlier'`, ordered by `submitted_at DESC`
- `GET /api/corrections/recent` -- returns up to 50 rows with
  `status IN ('approved', 'outlier')`, ordered by `submitted_at DESC`

These read routes use `request()` in `api.ts`, which IS gated by `IS_STATIC`
(falls back to `staticFetch`). Because no corrections snapshot is exported
to `public/data/`, the admin view is effectively unavailable in static mode.
Use the live site or local dev server to access it.

---

## 9. Static vs. Live Distinction

| Action                       | GitHub Pages (IS_STATIC) | Azure live site |
|------------------------------|--------------------------|-----------------|
| Submit correction            | Works (hits Azure API)   | Works           |
| View flagged/recent (admin)  | Not available            | Works           |
| Nightly apply runs           | N/A (CI only)            | N/A (CI only)   |

The correction submission path bypasses `IS_STATIC` by using `apiUrl()` to
construct an absolute URL to the Azure backend. This is intentional and
documented in `AGENTS.md` §11.

---

## 10. Debugging Guide

### Submission returns 400

Check each validation step in order (see section 5). Common causes:
- `entityType` does not match the field (e.g. sending `entityType = 'game'`
  for field `goals`)
- `newValue` is not an integer string for numeric fields
- `note` exceeds 500 chars

### Submission returns 404

The `entityId` does not exist in the target table. The stat or game row may
have been deleted or never existed.

### Submission returns 429

The submitter's email has exceeded 10 corrections in 24 hours. The counter
is in-memory; it resets on server restart or after 24 hours.

### Correction is `outlier` and not applied nightly

The proposed value exceeded the `hardCap` or `maxMultiplier` guard. Check
`reviewer_notes` in `community_corrections` for the exact reason. Review
manually via the admin view (`#/admin/corrections`).

To manually approve or reject an outlier, update the DB directly:

```sql
-- approve
UPDATE community_corrections
   SET status = 'approved',
       reviewed_at = datetime('now'),
       reviewer_notes = 'manually approved'
 WHERE id = <id>;

-- then apply the underlying field:
UPDATE player_stats SET goals = <new_value> WHERE id = <entity_id>;
```

### Correction is `pending` but was not applied nightly

Check whether the `applyCorrections` step in `ingest-nightly.yml` succeeded.
The step uses `continue-on-error: true`, so check workflow logs for the
`[applyCorrections]` summary line. Common causes:
- `isOutlier()` re-flagged it (re-check bounds against current value)
- Target row was deleted between submission and nightly run (status =
  `rejected`, reviewer_notes includes `target row not found`)
- `new_value` failed integer parsing (status = `rejected`)

### Querying corrections in SQLite

```bash
sqlite3 data/lacrosse.db ".mode column" \
  "SELECT id, entity_type, field_name, old_value, new_value, status, reviewer_notes FROM community_corrections ORDER BY submitted_at DESC LIMIT 20;"
```

---

## 11. Relevant File Index

| File                                                         | Role                                      |
|--------------------------------------------------------------|-------------------------------------------|
| `packages/web/src/components/correctionModal.ts`            | Modal UI, client validation, POST         |
| `packages/web/src/views/gameDetail.ts`                      | Pencil buttons for scores + player stats  |
| `packages/web/src/views/playerDetail.ts`                    | Pencil buttons for player per-game stats  |
| `packages/web/src/views/adminCorrections.ts`                | Admin review UI                           |
| `packages/web/src/api.ts`                                   | `submitCorrection()`, admin fetch helpers |
| `packages/web/src/apiBase.ts`                               | `apiUrl()` -- absolute URL construction   |
| `packages/server/src/routes/corrections.ts`                 | POST/GET route handlers, outlier logic    |
| `packages/ingest/src/scripts/applyCorrections.ts`           | Nightly apply script, `isOutlier()`       |
| `packages/ingest/src/migrations/005_community_corrections.sql` | DB schema                              |
| `.github/workflows/ingest-nightly.yml`                      | CI step that calls applyCorrections       |
