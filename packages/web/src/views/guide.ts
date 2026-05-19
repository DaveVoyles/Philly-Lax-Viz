import { setOgMeta } from '../util/ogMeta.js';

interface GuideSection {
  title: string;
  anchor: string;
  content: string;
}

const SECTIONS: GuideSection[] = [
  {
    title: 'Dashboard',
    anchor: 'dashboard',
    content: `The home page shows the full league at a glance:<ul style="margin:0.3rem 0 0;padding-left:1.2rem;"><li><strong>Team &amp; Player of the Week</strong> - auto-calculated from the best record and top scorer</li><li><strong>All Teams grid</strong> - records, PIAA validation badges, and win-gap numbers</li><li><strong>Recent Games</strong> - last 7 days of results (auto-refreshes every 2 min during season)</li><li><strong>Game Competitiveness</strong> - margin distribution histogram</li><li><strong>Stat Leaders</strong> - saves, faceoff %, and ground ball leaders</li></ul>Click any team tile or player name to jump to their detail page.`,
  },
  {
    title: 'Stat Leaders',
    anchor: 'leaders',
    content: `View top performers in goals, assists, ground balls, caused turnovers, saves, and faceoffs. Use category tabs to switch stats. The bar chart shows the top 10; the full table below has everyone. Minimum-game thresholds filter out noise (e.g., 3+ games for counting stats, 20+ attempts for FO%).`,
  },
  {
    title: 'Top 10 Teams',
    anchor: 'top-teams',
    content: `Teams ranked by win percentage (min 3 games played). Each card shows record, goals for/against, and a composite strength score (schedule difficulty + offensive/defensive metrics). The #1 team gets a featured card. Tiebreaker: goal differential, then head-to-head result.`,
  },
  {
    title: 'Compare Teams (H2H)',
    anchor: 'h2h',
    content: `Pick two teams to see head-to-head comparison: records, shared opponents, direct matchup history, and a strength radar overlay. Use this for scouting or settling debates about who is the better team.`,
  },
  {
    title: 'Team Detail',
    anchor: 'team-detail',
    content: `Each team page includes:<ul style="margin:0.3rem 0 0;padding-left:1.2rem;"><li><strong>Record pie chart</strong> - W/L/T at a glance</li><li><strong>Team Strength radar</strong> - 5 axes (hover for explanations): Schedule Str., GF Total, GA Total, Win %, Goal Diff</li><li><strong>Top Scorers chart</strong> - horizontal bar chart of leading scorers</li><li><strong>Game log</strong> - every game with scores, links to game detail</li><li><strong>Roster</strong> - all known players with jersey numbers</li></ul>PIAA validation badge shows whether our scraped record matches the official PIAA record.`,
  },
  {
    title: 'Player Detail',
    anchor: 'player-detail',
    content: `Player profiles show per-game breakdowns, season totals, and career trends (multi-season). The pencil icon lets anyone submit a correction if a stat looks wrong. Players with multiple seasons get a line chart showing progression. Stats tracked: G, A, GB, CT, Saves, FO W/T.`,
  },
  {
    title: 'Schedule',
    anchor: 'schedule',
    content: `Full league schedule from PIAA District 1. Games grouped by date - completed games show scores, upcoming games show time/location when available. Filter by team to see only your matchups.`,
  },
  {
    title: 'College Commitments',
    anchor: 'commitments',
    content: `Track committed players. Anyone can self-submit via the form at the bottom: name, high school, position (Atk/Mid/LSM/Def/Goal), college, and division (D1/D2/D3/JUCO/MCLA). Submissions appear immediately after the nightly refresh.`,
  },
  {
    title: 'Player Map (Constellation)',
    anchor: 'constellation',
    content: `Interactive network visualization - players who competed in the same game are linked by edges. Clusters reveal conference groupings. Zoom and drag to explore; hover nodes for details.`,
  },
  {
    title: 'Team Connections Graph',
    anchor: 'graph',
    content: `Force-directed graph of the league schedule. Teams linked by games played; edge weight = number of meetings. Clusters indicate conferences or geographic groupings.`,
  },
  {
    title: 'Coach Upload',
    anchor: 'coach-upload',
    content: `Upload game stats via .xlsx or .csv spreadsheet.<br><strong>Required columns:</strong> Player Name, Game Date, Opponent<br><strong>Optional columns:</strong> Goals, Assists, Ground Balls, Caused Turnovers, Saves, FO Won, FO Taken<br><br>The system shows a preview before applying - you can verify matched players, new players to create, and stat diffs. Download the <a href="/data/upload-template.xlsx" style="color:var(--accent)">template spreadsheet</a> if you need the correct format.`,
  },
  {
    title: 'Coach Dashboard',
    anchor: 'coach-dashboard',
    content: `Select your team to see:<ul style="margin:0.3rem 0 0;padding-left:1.2rem;"><li><strong>Stat coverage</strong> - which games are missing player-level stats</li><li><strong>Performance trends</strong> - GF/GA line chart over last 10 games</li><li><strong>Practice focus</strong> - automated suggestions based on stat gaps (e.g., FO% &lt; 50% = high priority)</li><li><strong>Scouting reports</strong> - opponent profiles with top scorers and H2H history</li></ul>`,
  },
  {
    title: 'Community Corrections',
    anchor: 'corrections',
    content: `Found an error? Click the pencil icon on any player or game page. Enter the correct value and submit. <strong>How review works:</strong> reasonable corrections (within normal bounds) are auto-approved nightly. Outlier values (e.g., 15+ goals in one game) are flagged for manual admin review. All changes are auditable.`,
  },
  {
    title: 'Data Sources &amp; Freshness',
    anchor: 'sources',
    content: `<strong>Sources:</strong> PIAA District 1 (rankings, schedule), PhillyLacrosse.com (scores, stats), MaxPreps (logos), Hudl (opted-in teams), Coach uploads.<br><strong>Refresh schedule:</strong> all sources scraped nightly at ~3 AM ET. Coach uploads and corrections apply within 24 hours. The dashboard footer shows when data was last refreshed.<br><strong>Priority:</strong> Coach-submitted data &gt; Hudl &gt; PhillyLacrosse scraped &gt; PIAA.`,
  },
  {
    title: 'Hudl Integration (Auto Stat Sync)',
    anchor: 'hudl',
    content: `If your team uses Hudl, set up automatic nightly stat sync:<ol style="margin:0.3rem 0 0;padding-left:1.2rem;"><li>Go to <a href="#/admin/hudl" style="color:var(--accent)">Hudl Team Management</a> (More &rarr; Admin Hudl)</li><li>Select your team and paste your Hudl URL (e.g., <code>https://www.hudl.com/team/v2/123456</code>)</li><li>In Hudl, invite <strong>phillylaxstats@gmail.com</strong> as assistant coach</li></ol><strong>After setup:</strong> Stats sync nightly. Your players appear within 24 hours. If status shows "error", the invite hasn't been accepted yet or the URL is wrong.`,
  },
  {
    title: 'For Coaches: Quick Start',
    anchor: 'coaches',
    content: `<ol style="margin:0.3rem 0 0;padding-left:1.2rem;"><li>Upload a game spreadsheet via <a href="#/coach/upload" style="color:var(--accent)">Coach Upload</a> (use the template)</li><li>Check the <a href="#/coach/dashboard" style="color:var(--accent)">Coach Dashboard</a> for coverage gaps</li><li>Optionally set up Hudl auto-sync (see above) for hands-free stat ingestion</li></ol><strong>Tips:</strong> Coach data overrides scraped data. Players can self-correct errors. All changes are reversible.`,
  },
  {
    title: 'For Players: Quick Start',
    anchor: 'players',
    content: `<ul style="margin:0.3rem 0 0;padding-left:1.2rem;"><li><strong>Find your stats:</strong> use the search bar or browse your team page</li><li><strong>Fix errors:</strong> click the pencil icon on your player page to submit corrections</li><li><strong>College commitment:</strong> visit <a href="#/commitments" style="color:var(--accent)">Commitments</a> and fill out the form</li><li><strong>Compare:</strong> use Compare Players to see how you rank vs. anyone else</li></ul>`,
  },
  {
    title: 'FAQ',
    anchor: 'faq',
    content: `<strong>Q: Why is my team/player missing?</strong><br>A: We only have data from games that appear on PhillyLacrosse.com, PIAA, or Hudl. Ask your coach to upload stats or set up Hudl sync.<br><br><strong>Q: A stat is wrong - how do I fix it?</strong><br>A: Click the pencil icon on the player or game page. Reasonable corrections are auto-approved overnight.<br><br><strong>Q: How often is data updated?</strong><br>A: Every night at ~3 AM ET. Coach uploads and corrections process in the same nightly run.<br><br><strong>Q: Can I see stats from previous seasons?</strong><br>A: Yes - use the season dropdown on the dashboard. Historical data goes back as far as our sources provide.`,
  },
];

