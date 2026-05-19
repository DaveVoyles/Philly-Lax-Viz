#!/usr/bin/env python3
"""Apply curated overrides to LaxNumbers CSV based on PA HS lacrosse knowledge.

ACCEPTS: cases where ln_name is unambiguously the same school as a DB team
         (renames, abbreviations, formal vs short names).
REJECTS: cases where ln_name is a real PA school but outside our coverage
         (Pittsburgh metro, Erie, central/western PA, NJ, NY, MD, WV).

Reasoning is captured per row so the CSV remains auditable.
"""
from __future__ import annotations
import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CSV = ROOT / ".github/docs/2026-04-23-laxnumbers-aliases.csv"

# (ln_name) -> ("ACCEPT:<target>", "<reason>") or ("REJECT", "<reason>")
DECISIONS: dict[str, tuple[str, str]] = {
    # --- ACCEPTS: same school, different naming ---
    "Freedom Bethlehem": ("ACCEPT:Freedom", "freedom_hs_bethlehem_pa"),
    "Bayard Rustin": ("ACCEPT:WC Rustin", "renamed_2017_west_chester_to_bayard_rustin"),
    "Delaware County Christian": ("ACCEPT:Delco Christian", "full_name_vs_abbrev"),
    "Governor Mifflin": ("ACCEPT:Gov. Mifflin", "abbrev_normalization"),
    "La Salle College": ("ACCEPT:La Salle", "la_salle_college_hs_wyndmoor"),
    "Liberty  Bethlehem": ("ACCEPT:Liberty", "liberty_hs_bethlehem_pa"),
    "West Chester Henderson": ("ACCEPT:WC Henderson", "wc_henderson_proposed_match_2"),
    "Bonner-Prendergast": ("ACCEPT:Bonner-Prendie", "full_name_vs_nickname"),
    "Church Farm School": ("ACCEPT:Church Farm", "school_suffix_normalization"),

    # --- REJECTS: Pittsburgh metro / Western PA ---
    "Fox Chapel": ("REJECT", "pittsburgh_metro"),
    "North Allegheny": ("REJECT", "pittsburgh_metro"),
    "Upper St Clair": ("REJECT", "pittsburgh_metro"),
    "Bethel Park": ("REJECT", "pittsburgh_metro"),
    "Butler Area": ("REJECT", "western_pa_butler_county"),
    "Chartiers Valley": ("REJECT", "pittsburgh_metro"),
    "Central Catholic": ("REJECT", "pittsburgh_central_catholic_not_allentown"),
    "Moon Area": ("REJECT", "pittsburgh_metro"),
    "Mount Lebanon": ("REJECT", "pittsburgh_metro"),
    "North Hills": ("REJECT", "pittsburgh_metro"),
    "Penn-Trafford": ("REJECT", "pittsburgh_metro_westmoreland"),
    "Pine Richland": ("REJECT", "pittsburgh_metro"),
    "Quaker Valley": ("REJECT", "pittsburgh_metro"),
    "Seneca Valley": ("REJECT", "pittsburgh_metro"),
    "Baldwin": ("REJECT", "pittsburgh_metro"),
    "Canon-McMillan": ("REJECT", "pittsburgh_metro"),
    "Franklin Regional": ("REJECT", "pittsburgh_metro_westmoreland"),
    "Freeport Area": ("REJECT", "western_pa_armstrong_county"),
    "Gateway": ("REJECT", "pittsburgh_metro"),
    "Hampton": ("REJECT", "pittsburgh_metro_allegheny_county"),
    "Hempfield Greensburg": ("REJECT", "westmoreland_county_not_lancaster"),
    "Latrobe": ("REJECT", "pittsburgh_metro_westmoreland"),
    "Norwin": ("REJECT", "pittsburgh_metro_westmoreland"),
    "Plum": ("REJECT", "pittsburgh_metro"),
    "Taylor Allderdice": ("REJECT", "pittsburgh_public"),
    "Thomas Jefferson": ("REJECT", "pittsburgh_metro"),
    "West Allegheny": ("REJECT", "pittsburgh_metro"),
    "Knoch": ("REJECT", "western_pa_butler_county"),
    "Indiana Area": ("REJECT", "western_pa_indiana_county"),
    "Erie-McDowell": ("REJECT", "erie_county"),
    "Cathedral Prep": ("REJECT", "erie_cathedral_prep"),
    "Meadville-Crawford Cty": ("REJECT", "northwest_pa"),
    "North Catholic": ("REJECT", "pittsburgh_north_catholic"),

    # --- REJECTS: York / Lancaster / Adams (south-central PA) ---
    "Lancaster CDS": ("REJECT", "lancaster_country_day_not_in_coverage"),
    "Conestoga Valley": ("REJECT", "lancaster_co_not_same_as_berwyn_conestoga"),
    "Delone Catholic": ("REJECT", "adams_county_mcsherrystown"),
    "Garden Spot": ("REJECT", "lancaster_co_new_holland"),
    "Gettysburg": ("REJECT", "adams_county"),
    "Lampeter-Strasburg": ("REJECT", "lancaster_county"),
    "Spring Grove": ("REJECT", "york_county_not_spring_ford"),
    "York Suburban": ("REJECT", "york_county"),
    "Dallastown": ("REJECT", "york_county"),
    "Eastern York": ("REJECT", "york_county"),
    "Elizabethtown": ("REJECT", "lancaster_county"),
    "Ephrata": ("REJECT", "lancaster_county"),
    "Kennard-Dale": ("REJECT", "york_county"),
    "Northern York": ("REJECT", "york_county"),
    "Red Land": ("REJECT", "york_county"),
    "Red Lion": ("REJECT", "york_county"),
    "Solanco": ("REJECT", "lancaster_county"),
    "South-Western": ("REJECT", "york_county_hanover_area"),
    "Warwick": ("REJECT", "lancaster_county"),
    "West York": ("REJECT", "york_county"),
    "York Catholic": ("REJECT", "york_county"),

    # --- REJECTS: Harrisburg / Cumberland / Dauphin / central PA ---
    "Bishop McDevitt": ("REJECT", "harrisburg_diocese_not_philly"),
    "Cedar Cliff": ("REJECT", "cumberland_county_camp_hill"),
    "Cedar Crest": ("REJECT", "lebanon_county"),
    "Central Dauphin": ("REJECT", "harrisburg_dauphin_county"),
    "Central Dauphin East": ("REJECT", "harrisburg_not_central_bucks_east"),
    "Chambersburg": ("REJECT", "franklin_county_south_central"),
    "Carlisle": ("REJECT", "cumberland_county"),
    "Hershey": ("REJECT", "dauphin_county"),
    "Lower Dauphin": ("REJECT", "dauphin_county_hummelstown"),
    "Mechanicsburg": ("REJECT", "cumberland_county"),
    "Mifflin County": ("REJECT", "central_pa_lewistown"),
    "Trinity HS": ("REJECT", "trinity_camp_hill_not_in_coverage"),
    "State College": ("REJECT", "centre_county"),

    # --- REJECTS: NEPA / Wyoming Valley ---
    "Danville Area": ("REJECT", "northumberland_county"),
    "Kingston": ("REJECT", "wyoming_valley_luzerne_county"),

    # --- REJECTS: out of state ---
    "Wheeling Central Catholic": ("REJECT", "west_virginia"),
    "Cinnaminson": ("REJECT", "south_jersey"),
    "St Anthonys": ("REJECT", "new_york"),
    "St Joseph  Hammonton": ("REJECT", "south_jersey"),
    "Tome School": ("REJECT", "maryland"),
    "Morgantown": ("REJECT", "ambiguous_berks_or_wv"),

    # --- REJECTS: different school despite name overlap ---
    "Avon Grove Charter": ("REJECT", "charter_school_distinct_from_avon_grove_hs"),
    "Delaware Valley Friends": ("REJECT", "small_paoli_quaker_school_not_dv_hs"),
    "Wilson West Lawn": ("REJECT", "berks_co_wilson_not_wilson_easton"),

    # --- REJECTS: Phila public not currently in our boys lacrosse DB ---
    "Frankford": ("REJECT", "phila_public_no_lacrosse_in_db"),
    "Masterman": ("REJECT", "phila_magnet_no_lacrosse_program"),
    "Northeast": ("REJECT", "phila_public_no_lacrosse_in_db"),
    "Olney Charter": ("REJECT", "phila_charter_no_lacrosse_in_db"),
}


def main() -> None:
    rows = list(csv.DictReader(CSV.open()))
    cols = list(rows[0].keys())
    applied = 0
    untouched = 0
    overridden = 0
    misses: list[str] = []
    for r in rows:
        ln = r["ln_name"]
        if ln in DECISIONS:
            decision, reason = DECISIONS[ln]
            existing = (r.get("reviewer_decision") or "").strip()
            if existing and not existing.startswith("REJECT|auto:"):
                # Don't overwrite manual or pre-existing accepts
                continue
            if existing.startswith("REJECT|auto:"):
                overridden += 1
            r["reviewer_decision"] = (
                f"{decision}|curated:{reason}" if decision != "REJECT"
                else f"REJECT|curated:{reason}"
            )
            applied += 1
        else:
            if not (r.get("reviewer_decision") or "").strip():
                misses.append(ln)
                untouched += 1

    with CSV.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)

    print(f"Curated decisions applied:  {applied}")
    print(f"  (overrode auto-rejects:   {overridden})")
    print(f"Rows still undecided:       {untouched}")
    if misses:
        print("Still need decisions:")
        for m in misses:
            print(f"  ?  {m}")


if __name__ == "__main__":
    main()
