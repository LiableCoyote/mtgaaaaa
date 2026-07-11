#!/usr/bin/env node
// Build a slim, Arena-focused card dataset from Scryfall bulk "default_cards".
//
// Usage:
//   node scripts/build-cards.mjs [path/to/default_cards.jsonl.gz]
//
// If no local file is given, the script fetches the current bulk file from
// Scryfall. Output is written to data/cards.json — a compact map keyed by a
// normalized card name plus an arena_id -> name index, so the site can resolve
// both name-based and Arena grpId-based collection exports fully offline.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'data', 'cards.json');

const RARITY = { common: 'c', uncommon: 'u', rare: 'r', mythic: 'm', special: 's', bonus: 'b' };
// Rank so we can prefer the cheapest craftable rarity in Arena (a card printed
// at multiple rarities costs the lower wildcard to craft).
const RANK = { c: 0, u: 1, r: 2, m: 3, s: 4, b: 5 };
// Arena-playable formats -> single-letter codes stored in each card's `leg`
// field, so decks can be filtered to what is currently legal.
const FORMAT_CODE = {
  standard: 'S',
  alchemy: 'A',
  historic: 'H',
  explorer: 'E',
  timeless: 'T',
  brawl: 'B', // Historic Brawl
  standardbrawl: 'b',
};

function legalityCodes(legalities) {
  if (!legalities) return '';
  let out = '';
  for (const [fmt, code] of Object.entries(FORMAT_CODE)) {
    if (legalities[fmt] === 'legal') out += code;
  }
  return out;
}

// Normalize a card name into a stable lookup key: lowercase, strip diacritics,
// collapse whitespace. Double-faced names keep their "//" so both the full name
// and the front face resolve.
function normName(name) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/’/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

async function getStream(localPath) {
  if (localPath && fs.existsSync(localPath)) {
    process.stderr.write(`Reading local bulk file: ${localPath}\n`);
    return fs.createReadStream(localPath).pipe(zlib.createGunzip());
  }
  process.stderr.write('Fetching bulk-data metadata from Scryfall...\n');
  const meta = await fetch('https://api.scryfall.com/bulk-data').then((r) => r.json());
  const uri = meta.data.find((d) => d.type === 'default_cards').jsonl_download_uri;
  process.stderr.write(`Streaming ${uri}\n`);
  const res = await fetch(uri);
  const { Readable } = await import('node:stream');
  return Readable.fromWeb(res.body).pipe(zlib.createGunzip());
}

async function main() {
  const stream = await getStream(process.argv[2]);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  // key -> best card entry chosen across Arena printings
  const cards = new Map();
  // arena_id -> normalized name key
  const arena = {};
  let seen = 0;
  let arenaCount = 0;

  for await (const line of rl) {
    if (!line || line === '[' || line === ']') continue;
    const trimmed = line.endsWith(',') ? line.slice(0, -1) : line;
    let c;
    try {
      c = JSON.parse(trimmed);
    } catch {
      continue;
    }
    seen++;
    if (c.arena_id == null) continue; // only cards that exist in Arena
    arenaCount++;

    const rarity = RARITY[c.rarity] || 'r';
    const released = c.released_at || '1993-01-01';
    const isBasic = /Basic/.test(c.type_line || '') && /Land/.test(c.type_line || '');

    // Record arena_id -> name for grpId-based (MTGA Tool) collection exports.
    const key = normName(c.name);
    arena[c.arena_id] = key;
    // Also map front-face name so decklists using just the front resolve.
    const frontKey = key.includes(' // ') ? key.split(' // ')[0] : null;

    const entry = {
      n: c.name, // display name
      r: rarity, // rarity code
      ci: (c.color_identity || []).join(''),
      cmc: c.cmc ?? 0,
      t: (c.type_line || '').split(' //')[0].split('—')[0].trim(),
      leg: legalityCodes(c.legalities),
      basic: isBasic || undefined,
      set: c.set,
      rel: released,
    };

    for (const k of frontKey ? [key, frontKey] : [key]) {
      const prev = cards.get(k);
      // Prefer the cheapest craftable rarity across Arena printings; break ties
      // by the most recent release (best color/type/name info).
      if (!prev || RANK[rarity] < RANK[prev.r] || (RANK[rarity] === RANK[prev.r] && released > prev.rel)) {
        cards.set(k, entry);
      }
    }
  }

  const cardsObj = {};
  for (const [k, v] of cards) {
    cardsObj[k] = {
      n: v.n,
      r: v.r,
      ci: v.ci,
      cmc: v.cmc,
      t: v.t,
      ...(v.leg ? { leg: v.leg } : {}),
      ...(v.basic ? { basic: 1 } : {}),
    };
  }

  const out = {
    updated: new Date().toISOString(),
    source: 'scryfall default_cards',
    counts: { scanned: seen, arena: arenaCount, names: cards.size, arenaIds: Object.keys(arena).length },
    cards: cardsObj,
    arena,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  process.stderr.write(
    `Wrote ${OUT} (${kb} KB): ${cards.size} names, ${Object.keys(arena).length} arena ids ` +
      `from ${arenaCount} Arena printings / ${seen} scanned.\n`
  );
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + '\n');
  process.exit(1);
});
