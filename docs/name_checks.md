# Name collision checks

Checked 2026-09-17 with web search (US results). Goal (SPEC 3.1, 16): no invented bank, vendor, competitor, outlet, place, or prominent person should match a real US entity that committee members could mistake for the real thing.

## Bank names: no collision found

| Query | Result | Verdict |
|---|---|---|
| `"Tollgate Bank"` | Only a Bank of America branch on Tollgate Road in Bel Air, MD, plus unrelated "Tollgate" hotels and places. No institution named Tollgate Bank. | **Keep.** A branch *location name* is not a bank name. If you want extra distance, alternatives: Tollhaven Bank, Tollbridge Bank (not checked). |
| `"Calder Ridge Bank"` | Only "Calderbank" (a Scottish village and a legal term), Calder Capital (an M&A advisory firm), and Ridgewood Savings Bank. | **Keep.** |

The bank domains `calderridgebank.com` and `tollgatebank.com` were not checked for registration. They are only strings inside the sim.

## Region and cities

| Name | Query | Result | Verdict |
|---|---|---|---|
| Tamsin Valley | `"Tamsin Valley"` | Tamar Valley (Tasmania, UK), Tam Valley (Marin County, CA), Tamsin Trail (UK) | Keep |
| Tamsin City | `"Tamsin City"` | People named Tamsin; Tamaki City (NZ) | Keep |
| Kestrel Bend | `"Kestrel Bend"` | An 80-acre ranch listing in Smithville, TX; Kestrel Wealth Management in South Bend, IN | Keep (not a place or bank) |
| Marrowby | `"Marrowby"` | A short story ("Marrowby Chase"); the film *Marrowbone* | Keep |
| Pruett Landing | `"Pruett Landing"` | "Pruitt Landing," a boat launch on the Buffalo River, AR (different spelling, not a town) | Keep, minor similarity |
| New Callan | `"New Callan" town` | Callan, Ireland; Callan, TX (ghost town) | Keep |
| Ashgrove Heights | `"Ashgrove Heights"` | Ashgrove Apartments in Sterling Heights, MI; Ashgrove, Queensland | Keep |
| Greaves Crossing | `"Greaves Crossing"` | Greaves Avenue overpass, Staten Island | Keep |
| Corvalle | `"Corvalle" city` | **Corvalle winery, St. Helena, CA**; close to Corvallis, OR | **Renamed** to Lorne Prairie |
| Lorne Prairie | `"Lorne Prairie"` | Lorne Park Prairie (a park in Mississauga, Ontario); Municipality of Lorne (Manitoba) | Keep (Canadian park, not a US town) |
| Harrow Mills | `"Harrow Mills"` | The Old Mill in Harrow, Ontario; UK solicitors in Harrow | Keep |
| Oswin Falls | `"Oswin Falls"` | Nothing; similar names Owen Falls and Osprey Falls | Keep |

## Vendors

