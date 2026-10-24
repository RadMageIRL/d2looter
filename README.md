# D2Looter

A loot and farming companion for Diablo II: Lord of Destruction 1.14d and Diablo II: Resurrected.
Item search, drop chances worked out from the game's own treasure classes, an odds calculator,
a Holy Grail tracker, Magic Find, and a rune and runeword reference. It runs entirely in the
browser: no account, no ads, no analytics, and nothing is sent anywhere.

**Use it at [radmagelabs.com/d2looter](https://radmagelabs.com/d2looter/)** (also at
[radmageirl.github.io/d2looter](https://radmageirl.github.io/d2looter/)). This is v0.1.0.

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
- **Themes.** System, Light, Dark and Unique (black with the gold of unique item names).

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

## License

MIT for the code (see LICENSE). The game data in `js/data/` (item names, properties, text and
drop-table numbers) comes from Blizzard's games and is not covered by the MIT license; see NOTICE.
Diablo II and Diablo II: Resurrected are trademarks of Blizzard Entertainment; D2Looter is a free
fan tool and is not affiliated with Blizzard. Part of [RadMage Labs](https://radmagelabs.com/).
