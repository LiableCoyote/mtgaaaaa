# 🃏 MTGAAAAA

A static, GitHub-hosted site that reads your **MTG Arena** collection and **wildcards**, then tells you which decks you can build — and exactly how many wildcards each one still costs. It also links out to the big deck-sharing sites for live meta lists.

Everything runs in your browser. Your collection never leaves your machine; it's saved only in your browser's local storage.

## What it does

- **Import your collection** — upload a JSON export from a tracker (e.g. [MTGA Tool](https://mtgatool.com/)) or paste a plain text card list like `4 Lightning Strike`. Both Arena card IDs (grpIds) and card names are resolved.
- **Enter your wildcards** — common / uncommon / rare / mythic (auto-detected from the export when present).
- **See collection stats** — unique cards, copies, and a rarity breakdown.
- **Rank decks** — each bundled reference deck shows a completion bar, the wildcards needed per rarity, and a "Craftable now" badge when your wildcards cover the gap. Expand any deck for a card-by-card owned/needed view. Basic lands are always counted as owned.
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

```
site/                 # the deployed static site (GitHub Pages serves this folder)
  index.html
  css/styles.css
  js/app.js           # all app logic, no build step, no dependencies
  data/cards.json     # slim Arena card dataset (name/arena_id -> rarity, color)
  data/decks.json     # bundled reference decklists
scripts/
  build-cards.mjs     # regenerate cards.json from Scryfall bulk data
  validate-decks.mjs  # assert every deck card resolves + is a 60-card list
.github/workflows/
  deploy.yml          # deploy site/ to GitHub Pages on push to main
  refresh-cards.yml   # monthly rebuild of cards.json from Scryfall
```

## Running locally

The page uses `fetch` for its data files, so open it over HTTP (not `file://`):

```bash
npm run serve          # serves site/ at http://localhost:8137
# then open http://localhost:8137
```

## Regenerating the card data

`site/data/cards.json` is built from Scryfall's `default_cards` bulk export, keeping only cards that exist in Arena and the fields the site needs (name, arena_id, rarity, color identity, type). For a card printed at multiple rarities it records the **cheapest** one, matching Arena's craft cost.

```bash
npm run build:cards    # fetches the latest bulk file from Scryfall and rewrites cards.json
npm run validate       # checks the bundled decks still resolve
```

The `refresh-cards` GitHub Action does this automatically once a month.

## Adding or editing reference decks

Edit `site/data/decks.json` (name, format, archetype, colors, mainboard, source link), then run `npm run validate` to confirm every card name resolves against the dataset and each list totals 60 cards.

## Deploying

Push to `main` and enable **Settings → Pages → Source: GitHub Actions**. The `deploy` workflow publishes the `site/` folder.

---

Card data from [Scryfall](https://scryfall.com). Not affiliated with or endorsed by Wizards of the Coast.
