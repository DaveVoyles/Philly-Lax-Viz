// commits.ts — College commits view (Wave 15 Lane 3).
//
// Two-pane layout: a grid of college tiles with commit counts. Clicking a
// tile expands a per-college player list under the grid. Empty state is
// rendered when no commits exist (the common case until parsers warm up
// or the recruiting feed surfaces fresh content).

interface CollegeCount {
  college: string;
  commits: number;
}

interface CommitsListRow {
  id: number;
  playerId: number | null;
  playerName: string;
  highSchoolTeamId: number | null;
  highSchoolName: string | null;
  highSchoolLogoUrl: string | null;
  college: string;
  division: string | null;
  announcedDate: string | null;
  sourceUrl: string | null;
}

interface CollegesResponse {
  season: number | null;
  rows: CollegeCount[];
}

interface CommitsResponse {
  season: number | null;
  rows: CommitsListRow[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return (await res.json()) as T;
}

export async function render(root: HTMLElement, _params: Record<string, string>): Promise<void> {
  root.replaceChildren();

  const h1 = document.createElement('h1');
  h1.textContent = '🎓 College Commits';
  root.appendChild(h1);

  const sub = document.createElement('p');
  sub.className = 'muted';
  sub.textContent =
    'Philly-area boys committing to college lacrosse programs. Click a college to see its commits.';
  root.appendChild(sub);

  const status = document.createElement('p');
  status.textContent = 'Loading…';
  status.className = 'muted';
  root.appendChild(status);

  const gridWrap = document.createElement('section');
  gridWrap.className = 'commits-grid-wrap';
  root.appendChild(gridWrap);

  const detail = document.createElement('section');
  detail.className = 'commits-detail';
  detail.style.cssText = 'margin-top:1.5rem;';
  root.appendChild(detail);

  let colleges: CollegesResponse;
  try {
    colleges = await fetchJson<CollegesResponse>('/api/commits/colleges');
  } catch (err) {
    status.className = 'error';
    status.textContent = `Failed to load commits: ${(err as Error).message}`;
    return;
  }
  status.remove();

  if (colleges.rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.style.cssText =
      'border:1px dashed var(--border); padding:1.5rem; border-radius:8px; text-align:center;';
    empty.innerHTML = `
      <p style="font-size:1.1rem; margin:.25rem 0;">No college commits in the database yet.</p>
      <p class="muted" style="margin:.25rem 0;">
        Commits are pulled from <a href="https://phillylacrosse.com/category/recruiting/" target="_blank" rel="noopener">phillylacrosse.com/recruiting</a>.
        Run <code>tsx packages/ingest/src/cli/ingest.ts --category=commits</code> to ingest, then refresh.
      </p>`;
    gridWrap.appendChild(empty);
    return;
  }

  const grid = document.createElement('ul');
  grid.className = 'commits-grid';
  grid.style.cssText =
    'list-style:none; padding:0; display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:.75rem; margin:1rem 0;';

  const cards = new Map<string, HTMLElement>();
  for (const c of colleges.rows) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset['college'] = c.college;
    btn.style.cssText =
      'width:100%; text-align:left; padding:.75rem 1rem; border:1px solid var(--border); border-radius:8px; background:var(--bg-elev, transparent); cursor:pointer; display:flex; flex-direction:column; gap:.25rem;';
    const name = document.createElement('strong');
    name.textContent = c.college;
    const count = document.createElement('span');
    count.className = 'muted';
    count.textContent = `${c.commits} commit${c.commits === 1 ? '' : 's'}`;
    btn.appendChild(name);
    btn.appendChild(count);
    btn.addEventListener('click', () => {
      for (const [, el] of cards) el.classList.remove('active');
      btn.classList.add('active');
      void showCollege(detail, c.college);
    });
    li.appendChild(btn);
    grid.appendChild(li);
    cards.set(c.college, btn);
  }
  gridWrap.appendChild(grid);
}

async function showCollege(target: HTMLElement, college: string): Promise<void> {
  target.replaceChildren();
  const h2 = document.createElement('h2');
  h2.textContent = college;
  target.appendChild(h2);
  const status = document.createElement('p');
  status.className = 'muted';
  status.textContent = 'Loading commits…';
  target.appendChild(status);

  let resp: CommitsResponse;
  try {
    resp = await fetchJson<CommitsResponse>(
      `/api/commits?college=${encodeURIComponent(college)}&season=all`,
    );
  } catch (err) {
    status.className = 'error';
    status.textContent = `Failed: ${(err as Error).message}`;
    return;
  }
  status.remove();

  if (resp.rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No commits found for this college.';
    target.appendChild(empty);
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'commits-list';
  ul.style.cssText = 'list-style:none; padding:0; display:flex; flex-direction:column; gap:.5rem;';
  for (const r of resp.rows) {
    const li = document.createElement('li');
    li.style.cssText =
      'display:flex; justify-content:space-between; gap:.75rem; padding:.5rem .75rem; border:1px solid var(--border); border-radius:6px;';
    const left = document.createElement('div');
    if (r.playerId !== null) {
      const a = document.createElement('a');
      a.href = `#/players/${r.playerId}`;
      a.textContent = r.playerName;
      left.appendChild(a);
    } else {
      const span = document.createElement('span');
      span.textContent = r.playerName;
      left.appendChild(span);
    }
    if (r.highSchoolName) {
      const hs = document.createElement('div');
      hs.className = 'muted';
      hs.style.fontSize = '.85rem';
      hs.textContent = r.highSchoolName;
      left.appendChild(hs);
    }
    li.appendChild(left);
    const right = document.createElement('div');
    right.style.cssText = 'text-align:right;';
    if (r.division) {
      const d = document.createElement('span');
      d.className = 'muted';
      d.textContent = r.division;
      right.appendChild(d);
    }
    if (r.announcedDate) {
      const d = document.createElement('div');
      d.className = 'muted';
      d.style.fontSize = '.85rem';
      d.textContent = r.announcedDate;
      right.appendChild(d);
    }
    li.appendChild(right);
    ul.appendChild(li);
  }
  target.appendChild(ul);
}

export function destroy(): void {
  // No external resources to clean up. Stub kept for parity with other lazy
  // views (game scrubber, graph) so dispatch() can call it safely.
}