| Name | Query | Result | Verdict |
|---|---|---|---|
| Lumenfold | `"Lumenfold" AI` | **Real enterprise AI automation company (tolasan.com)** | **Renamed** to Brevanta |
| Brevanta | `"Brevanta" AI` | Brevian (AI platform), Brev (music/strategy apps). No exact match. | Keep |
| Quarrystone Core Systems | `"Quarrystone" core banking software` and `"Quarrystone Core" OR "Ledgerlight" fintech company` | No match | Keep |
| VeriTrace | `"Veritrace" fraud analytics` | **Real anti-counterfeiting and fraud prevention company (veritrace.com)** | **Renamed** to Sablecrest Analytics |
| Sablecrest Analytics | `"Sablecrest"` | A street in Houston, a chair design | Keep |
| Brightwater Decisioning | `"Brightwater Decisioning" OR "Brightwater" credit underwriting AI lending` | No exact match, but "Brightwater" is a common financial brand | Replaced as a precaution with Ravelle Decisioning |
| Ravelle Decisioning | `"Ravelle Decisioning" OR "Ravelle" credit AI` | No match | Keep |
| Parlance Voice | `"Parlance Voice" OR "Parlance" contact center AI bank` | **Parlance (parlancecorp.com) is a real conversational voice AI company for contact centers**; Parloa is similar | **Renamed** to Callowen |
| Callowen | `"Callowen" voice AI` | No match | Keep |
| Tessellate CRM | `"Tessellate CRM"` | **Several real companies named Tessellate**, including a fintech advisory firm | **Renamed** to Meridel CRM |
| Meridel CRM | `"Meridel" CRM software` | MeraCRM (India). No exact match. | Keep |
| Kindling Labs | `"Kindling Labs" marketing` | **Several real marketing firms named Kindling** | **Renamed** to Orrin Signal |
| Orrin Signal | `"Orrin Signal" OR "OrrinSignal"` | Only people named Orrin | Keep |
| Quillmate | `"Quillmate" AI assistant` | **Real AI writing app (quillmate.io)** | **Renamed** to Deskwright, then Tallyhand |
| Deskwright | `"Deskwright" software` | **Real open-source AI desktop-control project on GitHub** | **Renamed** to Tallyhand |
| Tallyhand | `"Tallyhand" software` | Tally Solutions, TallyHo. No exact match. | Keep |
| Graywell Security | `"Graywell Security"` | **Graywell Technologies and Graywell Design both offer security services** | **Renamed** to Halvard Security |
| Halvard Security | `"Halvard Shield" OR "Halvard Security" cybersecurity` | Havoc Shield, Shield Cyber. No exact match. | Keep |
| Coppervane Cloud | `"Coppervane" cloud software` | CopperEgg, CloudVane. No exact match. | Keep |
| Ledgerlight | `"Ledgerlight" AML compliance software` | No match | Keep |
| Aldermoor Advisory | `"Aldermoor Consulting" OR "Aldermoor Advisory"` | Aldermoor Health Centre (UK), Alder Consulting | Keep |
| Hollis & Crane Data | `"Hollis & Crane" data consulting` | Separate Hollis and Crane firms, no combined name | Keep |
| Cordwain Systems | `"Cordwain Systems" OR "Cordwain" document AI` | CORD.ai, Cordage. No exact match. | Keep |

## Competitors

| Name | Query | Result | Verdict |
|---|---|---|---|
| Vallory Bank & Trust | `"Vallory Bank"` | Valley Bank, Vallant Bank (GA), Valliance Bank (GA). No exact match. | Keep. Closest real names: Vallant, Valliance. |
| Stannard Financial | `"Stannard Financial" OR "Stannard Bank"` | **Stannard Financial Services, LLC, a real broker-dealer in Pipestone, MN** | **Renamed** to Dunmoor Bancorp |
| Dunmoor Bancorp | `"Dunmoor Bancorp" OR "Dunmoor Bank"` | Dundee Bancorp (Canada). No exact match. | Keep |
| Lendara | `"Lendara" lender` | **Multiple real lenders: Lendara Mortgage Group (TX), Lendara Capital, lendara.com** | **Renamed** to Plovera |
| Plovera | `"Plovera" lending app` | Plova Infotech (Indian B2B credit data). No exact match. | Keep |
| Quickcrest | `"Quickcrest" fintech OR loans` | QuickCred, Quick Credit. No exact match. | Keep |
| Greaves County State Bank, Oswin Valley Credit Union, Tamsin Teachers Federal Credit Union | Not searched separately | Named after the checked place names above | Keep |

## Media outlets

