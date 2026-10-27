# D2Looter

A loot and farming companion for Diablo II: Lord of Destruction 1.14d and Diablo II: Resurrected.
Item search, drop chances worked out from the game's own treasure classes, an odds calculator,
a Holy Grail tracker, Magic Find, a rune and runeword reference, and the latest Diablo II news. It
runs entirely in the browser: no account, no ads, no analytics, and nothing is sent anywhere. The
only thing it asks for is the news headlines, from this same site, and only while the news panel is
open; radmagelabs.com passes that request on to Blizzard News.

**Use it at [radmagelabs.com/d2looter](https://radmagelabs.com/d2looter/)** (also at
[radmageirl.github.io/d2looter](https://radmageirl.github.io/d2looter/)). This is v0.2.0.

## Run it locally

On Windows, double-click `launch.cmd` (or open `index.html` in a browser). Nothing needs to be
installed or built.

To serve it over http instead (needs [Node.js](https://nodejs.org/) 22 or newer):

```
node tools/serve.mjs
```

then open http://127.0.0.1:8023/d2looter/.

## What it does

- **Items.** Every unique, set item, rune and base item of the chosen game version, with search,
  kind, category and tier filters. Each item page shows the in-game properties, requirements, its
  treasure class and the bosses and superuniques that drop it most often, and can rank every area
  monster.
- **Drop calculator.** Pick an item and a boss, superunique or monster in an area, then the
  difficulty, Magic Find, players in the game and party members in your area. It shows the chance
  per kill, the average kills to the first drop, the kills for a 50, 75, 90 and 99% chance, and
  how the number was worked out (monster level, treasure class and its upgrade, NoDrop).
- **Odds.** The chance of at least one drop in any number of runs at any odds you type in, with
  the runs needed for each confidence level.
- **Holy Grail.** A checklist of every unique and set item, with completion overall and by
  category. Progress is saved in the browser; export and import it as a JSON backup.
- **Magic Find.** Effective Magic Find for unique, set, rare and magic rolls, a chart of the
  diminishing returns, and the quality chances for any base item at any item level.
- **Runes and runewords.** Rune order and levels, every runeword with its runes, sockets, item
  types and ladder status, and a count of the runes you own to show what you can make.
- **Diablo II news.** The newest headlines from Blizzard's Diablo II: Resurrected news, with their
  dates and links to the articles, in a panel at the top of the item search. It starts closed and
  remembers whether you left it open. Headlines load at radmagelabs.com/d2looter; elsewhere the
  panel links to Blizzard's news page.
- **Themes.** System, Light, Dark and Unique (black with the gold of unique item names).

## Feedback

To report a problem or suggest something, open an issue on
[GitHub Issues](https://github.com/RadMageIRL/d2looter/issues). If you'd like to support future
projects, you can [buy me a coffee](https://buymeacoffee.com/radmageirl).

## Game versions

| Version | Data |
|---|---|
| Diablo II: LoD 1.14d | the 1.14d tables |
| D2R 3.3 (LoD ruleset) | the D2R 3.3 tables for the game without Reign of the Warlock |
| D2R 3.3 Reign of the Warlock | the 3.3 tables with the expansion; experimental |

The drop rules are the ones written up for 1.14d. D2R is assumed to run the same rules on its own
tables. Desecrated (Terror) zones, Heralds and Sunder Charm drops are not calculated yet, nor are
classic (non-expansion) games or drops made by quest scripts instead of treasure classes. The
Accuracy page in the app lists everything that is and is not covered.

## How the numbers are checked

- The 1.14d tables match a second, independent copy of the tables field for field.
- The Reign of the Warlock 3.3 tables differ from a 3.2 copy only in the places the patch 3.3
  notes describe.
- Silospen DropCalc's own expected results (about 9,600 values) are reproduced with its method on
  its tables.
- d2data's drop solver, which follows the six-item limit the same way, agrees on about 75,000
  expected item counts to its printed six significant digits.
- Every engine rule is changed one at a time in a mutation check, and a test catches each change.
- None of it has been compared with drops counted in the game.

## Tests

```
node tools/fetch-data.mjs   # once: downloads the pinned tables and reference files, checks every SHA-256
node tests/run.mjs          # unit and verification tests
node tests/smoke.mjs        # the app in headless Chrome (set CHROME_PATH if Chrome is not found)
node tests/browsers.mjs     # Chromium, Firefox and WebKit at four screen sizes (needs Playwright, see the file)
node tests/mutations.mjs    # changes one engine rule at a time and checks the tests notice
```

## Data

The app reads `js/data/<version>.js`, generated from the tables published by
[blizzhackers/d2data](https://github.com/blizzhackers/d2data) at pinned commits:

```
node tools/build-data.mjs   # rebuild js/data and js/profiles.js
node tools/verify-data.mjs  # compare the tables with Silospen's independent copy
```

`tools/sources.json` pins every input file by commit and SHA-256. See NOTICE for sources and
licenses.

### News

Blizzard's [Diablo II: Resurrected news page](https://news.blizzard.com/en-us/feed/diablo-2-resurrected)
loads its list of posts as JSON, which pages on other sites aren't allowed to read. So
radmagelabs.com passes that list through at `/d2looter/news.json`, the same way D4 Tracker gets its
news, and the news panel reads it from there. It keeps the six newest posts Blizzard tags as Diablo
II: Resurrected (the list also carries Diablo IV and Blizzard-wide posts) and keeps them in the
browser for 15 minutes. On GitHub Pages, or opened from a file, nothing passes the list through, so
the panel says where headlines load and links to Blizzard's page. `node tools/serve.mjs` passes the
list through the same way, so the panel works there too.

## License

MIT for the code (see LICENSE). The game data in `js/data/` (item names, properties, text and
drop-table numbers) comes from Blizzard's games and is not covered by the MIT license, nor are the
news headlines from Blizzard News; see NOTICE.
Diablo II and Diablo II: Resurrected are trademarks of Blizzard Entertainment; D2Looter is a free
fan tool and is not affiliated with Blizzard. Part of [RadMage Labs](https://radmagelabs.com/).
