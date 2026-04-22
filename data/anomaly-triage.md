# Ingest Anomaly Triage

Generated: 2026-04-22T18:47:37.544Z

Total anomalies: **456** across **105** unique (strategy, reason) groups.

Read-only analysis of `ingest_anomalies`. No parser changes in this pass -- this report exists to drive prioritization for W9+.

## Top patterns

| # | Strategy | Reason | Count | Fix difficulty |
|---|----------|--------|------:|:--------------:|
| 1 | quarter-line | team hint did not resolve to either side of the score line | 143 | M |
| 2 | quarter-line | period sum does not equal total -- periods stored anyway | 51 | S |
| 3 | player-stat-line | no stat tokens recognized in line | 34 | M |
| 4 | score-line | score line did not match Team A N, Team B N pattern | 16 | M |
| 5 | ranking-list | duplicate rank 1 in post | 10 | S |
| 6 | ranking-list | duplicate rank 10 in post | 10 | S |
| 7 | ranking-list | duplicate rank 2 in post | 10 | S |
| 8 | ranking-list | duplicate rank 3 in post | 10 | S |
| 9 | ranking-list | duplicate rank 4 in post | 10 | S |
| 10 | ranking-list | duplicate rank 5 in post | 10 | S |

Difficulty legend: **S** = small (regex/alias tweak), **M** = medium (parser logic), **L** = large (structural rework).

## Per-pattern detail

### 1. [M] quarter-line -- team hint did not resolve to either side of the score line

- Count: **143**
- Fix difficulty: **M**
- Rationale: Team-hint resolution: extend team_aliases with the abbreviations seen here (MHS/PHX/JBHA/etc.). Mostly mechanical alias seeding, but volume (143) and per-team variance push it past trivial.

Samples:

1. `quarter line teamHint="MHS" did not match Methacton | Phoenixville`
   - post: tuesday-boys-summaries-sponsored-by-fusion-lacrosse-6
   - url: https://phillylacrosse.com/2026/tuesday-boys-summaries-sponsored-by-fusion-lacrosse-6/
2. `quarter line teamHint="PHX" did not match Methacton | Phoenixville`
   - post: tuesday-boys-summaries-sponsored-by-fusion-lacrosse-6
   - url: https://phillylacrosse.com/2026/tuesday-boys-summaries-sponsored-by-fusion-lacrosse-6/
3. `quarter line teamHint="Shanahan" did not match WC Rustin | Bishop Shanahan`
   - post: tuesday-boys-summaries-sponsored-by-fusion-lacrosse-6
   - url: https://phillylacrosse.com/2026/tuesday-boys-summaries-sponsored-by-fusion-lacrosse-6/
4. `quarter line teamHint="JBHA" did not match Westtown School | Jack Barrack`
   - post: monday-boys-summaries-sponsored-by-fusion-lacrosse-5
   - url: https://phillylacrosse.com/2026/monday-boys-summaries-sponsored-by-fusion-lacrosse-5/
5. `quarter line teamHint="Pennridge" did not match Plymouth Whitemarsh | Archbishop Ryan`
   - post: monday-boys-summaries-sponsored-by-fusion-lacrosse-5
   - url: https://phillylacrosse.com/2026/monday-boys-summaries-sponsored-by-fusion-lacrosse-5/

### 2. [S] quarter-line -- period sum does not equal total -- periods stored anyway

- Count: **51**
- Fix difficulty: **S**
- Rationale: Soft warning -- periods are already persisted. Likely OT/SO handling or transcription quirks. Audit a sample, then either downgrade severity or special-case OT.

Samples:

1. `AIM Academy: 0,1,1 != 5`
   - post: monday-boys-summaries-sponsored-by-fusion-lacrosse-5
   - url: https://phillylacrosse.com/2026/monday-boys-summaries-sponsored-by-fusion-lacrosse-5/
2. `Central Bucks West: 4,1,3 != 4`
   - post: monday-boys-summaries-sponsored-by-fusion-lacrosse-5
   - url: https://phillylacrosse.com/2026/monday-boys-summaries-sponsored-by-fusion-lacrosse-5/
3. `Central Bucks East: 1,1,2 != 3`
   - post: monday-boys-summaries-sponsored-by-fusion-lacrosse-5
   - url: https://phillylacrosse.com/2026/monday-boys-summaries-sponsored-by-fusion-lacrosse-5/