| Name | Query | Result | Verdict |
|---|---|---|---|
| Ledger & Vault | `"Ledger & Vault" OR "Ledger and Vault" banking news` | **Ledger Vault, a real crypto custody product** | **Renamed** to Core & Branch |
| Core & Branch | `"Core & Branch" banking trade publication` | No match | Keep |
| The Branch Report | `"The Branch Report" banking newsletter` | **The World Branch Report, published by The Financial Brand** (too close) | **Renamed** to The Deposit Line |
| The Deposit Line | `"The Deposit Line" newsletter bank` | MoFo's "Monthly Deposits"; The Bank Treasury Newsletter. No exact match. | Keep |
| Regional Banking Week | `"Regional Banking Week"` | BAFT Regional Bank Conference; generic news. No publication by this name. | Keep |
| Tamsin Valley Business Journal / Tamsin City Courier | `"Tamsin Valley Business Journal" OR "Tamsin City Courier"` | No match | Keep |
| Valley 11 News | Not searched | Generic station branding, no call letters, tied to the invented region | Keep, low risk |

## People (spot checks)

| Name | Query | Result | Verdict |
|---|---|---|---|
| Dana Whitfield | `"Dana Whitfield" CFO bank` | **Shows up as a made-up CFO in AI-generated demo content (a GitHub loan-demo repo and a Substack post about drafting with Claude)**, and a real startup CEO | **Not used.** A name already common in AI-generated sample content could cue the committee members. CFO renamed to Gail Pruszynski. |
| Samuel Okafor | `"Samuel Okafor" risk officer` | **Real 22-year risk executive at NatWest and Coutts** | **Not used.** CRO renamed to Walter Ingebretsen. |
| Raymond Achterberg | `"Raymond Achterberg"` | A badminton player profile and an obituary; not prominent | Keep |
| Martin Dubrowski | `"Martin Dubrowski"` | No notable match | Keep |
| Brooke Lindqvist | `"Brooke Lindqvist"` | No notable match | Keep |
| Harold Brandvold (CEO) | `"Harold Brandvold"` | Obituaries under the surname only | Keep |
| Elaine Moorcroft | `"Elaine Moorcroft"` | A Catholic school principal (nun), private individuals | Keep, not prominent |
| Luis Arredondo | `"Luis Arredondo" bank lending` | Louis Arredondo, owner of a Kansas City loan-strategies firm; a McKinsey employee | **Not used** because a similar name is in lending. Lending head renamed to Hector Villaseñor. |
| Walter Ingebretsen | `"Walter Ingebretsen"` | No match | Keep |
| Gail Pruszynski | `"Gail Pruszynski"` | A deceased private individual (a Gale L. Pruszynski, 1954–2002) | Keep |
| Hector Villaseñor | `"Hector Villasenor" bank` | IT director at Ria Money Transfer (a money-transfer firm, not a bank lending role); not prominent | Keep, minor. Swap if you want zero overlap with financial services. |
| Carolyn Reinholt (replacement COO) | `"Carolyn Reinholt"` | Carolyn Reinholdt, a real estate agent in the SF Bay Area (different spelling) | Keep |
| Victor Hanrahan (replacement CFO) | `"Victor Hanrahan"` | Private individuals; Victoria Hanrahan (Nokia) | Keep |
| Evelyn Sorensen (board chair) | `"Evelyn Sorensen" board chair` | A research assistant and a Continuum Capital employee; no board chair | Keep |

Not individually searched: Priya Raghunathan, the other six replacement executives (Nathan Pfeiffer, Anita Szalai, Howard Linwood, Joan Tervalon, Tamara Beckwith, Jordan Esquivel), the other board members, the 27 staff names, and the examiners (Lorraine Whitcomb, Gerald Muncy). These are ordinary name combinations with no intended reference to anyone. Check them before the full run if you want complete coverage.

## Other notes

- The bank phone number `(608) 555-0142` uses the 555-01XX range reserved for fictional use. Area code 608 is real (Wisconsin).
- Real US cities (Chicago suburbs, Cleveland, Minneapolis) and general descriptions ("a $31 billion Midwest bank") appear in career histories and vendor descriptions for texture. No real companies are named.
- `universe.yaml` refers to the regulator as "Federal Reserve Bank, Seventh District." The Seventh District is the real Chicago Fed district. That fits a Midwest state member bank, but the Chicago Fed is not named.