export function render(root: HTMLElement, _params: Record<string, string>): void {
  root.replaceChildren();
  setOgMeta({
    title: 'Site Guide | PhillyLaxStats',
    description: 'Complete guide to using PhillyLaxStats - for players, coaches, and fans.',
  });

  const heading = document.createElement('h1');
  heading.textContent = 'Site Guide';
  heading.style.marginBottom = '0.25rem';
  root.appendChild(heading);

  const intro = document.createElement('p');
  intro.className = 'muted';
  intro.style.cssText = 'margin:0 0 0.75rem; font-size:0.9rem;';
  intro.textContent = 'Everything you need to know about PhillyLaxStats. Click a section to jump to it.';
  root.appendChild(intro);

  // Table of contents - compact
  const toc = document.createElement('nav');
  toc.className = 'tile';
  toc.style.cssText = 'padding:0.6rem 1rem; margin-bottom:1rem;';
  const tocList = document.createElement('div');
  tocList.style.cssText = 'display:flex; flex-wrap:wrap; gap:0.25rem 1rem; font-size:0.85rem;';
  for (const section of SECTIONS) {
    const a = document.createElement('a');
    a.href = `#/guide#${section.anchor}`;
    a.textContent = section.title;
    a.style.color = 'var(--accent)';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById(`guide-${section.anchor}`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    tocList.appendChild(a);
  }
  toc.appendChild(tocList);
  root.appendChild(toc);

  // Sections - compact cards
  for (const section of SECTIONS) {
    const card = document.createElement('section');
    card.className = 'tile';
    card.id = `guide-${section.anchor}`;
    card.style.cssText = 'padding:0.75rem 1rem; margin-bottom:0.5rem;';

    const h2 = document.createElement('h3');
    h2.textContent = section.title;
    h2.style.cssText = 'margin:0 0 0.3rem; font-size:1rem;';
    card.appendChild(h2);

    const body = document.createElement('div');
    body.className = 'muted';
    body.style.cssText = 'line-height:1.5; font-size:0.875rem;';
    body.innerHTML = section.content;
    card.appendChild(body);

    root.appendChild(card);
  }

  // Footer
  const footer = document.createElement('p');
  footer.className = 'muted';
  footer.style.cssText = 'margin-top:1rem; text-align:center; font-size:0.8rem;';
  footer.textContent = 'Questions? Open an issue on GitHub or email phillylaxstats@gmail.com';
  root.appendChild(footer);
}