4. `Central Bucks West: 4,3,6 != 2`
   - post: thursday-boys-summaries-sponsored-by-fusion-lacrosse-5
   - url: https://phillylacrosse.com/2026/thursday-boys-summaries-sponsored-by-fusion-lacrosse-5/
5. `Abington: 2,2,1 != 3`
   - post: thursday-boys-summaries-sponsored-by-fusion-lacrosse-5
   - url: https://phillylacrosse.com/2026/thursday-boys-summaries-sponsored-by-fusion-lacrosse-5/

### 3. [M] player-stat-line -- no stat tokens recognized in line

- Count: **34**
- Fix difficulty: **M**
- Rationale: Vocabulary gap in stat tokenizer. Inspect the 34 raw lines, group by token shape (e.g. "saves", "ground balls", abbreviations), then extend the recognized-token table.

Samples:

1. `FO - 14/18`
   - post: tuesday-boys-summaries-sponsored-by-fusion-lacrosse-6
   - url: https://phillylacrosse.com/2026/tuesday-boys-summaries-sponsored-by-fusion-lacrosse-6/
2. `Kevin Schlude captured his 100th career goal`
   - post: saturday-boys-sponsored-by-fusion-lacrosse
   - url: https://phillylacrosse.com/2026/saturday-boys-sponsored-by-fusion-lacrosse/
3. `FO 20/23`
   - post: thursday-boys-summaries-sponsored-by-fusion-lacrosse-5
   - url: https://phillylacrosse.com/2026/thursday-boys-summaries-sponsored-by-fusion-lacrosse-5/
4. `Aiden Delfin 16 of 21 FO`
   - post: thursday-boys-summaries-sponsored-by-fusion-lacrosse-5
   - url: https://phillylacrosse.com/2026/thursday-boys-summaries-sponsored-by-fusion-lacrosse-5/
5. `Ben Goldt 2 of 2 FO`
   - post: thursday-boys-summaries-sponsored-by-fusion-lacrosse-5
   - url: https://phillylacrosse.com/2026/thursday-boys-summaries-sponsored-by-fusion-lacrosse-5/

### 4. [M] score-line -- score line did not match Team A N, Team B N pattern

- Count: **16**
- Fix difficulty: **M**
- Rationale: Add alternative score-line regexes (dash separator, tab separator, "vs" form). 16 cases -- tractable but requires care to avoid false-positives on quarter lines.

Samples:

1. `La Salle at St. Joseph's Prep (Sweeney Field, St. Joe's Univ.), 7 p.m.`
   - post: philly-lacrosse-scoreboard-sponsored-by-granite-run-buick-gmc-2
   - url: https://phillylacrosse.com/2026/philly-lacrosse-scoreboard-sponsored-by-granite-run-buick-gmc-2/
2. `AIM Academy at Shipley, 4 p.m.`
   - post: philly-lacrosse-scoreboard-sponsored-by-granite-run-buick-gmc-2
   - url: https://phillylacrosse.com/2026/philly-lacrosse-scoreboard-sponsored-by-granite-run-buick-gmc-2/
3. `Half STA 6, R4`
   - post: saturday-boys-sponsored-by-fusion-lacrosse
   - url: https://phillylacrosse.com/2026/saturday-boys-sponsored-by-fusion-lacrosse/
4. `Delaware Valley 12, Minisink Valley 11 OT`
   - post: wednesday-boys-summaries-sponsored-by-fusion-lacrosse-5
   - url: https://phillylacrosse.com/2026/wednesday-boys-summaries-sponsored-by-fusion-lacrosse-5/
5. `St. Joseph's Prep 10, Downingtown East 3 (Cole's Goals Benefit)`
   - post: saturday-boys-summaries-sponsored-by-fusion-lacrosse-2
   - url: https://phillylacrosse.com/2026/saturday-boys-summaries-sponsored-by-fusion-lacrosse-2/

### 5. [S] ranking-list -- duplicate rank 1 in post

- Count: **10**
- Fix difficulty: **S**
- Rationale: Benign: same post emits the same rank multiple times (mirrored lists). Either dedupe in parser or filter from anomaly log to reduce noise.

Samples:

1. `1 Bishop Shanahan (1)`
   - post: boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa/
