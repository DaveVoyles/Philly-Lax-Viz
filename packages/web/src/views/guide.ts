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
    content: `The home page shows an overview of the league: Team of the Week, Player of the Week, recent results, and a grid of all teams with their records. Click any team tile to jump to their detail page.`,
  },
  {
    title: 'Stat Leaders',
    anchor: 'leaders',
    content: `View the top performers across the league in goals, assists, ground balls, caused turnovers, saves, and faceoffs. Use the category tabs to switch between stats. Click any player name to see their full profile.`,
  },
  {
    title: 'Top 10 Teams',
    anchor: 'top-teams',
    content: `The top 10 teams ranked by win percentage. Each card shows their record, goals for/against, and strength-of-schedule indicator. Teams are ranked by winning percentage with tiebreakers by goal differential.`,
  },
  {
    title: 'Compare Teams (H2H)',
    anchor: 'h2h',
    content: `Pick any two teams to see a head-to-head comparison. The page shows their records side-by-side, shared opponents, and direct matchup history (if they have played each other).`,
  },
  {
    title: 'Team Detail',
    anchor: 'team-detail',
    content: `Each team page shows their full season record (pie chart), a Team Strength radar (hover each axis for an explanation), top scorers bar chart, roster, and game-by-game results. The radar evaluates: Schedule Strength, Goals For, Goals Against, Win %, and Goal Differential.`,
  },
  {
    title: 'Player Detail',
    anchor: 'player-detail',
    content: `A player's profile shows per-game stats, season totals, career trends (if multi-season data exists), and a comparison tool. Coaches and players can submit corrections via the pencil icon if a stat looks wrong.`,
  },
  {
    title: 'Schedule',
    anchor: 'schedule',
    content: `The full league schedule pulled from PIAA District 1 officials. Games are grouped by date. Completed games show final scores; upcoming games show time/location when available.`,
  },
  {
    title: 'College Commitments',
    anchor: 'commitments',
    content: `Track which players have committed to play college lacrosse. Players can self-submit their commitment using the form at the bottom of the page - enter your name, high school, position, college, and division.`,
  },
  {
    title: 'Player Map (Constellation)',
    anchor: 'constellation',
    content: `An interactive network visualization showing player connections. Players who competed in the same game are linked. Use this to explore the competitive landscape and see which players have faced each other.`,
  },
  {
    title: 'Team Connections Graph',
    anchor: 'graph',
    content: `A force-directed graph showing how teams are connected through their schedule. Teams that played each other are linked with edges weighted by how many times they met. Clusters indicate conference or division groupings.`,
  },
  {
    title: 'Coach Upload',
    anchor: 'coach-upload',
    content: `Coaches can upload game stats via spreadsheet (.xlsx or .csv). Required columns: Player Name, Game Date, Opponent. Optional columns: Goals, Assists, Ground Balls, Caused Turnovers, Saves, FO Won, FO Taken. The system previews changes before applying them.`,
  },
  {
    title: 'Coach Dashboard',
    anchor: 'coach-dashboard',
    content: `After selecting your team, see stat coverage gaps (which games are missing player stats), performance trends over the last 10 games, practice focus suggestions based on stat gaps, and scouting reports on upcoming opponents.`,
  },
  {
    title: 'Community Corrections',
    anchor: 'corrections',
    content: `Found a stat error? Click the pencil icon on any player or game detail page to submit a correction. Corrections are reviewed automatically - reasonable changes are applied nightly; outliers are flagged for manual review.`,
  },
  {
    title: 'Data Sources',
    anchor: 'sources',
    content: `All data is sourced from official channels: PIAA District 1 (rankings, schedule), PhillyLacrosse.com (game summaries, scores, player stats), and MaxPreps (team logos). Coach-submitted data takes priority over scraped data.`,
  },
  {
    title: 'For Coaches: How to Get Your Team on PhillyLaxStats',
    anchor: 'coaches',
    content: `<strong>Step 1:</strong> Upload a game spreadsheet via Coach Upload. Use the template format (Player Name, Game Date, Opponent, Goals, Assists, etc.).<br><br><strong>Step 2:</strong> Check the Coach Dashboard to see coverage gaps and make sure all games have stats.<br><br><strong>Step 3 (Optional):</strong> If your team uses Hudl, visit the Admin Hudl page to register your Hudl team URL. Once registered, stats sync automatically each night.<br><br><strong>Tips:</strong><ul><li>Data is refreshed every night from all sources</li><li>Coach-uploaded stats override any scraped data for the same game</li><li>Players can self-submit corrections if they spot errors</li><li>All changes are auditable and reversible</li></ul>`,
  },
  {
    title: 'Hudl Integration (Automatic Stat Sync)',
    anchor: 'hudl',
    content: `If your team uses Hudl, you can set up automatic nightly stat syncing. Here is how:<br><br><strong>Step 1:</strong> Visit the <a href="#/admin/hudl" style="color:var(--accent)">Hudl Team Management</a> page (under Admin in the More menu).<br><br><strong>Step 2:</strong> Select your team from the dropdown and paste your Hudl team URL (e.g., <code>https://www.hudl.com/team/v2/123456</code>).<br><br><strong>Step 3:</strong> In Hudl, invite <strong>phillylaxstats@gmail.com</strong> as an assistant coach for your team. This is required so our system can access your stats.<br><br><strong>What happens next:</strong> Every night, our system automatically logs into Hudl and pulls per-game stats for all registered teams. Your players' stats will appear on their profile pages within 24 hours of being added to Hudl.<br><br><strong>Troubleshooting:</strong> If status shows "error", it usually means the invitation hasn't been accepted yet or the URL is wrong. Check that the URL points to your actual team page on Hudl.`,
  },
  {
    title: 'For Players: How to Use PhillyLaxStats',
    anchor: 'players',
    content: `<strong>Check your stats:</strong> Search for your name using the search bar (top-right). Your profile shows per-game breakdowns, season totals, and how you rank among league leaders.<br><br><strong>Submit a correction:</strong> If a stat is wrong, click the pencil icon on your player page. Enter the correct value and it will be reviewed.<br><br><strong>College commitments:</strong> Visit the Commitments page to announce where you are playing in college. Fill out the self-service form with your name, school, college, and division.<br><br><strong>Compare yourself:</strong> Use the Compare Players page to see how you stack up against any other player in the league.`,
  },
];

