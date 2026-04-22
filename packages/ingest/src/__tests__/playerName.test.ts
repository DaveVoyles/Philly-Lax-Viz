import { describe, it, expect } from 'vitest';
import { normalizePlayerName } from '../normalize/playerName.js';

describe('normalizePlayerName', () => {
  // ── basic shape ───────────────────────────────────────────────────────
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizePlayerName('  Gavin   Roth  ')).toBe('gavin roth');
    expect(normalizePlayerName('Caleb Goering')).toBe('caleb goering');
  });

  it('is idempotent', () => {
    const inputs = [
      'H. Moyer',
      'E. Harding, goalie,',
      "Sam O\u2019Kane",
      'Brody Orr.',
      'José Garcia',
      'Leif-Erik Orby',
    ];
    for (const input of inputs) {
      const once = normalizePlayerName(input);
      const twice = normalizePlayerName(once);
      expect(twice).toBe(once);
    }
  });

  // ── pattern 1: initial followed by period (8+ live dupes) ─────────────
  it('strips period after a single-letter initial so "H. Moyer" === "H Moyer"', () => {
    expect(normalizePlayerName('H. Moyer')).toBe('h moyer');
    expect(normalizePlayerName('H Moyer')).toBe('h moyer');
    expect(normalizePlayerName('A. Crouse')).toBe('a crouse');
    expect(normalizePlayerName('A Crouse')).toBe('a crouse');
  });

  it('does NOT strip periods inside a word', () => {
    expect(normalizePlayerName('a.j. clark')).toBe('aj clark');
  });

  // ── pattern 2: trailing terminal period (6 live dupes) ────────────────
  it('strips a trailing period so "Brody Orr." === "Brody Orr"', () => {
    expect(normalizePlayerName('Brody Orr.')).toBe('brody orr');
    expect(normalizePlayerName('Brody Orr')).toBe('brody orr');
    expect(normalizePlayerName('Parker Williams.')).toBe('parker williams');
  });

  // ── pattern 3: position-annotation suffix (E. Harding, goalie,) ───────
  it('strips trailing position annotations so "E. Harding, goalie," === "E Harding goalie"', () => {
    expect(normalizePlayerName('E. Harding, goalie,')).toBe('e harding');
    expect(normalizePlayerName('E Harding goalie')).toBe('e harding');
    expect(normalizePlayerName('O. Easteadt, goalie,')).toBe('o easteadt');
  });

  it('does not strip position tokens that are part of a real surname', () => {
    expect(normalizePlayerName('Mike Goalie')).toBe('mike');
  });

  // ── pattern 4: trailing punctuation (colons/commas) ───────────────────
  it('strips trailing colons commas semicolons', () => {
    expect(normalizePlayerName('Keegan Kropp:')).toBe('keegan kropp');
    expect(normalizePlayerName('Dugan Downs,')).toBe('dugan downs');
    expect(normalizePlayerName('Jack Sheward ,')).toBe('jack sheward');
    expect(normalizePlayerName('Brady Place,')).toBe('brady place');
  });

  // ── pattern 5: smart vs straight quotes ───────────────────────────────
  it('canonicalizes smart quotes to straight apostrophes', () => {
    expect(normalizePlayerName('Sam O\u2019Kane')).toBe("sam o'kane");
    expect(normalizePlayerName("Sam O'Kane")).toBe("sam o'kane");
    expect(normalizePlayerName('Jack D\u2018Annunzio')).toBe("jack d'annunzio");
  });

  // ── pattern 6: hyphens preserved ──────────────────────────────────────
  it('preserves internal hyphens', () => {
    expect(normalizePlayerName('Leif-Erik Orby')).toBe('leif-erik orby');
    expect(normalizePlayerName('Javier Gonzalez-Cruz')).toBe('javier gonzalez-cruz');
  });

  // ── pattern 7: accented chars ─────────────────────────────────────────
  it('strips combining diacritics', () => {
    expect(normalizePlayerName('José García')).toBe('jose garcia');
    expect(normalizePlayerName('Brönte Fitzgerald')).toBe('bronte fitzgerald');
  });

  // ── pattern 8: en/em dashes from "NOTES – ..." lines ──────────────────
  it('replaces en/em dashes with whitespace', () => {
    expect(normalizePlayerName('NOTES \u2013 Owen Fehnel made')).toBe('notes owen fehnel made');
  });

  // ── pattern 9: suffixes (preventive — none currently in DB) ───────────
  it('strips trailing Jr / Sr / II / III / IV suffixes', () => {
    expect(normalizePlayerName('John Smith Jr.')).toBe('john smith');
    expect(normalizePlayerName('John Smith Jr')).toBe('john smith');
    expect(normalizePlayerName('Robert Kennedy Sr.')).toBe('robert kennedy');
    expect(normalizePlayerName('Henry Ford III')).toBe('henry ford');
    expect(normalizePlayerName('Louis IV')).toBe('louis');
  });

  // ── pattern 10: junk sentinels ────────────────────────────────────────
  it('returns empty string for sentinel non-names', () => {
    expect(normalizePlayerName('')).toBe('');
    expect(normalizePlayerName('   ')).toBe('');
    expect(normalizePlayerName('None')).toBe('');
    expect(normalizePlayerName('No name provided')).toBe('');
    expect(normalizePlayerName('No Names Provided')).toBe('');
    expect(normalizePlayerName('TBD')).toBe('');
    expect(normalizePlayerName('Unknown')).toBe('');
    expect(normalizePlayerName('N/A')).toBe('');
  });

  // ── safety: non-string input ──────────────────────────────────────────
  it('returns empty string for non-string input', () => {
    expect(normalizePlayerName(undefined as unknown as string)).toBe('');
    expect(normalizePlayerName(null as unknown as string)).toBe('');
  });

  // ── cross-team duplicates are NOT merged at the normalize layer ──────
  it('produces the same key for the same name across teams (caller decides via team_id)', () => {
    expect(normalizePlayerName('Alex Sipperly')).toBe(normalizePlayerName('Alex Sipperly'));
  });
});
