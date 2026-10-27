# Changelog

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
