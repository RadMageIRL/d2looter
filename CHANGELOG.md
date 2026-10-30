# Changelog

## v0.3.0 (2026-10-30)

Added
- Where to farm: a new section that answers "Where should I farm this item?". Pick an item and it
  lists every boss and superunique that can drop it, on one difficulty or all three, with the
  chance per kill and per run, the average runs to a drop, and the runs for a 50% and a 90%
  chance. The numbers come from the same drop engine as the drop calculator, with its Magic Find,
  players, party and game settings.
- Runs of several kills: where several bosses and superuniques share an area (the Chaos
  Sanctuary, Durance of Hate Level 3, Travincal, the Throne of Destruction and others), that area
  is also listed as one run that kills all of them, with each kill's chance shown. A Baal run adds
  Baal to the five wave bosses. A run's chance is 1 - (1 - p1)(1 - p2)...
- Run times: type how long a run takes you (1:30, 90s, 2m 30s) and that run moves to "Your runs",
  ranked by chance per hour, with the average time to a drop and the chance of at least one drop
  in a farming time you choose. Without run times the list is ranked by chance per run and says
  so; it never guesses which run is faster. A time that can't be read is flagged and not used.
  Run times are kept in the browser for each target, so they carry over to other items.
- Area monsters can be added to the comparison per kill, with your own kills per run, because how
  many of each monster spawn is not modeled. Quest kills can be included too.
- When nothing drops an item, the section says why from the game data: never rolled at random,
  ladder only, no treasure class with its base, or every source below its item level.
- A Where to farm button on every item page opens the comparison with that item picked.

Changed
- The Diablo II News panel's headlines use the panel's full width, with each date at the far
  right, a little more space between rows and full-width dividers. Long headlines wrap, and the
  date stays on the right on phones too.
- The drop calculator and Where to farm share one game mode list (single player or realm for
  1.14d, ladder or non-ladder for D2R).
- Diablo Clone is listed by that name instead of "Diablo", so he is not mistaken for the Act 4
  boss. Uber bosses in Where to farm say they are reached only through an event.

Fixed
- The Accuracy page listed Annihilus among scripted drops that are not calculated. Diablo Clone's
  drop comes from his treasure class, which in Hell holds only Annihilus, so it was always
  calculated (1 in 1 per kill in Hell). The page now says so, and that how often you meet him (or
  any Uber boss) is not modeled. The Uber Tristram bosses' drops, the Hellfire Torch among them,
  are still not calculated: their monster rows have no treasure class.

## v0.2.0 (2026-10-26)

Added
- A Diablo II News panel at the top of the item search: the six newest headlines from Blizzard's
  Diablo II: Resurrected news, each with its date and a link to the article, and a View all news
  link to Blizzard's news page. It starts closed, asks for nothing until it is opened, and
  remembers whether it was left open.
- Blizzard's news list can't be read from another site, so radmagelabs.com passes it through at
  /d2looter/news.json, as it does for D4 Tracker, and the panel reads it there. Only posts Blizzard
  tags as Diablo II: Resurrected are shown; the list also carries Diablo IV and Blizzard-wide
  posts. Headlines are kept in the browser for 15 minutes, and a read that fails keeps the ones
  already shown. On GitHub Pages or from a file, the panel says headlines load at
  radmagelabs.com/d2looter/ and links to Blizzard's page.
- `node tools/serve.mjs` passes the news list through too, so the panel works in a local preview.
- Share, feedback and buy me a coffee links at the right end of the section tabs; on narrower
  screens they go on their own line below the tabs.
- A line of links in the footer: Source on GitHub, Share, Feedback and Buy me a coffee.
- Share always passes https://radmagelabs.com/d2looter/, whichever address the page was opened
  at. Where the device has a share sheet it opens that; otherwise, or if the sheet fails, it
  copies the link. Feedback opens the GitHub Issues page. The new links open in a new tab.
- Tests for reading Blizzard's list (with a saved page of it), the headlines kept in the browser
  and the links, and in the browsers the news panel's states and Share with and without a share
  sheet.

Changed
- The page may now read from its own site (for the news list) and still from no other.
- The README has a Feedback section and a note on where the news comes from.

## v0.1.0 (2026-10-23)

First public release, at radmagelabs.com/d2looter/ and radmageirl.github.io/d2looter/.

- Item search over every unique, set item, rune and base item, with in-game property text and
  the best boss, superunique and area monster sources for each item.
- Drop calculator from the game's treasure classes: monster level, treasure class upgrade, NoDrop
  by players and party, the six-item limit, quality rolls with Magic Find, ladder-only items.
- Odds calculator for any chance over any number of runs.
- Holy Grail tracker with category progress, JSON export and import, and recovery from a damaged
  save.
- Magic Find reference with the diminishing returns chart and quality chances for any base.
- Rune and runeword reference with owned-rune counts.
- Game versions: Diablo II LoD 1.14d, D2R 3.3 (LoD ruleset), and D2R 3.3 Reign of the Warlock
  (experimental).
- System, Light, Dark and Unique themes.
