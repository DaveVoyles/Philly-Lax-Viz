// Wave 15 Lane 3 (Han 🧑‍🚀🍔) — commits parser tests.

import { describe, expect, it } from 'vitest';
import { parseCommitsPost } from '../commitsPost.js';

const LIST_POST_HTML = `
<html><body>
<h1 class="entry-title">Recent boys' commitments &#8211; Sponsored by @BerwynClub</h1>
<div class="entry-content">
<p>Phillylacrosse.com, Posted 9/3/25</p>
<p>Below are recent boys' commitments, sponsored by Berwyn Sports Club.</p>
<p>Class of 2027</p>
<p>Division I</p>
<p>Roman Ippoldo, La Salle/Brotherly Love, goalie, Cornell</p>
<p>Class of 2026</p>
<p>Division I</p>
<p>Colin Gallagher, Twin Valley/Fusion, MID, Marquette</p>
<p>Division II</p>
<p>Timmy Gathercole, Downingtown West/Freedom, SSDM/MID, Chestnut Hill</p>
<p>Luke Kell, Downingtown West/Freedom, ATT/MID, Palm Beach Atlantic</p>
<p>Division III</p>
<p>Liam Farrell, Allentown Central Catholic/Dukes Elite, ATT, DeSales</p>
<p>Andrew Haney, Conwell Egan/True Philly, DEF, Widener</p>
<p>Filed Under: Boy's/Men's, High School, Recruiting</p>
</div>
</body></html>`;

const PROFILE_POST_HTML = `
<html><body>
<h1 class="entry-title">BerwynClub Boys Recruit: Appoquinimink (DE) 2025 ATT Towns Commits to DelTech</h1>
<div class="entry-content">
<p>Phillylacrosse.com, Posted 5/8/25</p>
<p>Appoquinimink (DE) 2025 attackman Christian Towns has committed to play NJCAA lacrosse at Delaware Technical Community College.</p>
<p>Christian Towns</p>
<p>Christian Towns profile:</p>
<p>High school: Appoquinimink High School, Middletown, DE</p>
<p>Position: attackman</p>
<p>Grad year: 2025</p>
<p>College committed to: Delaware Technical Community College</p>
<p>Filed Under: Boy's/Men's, High School, Recruiting</p>
</div>
</body></html>`;

const GIRLS_POST_HTML = `
<html><body>
<h1 class="entry-title">Four Harlem Lacrosse student-athletes sign NLI</h1>
<div class="entry-content">
<p>Mya Griffith</p>
<p>Harlem Lacrosse - Philadelphia '26</p>
<p>Manhattan University '30</p>
<p>Filed Under: Girl's/Women's, High School, Recruiting</p>
</div>
</body></html>`;

const NON_COMMIT_POST_HTML = `
<html><body>
<h1 class="entry-title">Registration open for Penn Men's Lacrosse Prospect Day on Oct. 26</h1>
<div class="entry-content">
<p>The University of Pennsylvania will host its annual Prospect Day…</p>
</div>
</body></html>`;

describe('parseCommitsPost (list shape)', () => {
  it('extracts commits with division headers carrying through class boundaries', () => {
    const r = parseCommitsPost(LIST_POST_HTML);
    expect(r.isCommitPost).toBe(true);
    expect(r.commits.length).toBe(6);
    const colin = r.commits.find((c) => c.playerNameRaw === 'Colin Gallagher');
    expect(colin).toBeDefined();
    expect(colin!.college).toBe('Marquette');
    expect(colin!.division).toBe('D1');
    expect(colin!.highSchool).toBe('Twin Valley');
    expect(colin!.position).toBe('MID');

    const liam = r.commits.find((c) => c.playerNameRaw === 'Liam Farrell');
    expect(liam!.division).toBe('D3');
    expect(liam!.college).toBe('DeSales');

    // The "Class of 2027 / Division I" Roman row keeps D1.
    const roman = r.commits.find((c) => c.playerNameRaw === 'Roman Ippoldo');
    expect(roman!.division).toBe('D1');
    expect(roman!.position).toBe('goalie');

    // Date is pulled from the "Posted 9/3/25" line.
    expect(r.commits[0]!.announcedDate).toBe('2025-09-03');
  });
});

describe('parseCommitsPost (profile shape)', () => {
  it('extracts a single commit from labelled fields', () => {
    const r = parseCommitsPost(PROFILE_POST_HTML);
    expect(r.isCommitPost).toBe(true);
    expect(r.commits.length).toBe(1);
    const c = r.commits[0]!;
    expect(c.playerNameRaw).toBe('Christian Towns');
    expect(c.college).toBe('Delaware Technical Community College');
    expect(c.highSchool).toBe('Appoquinimink High School');
    expect(c.division).toBe('JUCO');
    expect(c.announcedDate).toBe('2025-05-08');
  });
});

describe('parseCommitsPost (skip cases)', () => {
  it('skips girls/women\'s posts via Filed Under', () => {
    const r = parseCommitsPost(GIRLS_POST_HTML);
    expect(r.isCommitPost).toBe(false);
    expect(r.commits.length).toBe(0);
  });
  it('returns isCommitPost=false for non-commit recruiting posts (camp listings)', () => {
    const r = parseCommitsPost(NON_COMMIT_POST_HTML);
    expect(r.isCommitPost).toBe(false);
    expect(r.commits.length).toBe(0);
  });
});
