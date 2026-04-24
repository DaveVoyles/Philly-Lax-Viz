# Queue A — Player Overcount Review (16 games)

Games where PhillyLacrosse player goal sum exceeds the MaxPreps team total.
These weren't auto-applied; each needs a human call.

**Trust order:** PIAA > MaxPreps > PhillyLacrosse. MP score is the team total per the source authority hierarchy. Player overcount on the PL side typically means the summary parser double-counted, miscredited goals across siblings, or attributed an away-side goal to a home-side player.

**Companion JSON:** `.github/docs/2026-04-24-queue-a-player-overcounts.json` (full per-game player breakdown).

---

## Summary table

| Game | Date | Matchup | Suspect | PL→MP | Δ | Players w/ goals | MaxPreps URL |
|---|---|---|---|---|---|---|---|
| 200 | 2026-04-14 | Holy Ghost Prep @ Council Rock North (4-20) | Council Rock North | 20→15 | +5 | 8 (21g) | [link](https://www.maxpreps.com/games/04-14-2026/lacrosse-26/council-rock-north-vs-holy-ghost-prep.htm?c=NyTLiBdu20KvvAQDd7xq7g) |
| 7 | 2026-04-21 | Holy Ghost Prep @ Council Rock South (4-15) | Council Rock South | 15→14 | +1 | 5 (17g) | [link](https://www.maxpreps.com/games/04-21-2026/lacrosse-26/council-rock-south-vs-holy-ghost-prep.htm?c=nIIPXCYQQkG_c9iCbtpAgA) |
| 16 | 2026-04-21 | Lower Merion @ Conestoga (1-14) | Conestoga | 14→14 | +0 | 8 (15g) | [link](https://www.maxpreps.com/games/04-21-2026/lacrosse-26/conestoga-vs-lower-merion.htm?c=9F85ZwrjLkWLoTkxQIigZw) |
| 105 | 2026-04-18 | Lewisburg @ Crestwood (5-19) | Crestwood | 19→19 | +0 | 9 (20g) | [link](https://www.maxpreps.com/games/04-18-2026/lacrosse-26/crestwood-vs-lewisburg.htm?c=JFE8HoAhvkmjTtYtnT7_eA) |
| 107 | 2026-04-17 | Penn Charter @ Malvern Prep (2-16) | Malvern Prep | 16→16 | +0 | 13 (18g) | [link](https://www.maxpreps.com/games/04-17-2026/lacrosse-26/malvern-prep-vs-william-penn-charter.htm?c=GVuaR68mW0OAifX0LycOBw) |
| 180 | 2026-04-14 | Lake-Lehman @ Abington Heights (3-20) | Abington Heights | 20→20 | +0 | 12 (23g) | [link](https://www.maxpreps.com/games/04-14-2026/lacrosse-26/abington-heights-vs-lake-lehman.htm?c=Lit2cID9sUK93Ign1bCf7w) |
| 202 | 2026-04-14 | Berks Catholic @ Twin Valley (3-20) | Twin Valley | 20→20 | +0 | 12 (23g) | [link](https://www.maxpreps.com/games/04-14-2026/lacrosse-26/berks-catholic-vs-twin-valley.htm?c=kCqkwmNYYEKYtH3OWT4nrQ) |
| 239 | 2026-04-10 | Wilkes Barre Area @ Scranton Prep (4-24) | Scranton Prep | 24→24 | +0 | 13 (25g) | [link](https://www.maxpreps.com/games/04-10-2026/lacrosse-26/scranton-prep-vs-wilkes-barre.htm?c=EB-EJqHoCUmCUqub8PIJjw) |
| 339 | 2026-03-30 | Delaware Valley @ Valley Central (NY) (6-7) | Delaware Valley | 6→6 | +0 | 5 (7g) | [link](https://www.maxpreps.com/games/03-30-2026/lacrosse-26/delaware-valley-vs-valley-central.htm?c=m5-OVXdDp0emAjYZ7Y0uPQ) |
| 400 | 2026-03-25 | Lewisburg @ Abington Heights (3-19) | Abington Heights | 19→19 | +0 | 12 (22g) | [link](https://www.maxpreps.com/games/03-25-2026/lacrosse-26/abington-heights-vs-lewisburg.htm?c=lH8pCyYC6kyhhQeS_gQpmw) |
| 434 | 2026-03-23 | Wyoming Area @ Abington Heights (1-19) | Abington Heights | 19→19 | +0 | 12 (20g) | [link](https://www.maxpreps.com/games/03-23-2026/lacrosse-26/abington-heights-vs-wyoming-area.htm?c=Ed3aW9mwxE6IMhNGA25M9Q) |
| 450 | 2026-03-21 | Central Bucks West @ Ridley (9-19) | Ridley | 19→19 | +0 | 9 (19g) | [link](https://www.maxpreps.com/games/03-21-2026/lacrosse-26/central-bucks-west-vs-ridley.htm?c=A_Hu7n-65UKbFrG2sgVVxg) |
| 483 | 2026-03-19 | Central Bucks South @ Conestoga (3-6) | Conestoga | 6→6 | +0 | 5 (9g) | [link](https://www.maxpreps.com/games/03-19-2026/lacrosse-26/central-bucks-south-vs-conestoga.htm?c=X-ovqmLiNE-bgAK_5N6r8w) |
| 487 | 2026-03-19 | Neshaminy @ Father Judge (5-14) | Father Judge | 14→14 | +0 | 7 (15g) | [link](https://www.maxpreps.com/games/03-19-2026/lacrosse-26/father-judge-vs-neshaminy.htm?c=HeYJGVPe5E-8xFErrPEM2g) |
| 519 | 2026-03-14 | Landon School @ Malvern Prep (6-11) | Malvern Prep | 11→11 | +0 | 6 (12g) | [link](https://www.maxpreps.com/games/03-14-2026/lacrosse-26/landon-vs-malvern-prep.htm?c=ukDfvqxdmka6m0zOZjeJ3g) |
| 528 | 2026-03-13 | Abington @ Council Rock North (2-17) | Council Rock North | 17→17 | +0 | 8 (18g) | [link](https://www.maxpreps.com/games/03-13-2026/lacrosse-26/abington-vs-council-rock-north.htm?c=67JE9lT_skWeCQXJHenl5Q) |

---

## Per-game detail

### Game 200 — 2026-04-14 — Holy Ghost Prep @ Council Rock North

- **Suspect side:** home (Council Rock North)
- **PhillyLacrosse score:** 20  ·  **MaxPreps score:** 15  ·  **Overcount:** +5
- **PL final:** Holy Ghost Prep 4 — Council Rock North 20
- **MaxPreps:** https://www.maxpreps.com/games/04-14-2026/lacrosse-26/council-rock-north-vs-holy-ghost-prep.htm?c=NyTLiBdu20KvvAQDd7xq7g
- **Player goals attributed (sum=21):**
  - Trey Minter: 4g, 9a
  - Liam Dudley: 4g, 1a
  - Chase Steadman: 2g, 1a
  - Liam Costello: 2g, 1a
  - Chase Klein: 2g, 0a
  - Billy McBride: 4g, 1a
  - Chase Gillie: 2g, 0a
  - Hayden Eshalman: 1g, 0a

### Game 7 — 2026-04-21 — Holy Ghost Prep @ Council Rock South

- **Suspect side:** home (Council Rock South)
- **PhillyLacrosse score:** 15  ·  **MaxPreps score:** 14  ·  **Overcount:** +1
- **PL final:** Holy Ghost Prep 4 — Council Rock South 15
- **MaxPreps:** https://www.maxpreps.com/games/04-21-2026/lacrosse-26/council-rock-south-vs-holy-ghost-prep.htm?c=nIIPXCYQQkG_c9iCbtpAgA
- **Player goals attributed (sum=17):**
  - Hayden Cattie: 7g, 2a
  - Conor McCaffery: 5g, 2a
  - Pat Malone: 3g, 1a
  - Cole Telegadis: 1g, 0a
  - Lucas Lacey: 1g, 0a

### Game 16 — 2026-04-21 — Lower Merion @ Conestoga

- **Suspect side:** home (Conestoga)
- **PhillyLacrosse score:** 14  ·  **MaxPreps score:** 14  ·  **Overcount:** +0
- **PL final:** Lower Merion 1 — Conestoga 14
- **MaxPreps:** https://www.maxpreps.com/games/04-21-2026/lacrosse-26/conestoga-vs-lower-merion.htm?c=9F85ZwrjLkWLoTkxQIigZw
- **Player goals attributed (sum=15):**
  - Liam Donovan: 3g, 2a
  - Charlie Pulliam: 5g, 0a
  - Happy Mayer: 2g, 1a
  - Whit Lukens: 1g, 0a
  - Ryder Burling: 1g, 0a
  - Nate Mercaldo: 1g, 0a
  - Henry Cook: 1g, 0a
  - George McGrath: 1g, 0a

### Game 105 — 2026-04-18 — Lewisburg @ Crestwood

- **Suspect side:** home (Crestwood)
- **PhillyLacrosse score:** 19  ·  **MaxPreps score:** 19  ·  **Overcount:** +0
- **PL final:** Lewisburg 5 — Crestwood 19
- **MaxPreps:** https://www.maxpreps.com/games/04-18-2026/lacrosse-26/crestwood-vs-lewisburg.htm?c=JFE8HoAhvkmjTtYtnT7_eA
- **Player goals attributed (sum=20):**
  - Kevin Schlude: 5g, 1a
  - Logan Lawson: 1g, 1a
  - Ty McConnell: 3g, 1a
  - Gianni Piccolotti: 2g, 3a
  - Cole Pugh: 4g, 0a
  - Kieren Koons: 2g, 0a
  - Trey McConnell: 1g, 0a
  - Jake Jeckell: 1g, 1a
  - Allen Seifert: 1g, 0a

### Game 107 — 2026-04-17 — Penn Charter @ Malvern Prep

- **Suspect side:** home (Malvern Prep)
- **PhillyLacrosse score:** 16  ·  **MaxPreps score:** 16  ·  **Overcount:** +0
- **PL final:** Penn Charter 2 — Malvern Prep 16
- **MaxPreps:** https://www.maxpreps.com/games/04-17-2026/lacrosse-26/malvern-prep-vs-william-penn-charter.htm?c=GVuaR68mW0OAifX0LycOBw
- **Player goals attributed (sum=18):**
  - Joey Murphy: 1g, 0a
  - Tommy Onderdonk: 1g, 0a
  - George Irish: 3g, 0a
  - Shane Adams: 1g, 0a
  - Dan Riely: 1g, 0a
  - Jamie McCracken: 1g, 0a
  - House Young: 1g, 0a
  - Kane Primanti: 1g, 0a
  - Terry Clark: 2g, 0a
  - Declan Pyfer: 1g, 1a
  - Calvin Mattice: 2g, 1a
  - Nate Hengst: 1g, 1a
  - Thomas Ploszay: 2g, 0a

### Game 180 — 2026-04-14 — Lake-Lehman @ Abington Heights

- **Suspect side:** home (Abington Heights)
- **PhillyLacrosse score:** 20  ·  **MaxPreps score:** 20  ·  **Overcount:** +0
- **PL final:** Lake-Lehman 3 — Abington Heights 20
- **MaxPreps:** https://www.maxpreps.com/games/04-14-2026/lacrosse-26/abington-heights-vs-lake-lehman.htm?c=Lit2cID9sUK93Ign1bCf7w
- **Player goals attributed (sum=23):**
  - Braghan Pallis: 5g, 3a
  - Chris Bohn: 4g, 2a
  - Gavin Lindsay: 2g, 3a
  - Rodman Azar: 2g, 1a
  - Gavin Anders: 2g, 1a
  - Mike Oboyle: 1g, 1a
  - Ryan Repshis: 1g, 1a
  - Logan Fedor: 1g, 0a
  - Mike Arcure: 1g, 0a
  - Lukas Dennis: 1g, 0a
  - Mathew Mitchell: 2g, 0a
  - Lukas Broughton: 1g, 0a

### Game 202 — 2026-04-14 — Berks Catholic @ Twin Valley

- **Suspect side:** home (Twin Valley)
- **PhillyLacrosse score:** 20  ·  **MaxPreps score:** 20  ·  **Overcount:** +0
- **PL final:** Berks Catholic 3 — Twin Valley 20
- **MaxPreps:** https://www.maxpreps.com/games/04-14-2026/lacrosse-26/berks-catholic-vs-twin-valley.htm?c=kCqkwmNYYEKYtH3OWT4nrQ
- **Player goals attributed (sum=23):**
  - Keenan Munn: 1g, 6a
  - Cooper Glass: 4g, 0a
  - Drew Engle: 3g, 1a
  - Carter Borkowski: 3g, 0a
  - Brayden Fraley: 2g, 2a
  - Chase Shearer: 2g, 0a
  - Colin Gallagher: 1g, 1a
  - Patrick Shanahan: 1g, 1a
  - Addison Schneider: 1g, 1a
  - Maverik Foster: 1g, 0a
  - Minh Vo: 1g, 0a
  - Sean Murphy: 3g, 0a

### Game 239 — 2026-04-10 — Wilkes Barre Area @ Scranton Prep

- **Suspect side:** home (Scranton Prep)
- **PhillyLacrosse score:** 24  ·  **MaxPreps score:** 24  ·  **Overcount:** +0
- **PL final:** Wilkes Barre Area 4 — Scranton Prep 24
- **MaxPreps:** https://www.maxpreps.com/games/04-10-2026/lacrosse-26/scranton-prep-vs-wilkes-barre.htm?c=EB-EJqHoCUmCUqub8PIJjw
- **Player goals attributed (sum=25):**
  - Mackey Lynett: 4g, 1a
  - Braedon McPartland: 3g, 3a
  - Owen McPartland: 3g, 2a
  - Will McPartland: 2g, 0a
  - Brian James: 2g, 1a
  - Tate Cullen: 2g, 0a
  - Packey Abrahamsen: 2g, 0a
  - Roman Lowe: 2g, 0a
  - Robert Hogan: 1g, 0a
  - Max McGrath: 1g, 5a
  - Thomas Lynett: 1g, 0a
  - Jimmy Black: 1g, 0a
  - Alex Scanlon: 1g, 0a

### Game 339 — 2026-03-30 — Delaware Valley @ Valley Central (NY)

- **Suspect side:** away (Delaware Valley)
- **PhillyLacrosse score:** 6  ·  **MaxPreps score:** 6  ·  **Overcount:** +0
- **PL final:** Delaware Valley 6 — Valley Central (NY) 7
- **MaxPreps:** https://www.maxpreps.com/games/03-30-2026/lacrosse-26/delaware-valley-vs-valley-central.htm?c=m5-OVXdDp0emAjYZ7Y0uPQ
- **Player goals attributed (sum=7):**
  - Phillip Leslie Jr.: 3g, 0a
  - Chris Devaney: 1g, 1a
  - Nova Keeling: 1g, 0a
  - Colin McGarvey: 1g, 1a
  - Tyler Husejnovic: 1g, 0a

### Game 400 — 2026-03-25 — Lewisburg @ Abington Heights

- **Suspect side:** home (Abington Heights)
- **PhillyLacrosse score:** 19  ·  **MaxPreps score:** 19  ·  **Overcount:** +0
- **PL final:** Lewisburg 3 — Abington Heights 19
- **MaxPreps:** https://www.maxpreps.com/games/03-25-2026/lacrosse-26/abington-heights-vs-lewisburg.htm?c=lH8pCyYC6kyhhQeS_gQpmw
- **Player goals attributed (sum=22):**
  - Chris Bohn: 5g, 0a
  - Ryan Repshis: 3g, 0a
  - Rodman Azar: 2g, 2a
  - Mike Oboyle: 2g, 1a
  - Thatcher Loss: 2g, 1a
  - Braghan Pallis: 1g, 5a
  - Gavin Anders: 1g, 4a
  - Gavin Lindsay: 1g, 2a
  - Logan Fedor: 1g, 1a
  - Mike Arcure: 1g, 0a
  - AH Colton Naholnik: 2g, 0a
  - AH Matt Mitchell: 1g, 0a

### Game 434 — 2026-03-23 — Wyoming Area @ Abington Heights

- **Suspect side:** home (Abington Heights)
- **PhillyLacrosse score:** 19  ·  **MaxPreps score:** 19  ·  **Overcount:** +0
- **PL final:** Wyoming Area 1 — Abington Heights 19
- **MaxPreps:** https://www.maxpreps.com/games/03-23-2026/lacrosse-26/abington-heights-vs-wyoming-area.htm?c=Ed3aW9mwxE6IMhNGA25M9Q
- **Player goals attributed (sum=20):**
  - Thatcher Loss: 3g, 1a
  - Michael O'Boyle: 3g, 2a
  - Braghan Pallis: 2g, 1a
  - Chris Bohn: 2g, 0a
  - Rodman Azar: 2g, 0a
  - Ryan Repshis: 2g, 0a
  - Gavin Lindsay: 1g, 3a
  - Logan Fedor: 1g, 2a
  - Gavin Anders: 1g, 0a
  - Rocco Sarafinko: 1g, 0a
  - Sean Beck: 1g, 0a
  - AH Matthew Mitchell: 1g, 0a

### Game 450 — 2026-03-21 — Central Bucks West @ Ridley

- **Suspect side:** home (Ridley)
- **PhillyLacrosse score:** 19  ·  **MaxPreps score:** 19  ·  **Overcount:** +0
- **PL final:** Central Bucks West 9 — Ridley 19
- **MaxPreps:** https://www.maxpreps.com/games/03-21-2026/lacrosse-26/central-bucks-west-vs-ridley.htm?c=A_Hu7n-65UKbFrG2sgVVxg
- **Player goals attributed (sum=19):**
  - Brody Bair: 3g, 6a
  - Jason Rubincam: 5g, 2a
  - Jake Keller: 3g, 0a
  - Ian Green: 2g, 0a
  - Dustin Zappone: 2g, 0a
  - Jake Busza: 1g, 1a
  - Cole Murray: 1g, 1a
  - Billy Soper: 1g, 0a
  - Nick Wood: 1g, 0a

### Game 483 — 2026-03-19 — Central Bucks South @ Conestoga

- **Suspect side:** home (Conestoga)
- **PhillyLacrosse score:** 6  ·  **MaxPreps score:** 6  ·  **Overcount:** +0
- **PL final:** Central Bucks South 3 — Conestoga 6
- **MaxPreps:** https://www.maxpreps.com/games/03-19-2026/lacrosse-26/central-bucks-south-vs-conestoga.htm?c=X-ovqmLiNE-bgAK_5N6r8w
- **Player goals attributed (sum=9):**
  - Liam Donovan: 4g, 0a
  - Charlie Pulliam: 2g, 1a
  - Happy Mayer: 1g, 1a
  - Brian Ford: 1g, 0a
  - Laird Manifold: 1g, 1a

### Game 487 — 2026-03-19 — Neshaminy @ Father Judge

- **Suspect side:** home (Father Judge)
- **PhillyLacrosse score:** 14  ·  **MaxPreps score:** 14  ·  **Overcount:** +0
- **PL final:** Neshaminy 5 — Father Judge 14
- **MaxPreps:** https://www.maxpreps.com/games/03-19-2026/lacrosse-26/father-judge-vs-neshaminy.htm?c=HeYJGVPe5E-8xFErrPEM2g
- **Player goals attributed (sum=15):**
  - Gavin Comas: 6g, 3a
  - Joe Donohue: 2g, 2a
  - Matt Carey: 3g, 0a
  - Will Mount: 1g, 1a
  - Jack Zigenfuss: 1g, 0a
  - Shaun Duffy: 1g, 0a
  - Evan Wolk: 1g, 0a

### Game 519 — 2026-03-14 — Landon School @ Malvern Prep

- **Suspect side:** home (Malvern Prep)
- **PhillyLacrosse score:** 11  ·  **MaxPreps score:** 11  ·  **Overcount:** +0
- **PL final:** Landon School 6 — Malvern Prep 11
- **MaxPreps:** https://www.maxpreps.com/games/03-14-2026/lacrosse-26/landon-vs-malvern-prep.htm?c=ukDfvqxdmka6m0zOZjeJ3g
- **Player goals attributed (sum=12):**
  - Danny Lucovich: 4g, 1a
  - Joey Murphy: 3g, 1a
  - Tommy Onderdonk: 2g, 0a
  - Brady Whalen: 1g, 0a
  - Conor McCarthy: 1g, 1a
  - TJ McDermott: 1g, 0a

### Game 528 — 2026-03-13 — Abington @ Council Rock North

- **Suspect side:** home (Council Rock North)
- **PhillyLacrosse score:** 17  ·  **MaxPreps score:** 17  ·  **Overcount:** +0
- **PL final:** Abington 2 — Council Rock North 17
- **MaxPreps:** https://www.maxpreps.com/games/03-13-2026/lacrosse-26/abington-vs-council-rock-north.htm?c=67JE9lT_skWeCQXJHenl5Q
- **Player goals attributed (sum=18):**
  - Calvin Sadovy: 2g, 0a
  - Liam Costello: 1g, 1a
  - Billy McBride: 4g, 4a
  - Trey Minter: 2g, 0a
  - Liam Dudley: 5g, 0a
  - Chase Klein: 2g, 1a
  - Nick Topalovich: 1g, 0a
  - Zach Wiener: 1g, 0a

