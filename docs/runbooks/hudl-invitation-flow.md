# Hudl Team Invitation Flow

## Overview
To scrape stats from a team on Hudl, our service account must be invited as a coach/assistant on that team.

## Prerequisites
- Hudl coach account credentials (stored as HUDL_EMAIL / HUDL_PASSWORD in GitHub Secrets)
- A coach from the target team who is willing to invite our account

## Steps for the target team's coach

1. Log in to Hudl at https://www.hudl.com
2. Navigate to your team page
3. Click "Roster" or "Team Management"
4. Click "Invite" or "Add Staff"
5. Enter our service account email: [ask admin for email]
6. Set role: "Assistant Coach" (read-only access is sufficient)
7. Send invitation

## Steps for our admin (after invitation is accepted)

1. Log in to Hudl with the service account
2. Accept the team invitation
3. Note the team URL (e.g., https://www.hudl.com/team/v2/12345/HighSchool)
4. Register the team in admin UI at #/admin/hudl:
   - Select the team from the dropdown
   - Paste the Hudl team URL
   - Click "Register"
5. Run a test sync: `pnpm --filter @pll/ingest exec tsx src/scripts/syncHudl.ts --team-id=<id> --dry-run`
6. If successful, the nightly pipeline will auto-sync going forward

## Troubleshooting

- **"Team not found" error**: Invitation may not have been accepted yet
- **"Access denied"**: Role may be insufficient; ask coach to set "Assistant Coach"
- **Rate limiting**: Hudl may throttle if too many requests; script has 30s delay between teams