2. `1 Malvern Prep (Inter-Ac)`
   - post: boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa/
3. `1 Marple Newtown (1)`
   - post: boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa/
4. `1 Episcopal Academy (Inter-Ac)`
   - post: boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa/
5. `1 Marple Newtown`
   - post: boys-pa-lacrosse-state-rankings-week-4-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-4-sponsored-by-true-lacrosse-pa/

### 6. [S] ranking-list -- duplicate rank 10 in post

- Count: **10**
- Fix difficulty: **S**
- Rationale: Benign: same post emits the same rank multiple times (mirrored lists). Either dedupe in parser or filter from anomaly log to reduce noise.

Samples:

1. `10 Scranton Prep (2)`
   - post: boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa/
2. `10 Academy of the New Church (Friends)`
   - post: boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa/
3. `10 Upper Dublin (1)`
   - post: boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa/
4. `10 Germantown Academy (Inter-Ac)`
   - post: boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa/
5. `10 Scranton Prep`
   - post: boys-pa-lacrosse-state-rankings-week-4-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-4-sponsored-by-true-lacrosse-pa/

### 7. [S] ranking-list -- duplicate rank 2 in post

- Count: **10**
- Fix difficulty: **S**
- Rationale: Benign: same post emits the same rank multiple times (mirrored lists). Either dedupe in parser or filter from anomaly log to reduce noise.

Samples:

1. `2 Twin Valley (3)`
   - post: boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa/
2. `2 Episcopal Academy (Inter-Ac)`
   - post: boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa/
3. `2 Bishop Shanahan (1)`
   - post: boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa/
4. `2 Malvern Prep (Inter-Ac)`
   - post: boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa/
5. `2 Bishop Shanahan`
   - post: boys-pa-lacrosse-state-rankings-week-4-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-4-sponsored-by-true-lacrosse-pa/

### 8. [S] ranking-list -- duplicate rank 3 in post

- Count: **10**
- Fix difficulty: **S**
- Rationale: Benign: same post emits the same rank multiple times (mirrored lists). Either dedupe in parser or filter from anomaly log to reduce noise.

Samples:

1. `3 Marple Newtown (1)`
   - post: boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa/
2. `3 Hill School (MAPL)`
   - post: boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa/
3. `3 Twin Valley (3)`
   - post: boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa/
4. `3 Hill School (MAPL)`
   - post: boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa/
5. `3 Twin Valley`
   - post: boys-pa-lacrosse-state-rankings-week-4-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-4-sponsored-by-true-lacrosse-pa/

### 9. [S] ranking-list -- duplicate rank 4 in post

- Count: **10**
- Fix difficulty: **S**
- Rationale: Benign: same post emits the same rank multiple times (mirrored lists). Either dedupe in parser or filter from anomaly log to reduce noise.

Samples:

1. `4 Lampeter-Strasburg (3)`
   - post: boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa/
2. `4 Haverford School (Inter-Ac)`
   - post: boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa/
3. `4 Lampeter-Strasburg (3)`
   - post: boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa/
4. `4 Haverford School (Inter-Ac)`
   - post: boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa/
5. `4 Lampeter-Strasburg`
   - post: boys-pa-lacrosse-state-rankings-week-4-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-4-sponsored-by-true-lacrosse-pa/

### 10. [S] ranking-list -- duplicate rank 5 in post

- Count: **10**
- Fix difficulty: **S**
- Rationale: Benign: same post emits the same rank multiple times (mirrored lists). Either dedupe in parser or filter from anomaly log to reduce noise.

Samples:

1. `5 Lower Dauphin (3)`
   - post: boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa/
2. `5 Kiski Prep (IND)`
   - post: boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-6-sponsored-by-true-lacrosse-pa/
3. `5 Peters Township (7)`
   - post: boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa/
4. `5 Perkiomen School (IND)`
   - post: boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-5-sponsored-by-true-lacrosse-pa/
5. `5 Peters Township`
   - post: boys-pa-lacrosse-state-rankings-week-4-sponsored-by-true-lacrosse-pa
   - url: https://phillylacrosse.com/2026/boys-pa-lacrosse-state-rankings-week-4-sponsored-by-true-lacrosse-pa/
