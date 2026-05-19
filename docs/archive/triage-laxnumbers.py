#!/usr/bin/env python3
"""Conservative auto-triage for LaxNumbers aliases.

Rules (in priority order):
  1. AUTO-ACCEPT: ln_name's normalized form is exactly an existing alias/team
     OR it follows the "X Area" -> "X" / "X High School" -> "X" PA convention
     and that exact "X" exists as a team.
  2. AUTO-REJECT (no_db_candidate): no team in DB shares any meaningful
     substring with ln_name AND top proposed match confidence < 0.55.
  3. AUTO-REJECT (western_pa): ln_name is a well-known Western PA school
     not in our Philly-area DB.
  4. NEEDS_RESEARCH: everything else.

Conservatism: when in doubt, reject (safe — alias just isn't added) or
defer to research. Never auto-ACCEPT a match we aren't very sure of.
"""
from __future__ import annotations
import csv
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CSV = ROOT / ".github/docs/2026-04-23-laxnumbers-aliases.csv"
DB = ROOT / "data/lacrosse.db"

# Known Western PA / out-of-region schools (Pittsburgh metro & beyond).
# These are LaxNumbers names that report PA HS lacrosse but won't appear
# in our Philly-focused dataset. Safe to reject.
WESTERN_PA = {
    "avonworth", "fox chapel", "bethel park", "butler area", "chartiers valley",
    "north allegheny", "upper st clair", "mt lebanon", "moon area", "peters township",
    "central catholic",  # Pittsburgh's CC, not Allentown CC
    "shady side academy", "sewickley academy", "winchester thurston",
    "north hills", "pine richland", "norwin", "hempfield area",
    "penn trafford", "penn hills", "plum", "franklin regional",
    "shaler area", "seneca valley", "deer lakes",
}

# Known good "X Area" / "X Township" / etc. PA naming conventions.
# When ln_name strips to an exact DB match, that's a high-confidence accept.
SUFFIXES = [" area", " township", " twp", " school district", " sd",
            " high school", " hs", " senior high"]


def normalize(s: str) -> str:
    s = (s or "").lower().strip()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def strip_suffix(s: str) -> str | None:
    """Return the bare name if s ends in a known PA suffix, else None."""
    for suf in SUFFIXES:
        if s.endswith(suf):
            return s[: -len(suf)].strip()
    return None


def main() -> None:
    db = sqlite3.connect(DB)
    db_teams = [
        (row[0], normalize(row[1]))
        for row in db.execute("SELECT id, name FROM teams")
    ]
    db_aliases = set()
    for row in db.execute("SELECT alias FROM team_aliases"):
        db_aliases.add(normalize(row[0]))
    by_norm = {n: i for i, n in db_teams}

    rows = list(csv.DictReader(CSV.open()))
    cols = list(rows[0].keys())

    accepts: list[tuple[dict, str, str]] = []  # (row, target_name, reason)
    rejects: list[tuple[dict, str]] = []
    research: list[dict] = []
    skipped_decided = 0

    for r in rows:
        if (r.get("reviewer_decision") or "").strip():
            skipped_decided += 1
            continue
        ln = r["ln_name"]
        ln_n = normalize(ln)
        prop1 = r.get("proposed_match_1", "")
        try:
            c1 = float(r.get("confidence_1", "0") or 0)
        except ValueError:
            c1 = 0.0

        # 0. Western PA filter — safe reject
        if ln_n in WESTERN_PA:
            rejects.append((r, "western_pa_out_of_region"))
            continue

        # 1a. ln_name is already an alias or team (shouldn't happen often, but check)
        if ln_n in db_aliases or ln_n in by_norm:
            # Already known — skip; no new alias needed.
            rejects.append((r, "already_known_in_db"))
            continue

        # 1b. PA suffix convention: "X Area" -> "X" exists?
        bare = strip_suffix(ln_n)
        if bare and bare in by_norm and prop1 and normalize(prop1) == bare:
            accepts.append((r, prop1, f"pa_suffix_convention:{ln_n}->{bare}"))
            continue

        # 1c. Top match is identical normalized form (rare, but safe accept)
        if prop1 and normalize(prop1) == ln_n and c1 >= 0.95:
            accepts.append((r, prop1, "exact_normalized_match"))
            continue

        # 2. No DB candidate at all + low conf -> safe reject
        # Heuristic: any DB team shares a meaningful word (>=4 chars) with ln_name?
        ln_words = {w for w in ln_n.split() if len(w) >= 4}
        any_overlap = False
        for _, tn in db_teams:
            tn_words = {w for w in tn.split() if len(w) >= 4}
            if ln_words & tn_words:
                any_overlap = True
                break
        if not any_overlap and c1 < 0.55:
            rejects.append((r, "no_db_candidate_low_conf"))
            continue

        # Else: needs human/web research
        research.append(r)

    # Print summary
    print(f"Already decided (kept):   {skipped_decided}")
    print(f"AUTO-ACCEPT:              {len(accepts)}")
    for r, target, reason in accepts:
        print(f"  + {r['ln_name']:30s} -> {target:30s} [{reason}]")
    print(f"AUTO-REJECT:              {len(rejects)}")
    by_reason: dict[str, int] = {}
    for _, reason in rejects:
        by_reason[reason] = by_reason.get(reason, 0) + 1
    for reason, n in sorted(by_reason.items(), key=lambda x: -x[1]):
        print(f"  - {reason}: {n}")
    print(f"NEEDS_RESEARCH:           {len(research)}")
    for r in research[:20]:
        print(f"  ? {r['ln_name']:30s} -> {r['proposed_match_1']:30s} conf={r['confidence_1']}")
    if len(research) > 20:
        print(f"    ... and {len(research) - 20} more")

    # Write decisions back to CSV
    out = []
    accepts_by_id = {id(r): (t, why) for r, t, why in accepts}
    rejects_by_id = {id(r): why for r, why in rejects}
    for r in rows:
        if id(r) in accepts_by_id:
            t, why = accepts_by_id[id(r)]
            r["reviewer_decision"] = f"ACCEPT:{t}|auto:{why}"
        elif id(r) in rejects_by_id:
            r["reviewer_decision"] = f"REJECT|auto:{rejects_by_id[id(r)]}"
        out.append(r)

    with CSV.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(out)
    print(f"\nWrote {len(out)} rows back to {CSV.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