export function render(root: HTMLElement, _params: Record<string, string>): void {
  root.replaceChildren();
  setOgMeta({
    title: 'Site Guide | PhillyLaxStats',
    description: 'Complete guide to using PhillyLaxStats - for players, coaches, and fans.',
  });

  const back = document.createElement('p');
  back.className = 'muted';
  const backLink = document.createElement('a');
  backLink.href = '#/';
  backLink.textContent = '<- back to dashboard';
  back.appendChild(backLink);
  root.appendChild(back);

  const heading = document.createElement('h1');
  heading.textContent = 'Site Guide';
  root.appendChild(heading);

  const intro = document.createElement('p');
  intro.className = 'muted';
  intro.textContent = 'Everything you need to know about using PhillyLaxStats. Click a section below to jump to it.';
  root.appendChild(intro);

  // Table of contents
  const toc = document.createElement('nav');
  toc.className = 'tile';
  toc.style.cssText = 'padding:1rem 1.5rem;margin-bottom:2rem;';
  const tocTitle = document.createElement('strong');
  tocTitle.textContent = 'Jump to:';
  toc.appendChild(tocTitle);
  const tocList = document.createElement('ul');
  tocList.style.cssText = 'columns:2;column-gap:2rem;margin:0.5rem 0 0;padding-left:1.2rem;';
  for (const section of SECTIONS) {
    const li = document.createElement('li');
    li.style.marginBottom = '0.3rem';
    const a = document.createElement('a');
    a.href = `#/guide#${section.anchor}`;
    a.textContent = section.title;
    a.style.color = 'var(--accent)';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById(`guide-${section.anchor}`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    li.appendChild(a);
    tocList.appendChild(li);
  }
  toc.appendChild(tocList);
  root.appendChild(toc);

  // Sections
  for (const section of SECTIONS) {
    const card = document.createElement('section');
    card.className = 'tile';
    card.id = `guide-${section.anchor}`;
    card.style.cssText = 'padding:1.25rem 1.5rem;margin-bottom:1rem;';

    const h2 = document.createElement('h3');
    h2.textContent = section.title;
    h2.style.marginTop = '0';
    card.appendChild(h2);

    const body = document.createElement('div');
    body.className = 'muted';
    body.style.lineHeight = '1.6';
    body.innerHTML = section.content;
    card.appendChild(body);

    root.appendChild(card);
  }

  // Footer note
  const footer = document.createElement('p');
  footer.className = 'muted';
  footer.style.cssText = 'margin-top:2rem;text-align:center;font-size:0.85rem;';
  footer.textContent = 'Questions? Open an issue on GitHub or contact your league admin.';
  root.appendChild(footer);
}
