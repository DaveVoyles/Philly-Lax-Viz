# LaxNumbers Aliases — Human Review Queue

**Source:** `.github/docs/2026-04-23-laxnumbers-aliases.csv`
**Generated:** 2026-04-24 (Wave I-D)

## Status

- ✅ **6 rows** auto-seeded (confidence ≥ 0.95) — see `LAXNUMBERS_HIGH_CONF` in `seedTeamAliases.ts`
- 🔍 **48 rows** mid-confidence (0.55-0.94) — need review
- ⚠️  **48 rows** low-confidence (< 0.55) — likely no good match

## How to Triage

Edit `.github/docs/2026-04-23-laxnumbers-aliases.csv` and fill `reviewer_decision`:

- `ACCEPT:Team Name` — alias resolves to that canonical team
- `REJECT:no_match` — no team in our dataset matches this name
- `REJECT:out_of_coverage` — real team but outside Philly-area coverage

Then add the accepted entries to `LAXNUMBERS_HIGH_CONF` (or a new const) in `seedTeamAliases.ts` and run `pnpm --filter @pll/ingest aliases:seed -- --apply`.

## Mid-Confidence (0.55 – 0.94) — 48 rows

| LN Name | #Anomalies | Top Match (conf) | 2nd Match (conf) | 3rd Match (conf) |
|---|---:|---|---|---|
| `Northampton Area` | 1 | Northampton (0.838) | Scranton Prep (0.500) | North Penn (0.438) |
| `St Anthonys` | 1 | St. Anthony's (NY) (0.838) | St. Albans (0.595) | St. John's (0.595) |
| `York Catholic` | 1 | Berks Catholic (0.836) | Roman Catholic (0.764) | Lansdale Catholic (0.579) |
| `Delaware Valley Friends` | 1 | Delaware Valley (0.802) | Perk Valley (0.441) | Pleasant Valley (0.441) |
| `Central Dauphin East` | 1 | Central Bucks East (0.800) | Central Bucks West (0.650) | Central Bucks South (0.550) |
| `Wheeling Central Catholic` | 2 | Allentown Central Catholic (0.792) | Lansdale Catholic (0.530) | Berks Catholic (0.490) |
| `Hampton` | 1 | Northampton (0.786) | Harriton (0.625) | Hampton Township (0.588) |
| `West Chester Henderson` | 2 | West Chester East (0.782) | WC Henderson (0.595) | St. Christopher's (0.455) |
| `Nazareth Area` | 4 | Nazareth (0.765) | Wyoming Area (0.435) | Wilkes Barre Area (0.403) |
| `Central Catholic` | 2 | Allentown Central Catholic (0.765) | Lansdale Catholic (0.756) | Berks Catholic (0.738) |
| `North Catholic` | 1 | Berks Catholic (0.764) | Roman Catholic (0.764) | Lansdale Catholic (0.638) |
| `Church Farm School` | 1 | Church Farm (0.761) | Haverford School (0.606) | Lawrenceville School (0.500) |
| `Dallastown` | 1 | Dallas (0.750) | Easton (0.500) | Marple Newtown (0.429) |
| `Seneca Valley` | 2 | Sun Valley (0.742) | Garnet Valley (0.665) | Great Valley (0.665) |
| `Olney Charter` | 1 | Penn Charter (0.742) | Olney (0.535) | Wilkes-Barre (0.385) |
| `Governor Mifflin` | 2 | Gov. Mifflin (0.738) | Haverford High (0.375) | Lower Merion (0.375) |
| `Delone Catholic` | 2 | Berks Catholic (0.717) | Bethlehem Catholic (0.717) | Roman Catholic (0.717) |
| `Spring Grove` | 2 | Spring-Ford (0.717) | Selinsgrove (0.667) | Avon Grove (0.633) |
| `Bonner-Prendergast` | 1 | Bonner-Prendie (0.717) | Downingtown East (0.389) | Conrad Weiser (0.333) |
| `Conestoga Valley` | 2 | Conestoga (0.713) | Garnet Valley (0.613) | Great Valley (0.613) |
| `Avon Grove Charter` | 1 | Avon Grove (0.706) | Penn Charter (0.550) | Conrad Weiser (0.333) |
| `Oxford Area` | 2 | Oxford (0.695) | Wyoming Area (0.467) | Wilkes Barre Area (0.403) |
| `Tome School` | 1 | Hill School (0.686) | Perkiomen School (0.675) | Gilman School (0.665) |
| `Chartiers Valley` | 2 | Garnet Valley (0.675) | Great Valley (0.613) | Perk Valley (0.613) |
| `North Hills` | 2 | South Philly (0.667) | North Penn (0.595) | North Pocono (0.550) |
| `Penn-Trafford` | 2 | Penn Manor (0.665) | Penn Charter (0.588) | Central York (0.462) |
| `Quaker Valley` | 2 | Garnet Valley (0.665) | Perk Valley (0.665) | Sun Valley (0.665) |
| `Delaware County Christian` | 2 | Delco Christian (0.650) | Delaware Valley (0.450) | Delbarton School (NJ) (0.320) |
| `La Salle College` | 2 | La Salle (0.650) | Lansdale Catholic (0.412) | Delaware Valley (0.375) |
| `Moon Area` | 2 | Wyoming Area (0.633) | Devon Prep (0.500) | John Carroll (0.417) |
| `West York` | 1 | Central York (0.633) | Westtown (0.556) | West Chester East (0.403) |
| `Kingston` | 1 | Abington (0.625) | Easton (0.500) | Wilson (0.500) |
| `St Joseph  Hammonton` | 1 | St Joseph Metuchen (NJ) (0.622) | St. Joseph's Prep (0.524) | St. Joe's Prep (0.418) |
| `Upper St Clair` | 3 | Upper Dublin (0.621) | Upper Moreland (0.621) | Upper Darby (0.479) |
| `Cathedral Prep` | 1 | Malvern Prep (0.621) | Devon Prep (0.479) | St. Joe's Prep (0.479) |
| `Central Dauphin` | 1 | Central (0.617) | Central York (0.583) | Central Bucks East (0.494) |
| `Susquehannock` | 3 | Tunkhannock (0.615) | Broadneck (0.308) | Shawnee (0.308) |
| `Gettysburg` | 2 | Lewisburg (0.600) | Pennsbury (0.500) | Phillipsburg (0.417) |
| `Hempfield Greensburg` | 1 | Hempfield (0.600) | Mifflinburg (0.400) | Phillipsburg (0.400) |
| `Bayard Rustin` | 2 | WC Rustin (0.588) | Boys' Latin (0.462) | Harriton (0.385) |
| `Lower Dauphin` | 1 | Lower Merion (0.588) | Lower Cape May (0.550) | Upper Dublin (0.538) |
| `North Allegheny` | 3 | North Penn (0.583) | North Pocono (0.517) | Northampton (0.467) |
| `Bishop McDevitt` | 2 | Bishop Ireton (0.583) | Bishop Shanahan (0.517) | Archbishop Carroll (0.389) |
| `Mifflin County` | 1 | Mifflinburg (0.571) | Minisink Valley (0.400) | Moravian Academy (0.375) |
| `Freedom Bethlehem` | 3 | Freedom (0.562) | Cape Henlopen (0.294) | Great Valley (0.294) |
| `Liberty  Bethlehem` | 2 | Liberty (0.562) | Berks Catholic (0.353) | Cape Henlopen (0.294) |
| `Eastern York` | 1 | Central York (0.550) | Easton (0.417) | Interboro (0.417) |
| `Indiana Area` | 1 | Wyoming Area (0.550) | Wilkes Barre Area (0.462) | Cardinal O'Hara (0.429) |

