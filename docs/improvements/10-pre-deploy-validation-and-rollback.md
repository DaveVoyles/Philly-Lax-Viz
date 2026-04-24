# 10 — Pre-deploy validation gates + automated rollback

> **Status:** proposed · **Owner:** DevOps lane · **Priority:** P0 (deploy reliability)
>
> Pairs with [#09](./09-github-hosted-runner-oidc-deploy.md). Assumes CI is
> running again on GitHub-hosted runners with OIDC auth.

## Motivation

The v11 deploy on $TODAY took **>30 minutes** and failed three times in
distinct ways before succeeding. None of the failures were caught before
they hit the live revision; each was discovered by a human running `curl`
against the public URL and seeing `502` or stale data. The three failures:

1. **Malformed `--command` override.** A typo in the `az containerapp
   update --command '["node","..."]'` argument was accepted by the CLI but
   produced a container that crashlooped on entrypoint. The bad revision
   was *promoted to 100% traffic* before anyone noticed it was unhealthy.
2. **Stale ACR credentials.** The local Docker config had a cached ACR
   password that no longer worked. `docker push` failed silently in
   one shell, succeeded in another using a freshly-logged-in session, and
   the `containerapp update` step then deployed *the wrong tag* — the
   previously-built image rather than the current code.
3. **Un-checkpointed SQLite WAL.** The seed DB baked into the image
   contained `lacrosse.db-wal` and `lacrosse.db-shm` sidecar files that
   were never copied. The container started against a DB missing the
   most recent ingest writes (~6 hours of data), and the bug was only
   visible because the home page showed yesterday's "last updated"
   timestamp.

Every one of these is preventable with a check that takes seconds. None
of them currently exist. The deploy pipeline is **fire-and-pray**: build,
push, point traffic, hope. There is no health gate, no smoke test, no
rollback — `az containerapp update` swaps the active revision in place
the moment the new one reports `Provisioning: Succeeded`, which only
means the container *started*, not that it *works*.

This proposal adds three gates: (a) **pre-build** sanity on the artifacts
going into the image, (b) **post-deploy, pre-traffic** smoke tests against
the new revision, and (c) **automated rollback** when a smoke test fails.

## Current state

- `deploy.yml` (when it runs) ends with `azure/container-apps-deploy-action@v2`,
  which calls `az containerapp update --image ...`. No revision suffix in
  the action invocation, so revision names are auto-generated and traffic
  flips automatically.
- The Container App is configured with a **single revision** mode (the
  default). New revision = 100% traffic, immediately. There is no
  multi-revision staging.
- No `livenessProbe`, `readinessProbe`, or `startupProbe` defined on the
  Container App. ACA falls back to a TCP check on the ingress port, which
  passes the moment Fastify binds — well before route handlers are wired
  up.
- The only post-deploy verification is whatever a human types into a
  terminal. There is no automated curl, no smoke suite, no synthetic
  transaction.
- The seed DB at `data/lacrosse.db` is committed to git and copied into
  the image at `/app/seed/lacrosse.db`. Nothing checks that the DB is
  WAL-checkpointed before commit, and nothing checks it during the build.
- There is no documented rollback procedure. Recovery from a bad deploy
  today means "find the previous SHA, manually re-tag it, re-run
  containerapp update." Tribal knowledge.

## Proposed design

### Gate A — Pre-build artifact validation

Add a job that runs **before** `docker build` and fails fast on artifacts
that would produce a broken image.

```yaml
validate-artifacts:
  needs: build-and-test
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
      with:
        lfs: true   # seed DB may be LFS in future

    - name: Verify seed DB is checkpointed (no -wal/-shm)
      run: |
        if [ -f data/lacrosse.db-wal ] || [ -f data/lacrosse.db-shm ]; then
          echo "::error::Uncheckpointed WAL found next to seed DB."
          echo "Run: sqlite3 data/lacrosse.db 'PRAGMA wal_checkpoint(TRUNCATE);'"
          exit 1
        fi

    - name: Verify seed DB integrity + min row counts
      run: |
        sudo apt-get install -y -q sqlite3
        sqlite3 data/lacrosse.db "PRAGMA integrity_check;" | grep -q '^ok$' \
          || { echo "::error::seed DB integrity_check failed"; exit 1; }
        TEAMS=$(sqlite3 data/lacrosse.db "SELECT COUNT(*) FROM teams;")
        GAMES=$(sqlite3 data/lacrosse.db "SELECT COUNT(*) FROM games;")
        echo "Seed DB: $TEAMS teams, $GAMES games"
        # Floor values — adjust as the league grows. Catches accidentally
        # committing an empty/dev DB.
        [ "$TEAMS" -ge 50 ]  || { echo "::error::teams < 50";  exit 1; }
        [ "$GAMES" -ge 200 ] || { echo "::error::games < 200"; exit 1; }

    - name: Verify Dockerfile has not lost the seed copy
      run: grep -q 'COPY .* data/lacrosse.db /app/seed/lacrosse.db' Dockerfile

    - name: Verify image entrypoint command is well-formed
      # Catches today's "malformed --command override" failure mode at the
      # source: render the CMD line from the Dockerfile and parse it.
      run: |
        CMD_LINE=$(grep -E '^CMD ' Dockerfile | tail -1)
        echo "$CMD_LINE" | python3 -c "
        import sys, re, json
        line = sys.stdin.read().strip()
        m = re.match(r'^CMD\s+(\[.*\]|\".*\"|.+)$', line)
        if not m: sys.exit('CMD line not parseable')
        v = m.group(1)
        if v.startswith('['):
          json.loads(v)  # raises if not valid JSON array form
        print('OK:', v[:80])"
```

A pre-commit hook does the same for local commits:

```bash
# .githooks/pre-commit (snippet)
if git diff --cached --name-only | grep -q '^data/lacrosse\.db$'; then
  if [ -f data/lacrosse.db-wal ] || [ -f data/lacrosse.db-shm ]; then
    echo "Refusing commit: lacrosse.db has uncheckpointed WAL."
    echo "Run: sqlite3 data/lacrosse.db 'PRAGMA wal_checkpoint(TRUNCATE);'"
    exit 1
  fi
fi
```

### Gate B — Multi-revision deploy with smoke test before traffic switch

Switch the Container App from single-revision to **multi-revision** mode so
new revisions can be deployed at 0% traffic, smoke-tested via their
direct revision URL, and only then promoted.

One-time setup:

```bash
az containerapp revision set-mode \
  --name pll-server --resource-group pll-rg \
  --mode multiple

# Make every new revision land at 0% traffic by default
az containerapp ingress traffic set \
  --name pll-server --resource-group pll-rg \
  --revision-weight latest=0
```

New deploy job (replaces the current `azure/container-apps-deploy-action@v2`
step):

```yaml
deploy-server:
  needs: [build-and-test, validate-artifacts]
  runs-on: ubuntu-latest
  environment: production    # uses GH Environment protection rule (manual gate optional)
  steps:
    - uses: azure/login@v2
      with:
        client-id:       ${{ secrets.AZURE_CLIENT_ID }}
        tenant-id:       ${{ secrets.AZURE_TENANT_ID }}
        subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

    - name: Capture previous active revision (for rollback)
      id: prev
      run: |
        REV=$(az containerapp revision list \
          -n pll-server -g pll-rg \
          --query "[?properties.trafficWeight==\`100\`].name | [0]" -o tsv)
        echo "name=$REV" >> "$GITHUB_OUTPUT"
        echo "Previous active: $REV"

    - name: Deploy new revision at 0% traffic
      id: deploy
      run: |
        SUFFIX="sha${GITHUB_SHA:0:7}"
        az containerapp update \
          -n pll-server -g pll-rg \
          --image adovizacr1771621563.azurecr.io/pll-server:${{ github.sha }} \
          --revision-suffix "$SUFFIX"
        NEW_REV=$(az containerapp revision list \
          -n pll-server -g pll-rg \
          --query "[?contains(name, '$SUFFIX')].name | [0]" -o tsv)
        echo "name=$NEW_REV" >> "$GITHUB_OUTPUT"
        echo "New revision: $NEW_REV"

    - name: Wait for revision to become healthy
      run: |
        REV=${{ steps.deploy.outputs.name }}
        for i in $(seq 1 30); do
          STATE=$(az containerapp revision show \
            -n pll-server -g pll-rg --revision "$REV" \
            --query "properties.healthState" -o tsv)
          PROV=$(az containerapp revision show \
            -n pll-server -g pll-rg --revision "$REV" \
            --query "properties.provisioningState" -o tsv)
          echo "[$i] provisioning=$PROV health=$STATE"
          [ "$PROV" = "Provisioned" ] && [ "$STATE" = "Healthy" ] && exit 0
          [ "$PROV" = "Failed" ] && { echo "::error::revision provisioning failed"; exit 1; }
          sleep 10
        done
        echo "::error::revision did not become healthy in 5 min"
        exit 1

    - name: Smoke test new revision (0% traffic, direct revision URL)
      id: smoke
      run: |
        REV=${{ steps.deploy.outputs.name }}
        FQDN=$(az containerapp show -n pll-server -g pll-rg \
          --query "properties.configuration.ingress.fqdn" -o tsv)
        # Revision-direct URL: <revname>--<fqdn-suffix>
        REV_FQDN="${REV}.${FQDN#*.}"
        URL="https://$REV_FQDN"
        echo "Smoke testing $URL"

        # 1. Health endpoint
        curl -fsS --max-time 10 "$URL/api/health" | tee /dev/stderr | grep -q '"ok":true'

        # 2. Routes return data, not just 200
        TEAMS=$(curl -fsS --max-time 10 "$URL/api/teams" | jq 'length')
        GAMES=$(curl -fsS --max-time 10 "$URL/api/games" | jq 'length')
        echo "Smoke: $TEAMS teams, $GAMES games"
        [ "$TEAMS" -ge 50 ]  || { echo "::error::smoke: teams < 50";  exit 1; }
        [ "$GAMES" -ge 200 ] || { echo "::error::smoke: games < 200"; exit 1; }

        # 3. Leaders endpoint (representative complex query)
        curl -fsS --max-time 15 "$URL/api/leaders/players?metric=points&limit=5" \
          | jq 'length' | grep -qE '^[1-9]'

    - name: Promote new revision to 100% traffic
      if: success()
      run: |
        REV=${{ steps.deploy.outputs.name }}
        az containerapp ingress traffic set \
          -n pll-server -g pll-rg \
          --revision-weight "$REV=100"
        # Deactivate the previous revision after a 5-min grace window
        # (handled by the cleanup job below or a scheduled workflow)

    - name: Rollback on failure
      if: failure() && steps.prev.outputs.name != ''
      run: |
        echo "::warning::Smoke test or health check failed — rolling back"
        az containerapp ingress traffic set \
          -n pll-server -g pll-rg \
          --revision-weight "${{ steps.prev.outputs.name }}=100"
        # Deactivate the failed revision so it doesn't count against the
        # multi-revision quota
        az containerapp revision deactivate \
          -n pll-server -g pll-rg \
          --revision "${{ steps.deploy.outputs.name }}" || true
        exit 1
```

### Gate C — Application-level health endpoint that means something

The current `/api/health` returns `{ok: true}` the moment Fastify binds —
it does not check the DB. Beef it up so the smoke test is meaningful.
This is a one-line server change but doc-only here:

```ts
// packages/server/src/routes/health.ts (proposed shape)
fastify.get('/api/health', async () => {
  const row = db.prepare('SELECT COUNT(*) AS n FROM teams').get() as { n: number };
  return {
    ok: row.n > 0,
    teams: row.n,
    dbPath: process.env.DB_PATH,
    revision: process.env.CONTAINER_APP_REVISION ?? 'unknown',
    ts: new Date().toISOString(),
  };
});
```

Configure ACA's startup/readiness probes to hit it:

```bash
az containerapp update -n pll-server -g pll-rg --yaml - <<'YAML'
properties:
  template:
    containers:
      - name: pll-server
        probes:
          - type: Startup
            httpGet: { path: /api/health, port: 8080 }
            initialDelaySeconds: 5
            periodSeconds: 5
            failureThreshold: 12     # 60s budget to come up
          - type: Readiness
            httpGet: { path: /api/health, port: 8080 }
            periodSeconds: 10
            failureThreshold: 3
YAML
```

A revision that can't read the DB now reports `Unhealthy`, which causes
the "Wait for revision to become healthy" step to fail, which triggers
rollback.

## Scope

In:

- New `validate-artifacts` job in `deploy.yml`.
- Pre-commit hook for the seed DB WAL check (opt-in, documented in CONTRIBUTING).
- Multi-revision mode + traffic-weight-based deploy in `deploy.yml`.
- ACA startup/readiness probes against `/api/health`.
- Rollback step on failure.
- New runbook: `docs/runbooks/deploy.md` describing the gates and the
  manual rollback command for emergency use.
- Update to `/api/health` to verify DB connectivity (one route handler).

Out:

- Application Insights / structured logging — separate proposal.
- Synthetic monitoring (running smoke tests *between* deploys) — separate.
- Database migration safety (we don't currently run migrations on deploy
  because the DB is baked into the image; revisit if/when we move to a
  mounted DB).
- Web rollout — depends on the web hosting decision (separate proposal).

## Validation plan

1. **Force gate A to fail on purpose.** Commit a `data/lacrosse.db-wal`
   sidecar file, push, watch `validate-artifacts` reject it. Revert.
2. **Force gate B health-wait to fail.** Push a deliberately broken image
   (e.g. CMD that exits immediately). Confirm the workflow:
   - Creates the new revision at 0% traffic.
   - Detects `Unhealthy` within 5 min.
   - Runs the rollback step.
   - Leaves the previous revision at 100% traffic.
   - Marks the workflow run as failed.
3. **Force gate B smoke test to fail.** Push an image with `/api/teams`
   broken (e.g. wrong table name). Confirm:
   - Revision becomes `Healthy` (Fastify still binds).
   - Smoke step fails on the row-count assertion.
   - Rollback runs.
4. **Happy path.** Push a normal change. Confirm a clean deploy completes
   in under 8 minutes total, with the new revision at 100% and the old
   one deactivated.
5. **Rollback drill.** Once a quarter, intentionally break a deploy in a
   maintenance window and time the rollback. Target: < 2 min from "smoke
   step starts failing" to "previous revision back at 100%."

## Effort estimate

| Task | Effort |
| --- | --- |
| `validate-artifacts` job | 45 min |
| Pre-commit hook + CONTRIBUTING note | 30 min |
| Switch ACA to multi-revision + initial traffic config | 20 min |
| Rewrite deploy job around revision-direct smoke + rollback | 90 min |
| `/api/health` enhancement + tests | 30 min |
| Configure ACA probes | 30 min |
| Write `docs/runbooks/deploy.md` | 60 min |
| Failure-mode validation (the four scenarios above) | 90 min |
| **Total** | **~6 hours, two sittings** |

## Risk

- **Multi-revision mode increases the surface area.** Old revisions
  linger at 0% traffic and count against the quota (default 100). Add a
  cleanup step that deactivates anything older than the previous-but-one
  revision, or rely on `--revisions-mode multiple --max-inactive-revisions 5`.
- **Revision-direct URLs require the revision label feature**, which
  requires multi-revision mode and an `ingress.targetPort` ≥ 1024 (we use
  8080, fine). Verified in the Azure docs:
  <https://learn.microsoft.com/azure/container-apps/revisions#revision-labels>.
- **Smoke test row-count thresholds are brittle.** A legitimate schema
  change (e.g. team filter) could drop counts and trigger a false
  rollback. Mitigation: the thresholds are *floors* (≥ 50 teams) tuned
  far below current values (~150), and they are easy to bump in PR.
- **Health endpoint with a DB query slows readiness probes** by ~1ms per
  check. Negligible at 1 probe / 10 s.
- **Rollback assumes the previous revision is still functional.** If the
  underlying issue is data-side (e.g. a corrupt DB on the volume — not
  our case today, since the DB is in the image), rollback to the previous
  image alone won't fix it. Documented in the new deploy runbook with a
  pointer to the snapshot-restore procedure.
- **GitHub Environments approval gate** (if we enable it on `production`)
  blocks every deploy on a manual click. Probably worth it for a hobby
  project where every deploy is intentional; revisit if/when we want
  hands-off main-branch CD.

## Open questions

1. Should the `validate-artifacts` job run on PRs too, not just on
   `main`? Default: yes — catches the WAL bug at PR time, not at deploy
   time.
2. Should we ship a tiny `scripts/checkpoint-db.sh` that wraps
   `sqlite3 data/lacrosse.db 'PRAGMA wal_checkpoint(TRUNCATE);'` so
   contributors don't have to remember the incantation? (Cheap, do it.)
3. Smoke test: do we want a synthetic player-page render via a headless
   browser, or is route-level JSON enough? Default: JSON only — adding
   Playwright doubles deploy time and the SPA is decoupled from the API
   anyway.
4. Do we want a Discord/Slack notification on rollback? (Probably yes,
   reuses the webhook already configured in `ingest-nightly.yml`.)
5. Multi-revision mode + scale-to-zero interaction: a 0%-traffic revision
   that's never hit may scale to zero and take a cold start during the
   smoke test. Mitigation: the smoke step's `--max-time 15` plus a small
   warmup `curl` before assertions. Needs one real run to confirm
   timing.
