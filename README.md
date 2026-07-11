# 🃏 MTGAAAAA

A static, GitHub-hosted site that reads your **MTG Arena** collection and **wildcards**, then tells you which decks you can build — and exactly how many wildcards each one still costs. It also links out to the big deck-sharing sites for live meta lists.

Everything runs in your browser. Your collection never leaves your machine; it's saved only in your browser's local storage.

## What it does

- **Import your collection** — upload a JSON export from a tracker (e.g. [MTGA Tool](https://mtgatool.com/)) or paste a plain text card list like `4 Lightning Strike`. Both Arena card IDs (grpIds) and card names are resolved.
- **Enter your wildcards** — common / uncommon / rare / mythic (auto-detected from the export when present).
- **See collection stats** — unique cards, copies, and a rarity breakdown.
- **Rank decks** — each deck shows a completion bar, the wildcards needed per rarity, and a "Craftable now" badge when your wildcards cover the gap. Expand any deck for a card-by-card owned/needed view. Basic lands are always counted as owned.
- **Auto-refreshed meta library** — alongside the bundled `Sample` decks, a `Meta` library is pulled weekly from [Archidekt](https://archidekt.com) for Standard and Historic, filtered to decks whose entire maindeck is *currently legal* and resolves against the Arena card data. Filter the deck list by format.
- **Find more decks** — quick links to Moxfield, Aetherhub, MTGGoldfish, MTGArena Zone, Untapped.gg, 17Lands and Scryfall.

## How the collection import works

MTG Arena has no public collection API, so you import an export from a third-party tool. The site accepts, and auto-detects, several shapes:

| Input | Example |
| --- | --- |
| Arena grpId map (MTGA Tool style) | `{ "cards": { "70123": 4 }, "wildcards": { "rare": 6 } }` |
| grpId map (bare) | `{ "70123": 4, "70456": 2 }` |
| Name map | `{ "Lightning Strike": 4 }` |
| Array of entries | `[{ "name": "Get Lost", "count": 3 }]` |
| Text list | `4 Lightning Strike` (one card per line) |

Unrecognized entries are counted and reported rather than silently dropped.

## Project layout

The site is served from the repository root so GitHub Pages ("Deploy from a
branch", root folder) hosts it with no extra configuration.

```
index.html
css/styles.css
js/app.js             # all app logic, no build step, no dependencies
data/cards.json       # slim Arena card dataset (name/arena_id -> rarity, color, legality)
data/decks.json       # bundled reference decklists (the "Sample" decks)
data/meta-decks.json  # auto-refreshed community meta decks (the "Meta" decks)
.nojekyll             # serve files as-is (skip Jekyll processing)
scripts/
  build-cards.mjs      # regenerate cards.json from Scryfall bulk data
  fetch-meta-decks.mjs # rebuild meta-decks.json from Archidekt (CI)
  validate-decks.mjs   # assert every bundled deck card resolves + is a 60-card list
.github/workflows/
  refresh-cards.yml       # monthly rebuild of cards.json from Scryfall
  refresh-meta-decks.yml  # weekly rebuild of meta-decks.json from Archidekt
```

## Running locally

The page uses `fetch` for its data files, so open it over HTTP (not `file://`):

```bash
npm run serve          # serves the repo root at http://localhost:8137
# then open http://localhost:8137
```

## Regenerating the card data

`data/cards.json` is built from Scryfall's `default_cards` bulk export, keeping only cards that exist in Arena and the fields the site needs (name, arena_id, rarity, color identity, type). For a card printed at multiple rarities it records the **cheapest** one, matching Arena's craft cost.

```bash
npm run build:cards    # fetches the latest bulk file from Scryfall and rewrites cards.json
npm run validate       # checks the bundled decks still resolve
```

The `refresh-cards` GitHub Action does this automatically once a month.

## The auto-refreshed meta library

`scripts/fetch-meta-decks.mjs` runs server-side (in CI, so there is no browser
CORS problem) and builds `data/meta-decks.json`:

1. Pulls popular + recently-updated Standard and Historic decks from Archidekt.
2. Extracts the maindeck (dropping Maybeboard/Considering categories, splitting off the sideboard).
3. Keeps a deck **only if** its total maindeck is exactly 60 cards, every card resolves against `data/cards.json`, and every non-basic card is *currently legal* in that format (using the legality codes baked into `cards.json`). This automatically filters out rotated/old lists.

```bash
node scripts/fetch-meta-decks.mjs --per=12 --scan=90
```

It is deliberately polite to Archidekt (descriptive User-Agent, small paged
requests, a delay between calls). The `refresh-meta-decks` GitHub Action runs it
weekly. Why not Moxfield/MTGGoldfish? Moxfield restricts automated API access and
neither sends the CORS headers a browser would need; Archidekt exposes a usable
JSON API, so it's the source that can be refreshed cleanly.

## Adding or editing the bundled Sample decks

Edit `data/decks.json` (name, format, archetype, colors, mainboard, source link), then run `npm run validate` to confirm every card name resolves against the dataset and each list totals 60 cards.

## Deploying

GitHub Pages serves the repository root of the published branch (**Settings →
Pages → Deploy from a branch → root**). Pushing updated files is all that's
needed — no build step.

---

Card data from [Scryfall](https://scryfall.com). Not affiliated with or endorsed by Wizards of the Coast.