## Low-Confidence (< 0.55) — 48 rows

These are unlikely to have a real match. Recommend bulk-rejecting unless you recognize a school we should add as a new team.

| LN Name | #Anomalies | Best Guess | Conf |
|---|---:|---|---:|
| `Cedar Crest` | 2 | Penncrest | 0.545 |
| `Frankford` | 1 | Spring-Ford | 0.545 |
| `Northeast` | 1 | Northampton | 0.545 |
| `Mechanicsburg` | 1 | Lewisburg | 0.538 |
| `Wilson West Lawn` | 1 | Wilson | 0.525 |
| `Danville Area` | 1 | Wyoming Area | 0.512 |
| `Northern York` | 1 | Central York | 0.512 |
| `South-Western` | 1 | South Philly | 0.512 |
| `Avonworth` | 3 | Avon Grove | 0.500 |
| `Bethel Park` | 2 | Central York | 0.500 |
| `Chambersburg` | 1 | Phillipsburg | 0.500 |
| `Kennard-Dale` | 1 | Notre Dame | 0.500 |
| `Morgantown` | 1 | Boyertown | 0.500 |
| `Red Land` | 1 | Parkland | 0.500 |
| `Solanco` | 1 | Cocalico | 0.500 |
| `Butler Area` | 2 | Wyoming Area | 0.467 |
| `Garden Spot` | 2 | Landon School | 0.462 |
| `Pine Richland` | 2 | Parkland | 0.462 |
| `Elizabethtown` | 1 | Quakertown | 0.462 |
| `Freeport Area` | 1 | Wilkes Barre Area | 0.462 |
| `State College` | 1 | Coatesville | 0.462 |
| `West Allegheny` | 1 | West Chester East | 0.462 |
| `Carlisle` | 1 | Coatesville | 0.455 |
| `Cinnaminson` | 1 | Penn Manor | 0.455 |
| `Masterman` | 1 | Lake-Lehman | 0.455 |
| `Trinity HS` | 2 | Trinity-Pawling (NY) | 0.450 |
| `Thomas Jefferson` | 1 | WC Henderson | 0.438 |
| `Canon-McMillan` | 1 | Landon School | 0.429 |
| `Ephrata` | 1 | Choate | 0.429 |
| `Fox Chapel` | 3 | Penn Charter | 0.417 |
| `Gateway` | 1 | Great Valley | 0.417 |
| `Red Lion` | 1 | Lower Merion | 0.417 |
| `Lancaster CDS` | 3 | West Chester East | 0.412 |
| `Baldwin` | 1 | Boys' Latin | 0.400 |
| `Hershey` | 1 | Horseheads (NY) | 0.400 |
| `Latrobe` | 1 | Pottsgrove | 0.400 |
| `Norwin` | 1 | North Penn | 0.400 |
| `Lampeter-Strasburg` | 2 | Lewisburg | 0.389 |
| `Mount Lebanon` | 2 | Boys' Latin | 0.385 |
| `Erie-McDowell` | 1 | Episcopal | 0.385 |
| `Warwick` | 3 | Harriton | 0.375 |
| `Cedar Cliff` | 2 | Central | 0.364 |
| `Meadville-Crawford Cty` | 2 | Haverford High | 0.364 |
| `Knoch` | 1 | Tunkhannock | 0.364 |
| `Franklin Regional` | 1 | Abington | 0.353 |
| `Taylor Allderdice` | 1 | Bonner-Prendie | 0.353 |
| `York Suburban` | 2 | Jack Barrack | 0.308 |
| `Plum` | 1 | Shipley | 0.286 |
