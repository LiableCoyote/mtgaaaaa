#!/usr/bin/env node
// Fetch a library of community meta decks from Archidekt for the Arena-playable
// formats, keep only decks whose whole maindeck is currently legal AND resolves
// against our Arena card dataset, and write data/meta-decks.json.
//
// Runs server-side (GitHub Actions), so there is no browser CORS problem. The
// site itself stays fully static — it just reads the committed JSON.
//
// Usage: node scripts/fetch-meta-decks.mjs [--per=12] [--scan=140]
//
// Archidekt has no official public API contract; we use it politely: a
// descriptive User-Agent, small paged requests, and a delay between calls.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const CARDS = JSON.parse(fs.readFileSync(path.join(dataDir, 'cards.json'), 'utf8')).cards;
const OUT = path.join(dataDir, 'meta-decks.json');

const UA = 'mtgaaaaa/1.0 (+https://github.com/LiableCoyote/mtgaaaaa) collection deck helper';
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true])
);
const PER_FORMAT = Number(args.per) || 12;
const SCAN = Number(args.scan) || 140; // deck ids to consider per format before filtering

// Arena formats we pull. `id` is Archidekt's deckFormat, `code` is the legality
// letter stored on each card by build-cards.mjs.
// Scryfall does not populate an "explorer" legality, and Alchemy lists lean on
// rebalanced "A-" cards that don't resolve, so we stick to the two formats that
// filter cleanly and yield real, currently-legal decks.
const FORMATS = [
  { key: 'standard', label: 'Standard', id: 1, code: 'S' },
  { key: 'historic', label: 'Historic', id: 16, code: 'H' },
];

const GUILDS = {
  W: 'Mono-White', U: 'Mono-Blue', B: 'Mono-Black', R: 'Mono-Red', G: 'Mono-Green',
  WU: 'Azorius', WB: 'Orzhov', WR: 'Boros', WG: 'Selesnya', UB: 'Dimir', UR: 'Izzet',
  UG: 'Simic', BR: 'Rakdos', BG: 'Golgari', RG: 'Gruul',
  WUB: 'Esper', WUR: 'Jeskai', WUG: 'Bant', WBR: 'Mardu', WBG: 'Abzan', WRG: 'Naya',
  UBR: 'Grixis', UBG: 'Sultai', URG: 'Temur', BRG: 'Jund',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normName(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/’/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
function lookup(name) {
  const k = normName(name);
  if (CARDS[k]) return { key: k, card: CARDS[k] };
  const f = k.split(' // ')[0];
  return CARDS[f] ? { key: f, card: CARDS[f] } : { key: k, card: null };
}

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function colorName(colors) {
  const ordered = ['W', 'U', 'B', 'R', 'G'].filter((c) => colors.has(c)).join('');
  if (!ordered) return { colors: '', label: 'Colorless' };
  if (ordered.length >= 4) return { colors: ordered, label: `${ordered.length}-Color` };
  return { colors: ordered, label: GUILDS[ordered] || ordered };
}

// Pull a batch of candidate deck ids for a format, newest-and-most-viewed first.
async function candidateIds(format) {
  const ids = new Map(); // id -> viewCount
  for (const order of ['-viewCount', '-updatedAt']) {
    for (let page = 1; ids.size < SCAN && page <= 3; page++) {
      const url = `https://archidekt.com/api/decks/v3/?deckFormat=${format.id}&orderBy=${order}&pageSize=50&page=${page}`;
      let data;
      try {
        data = await getJson(url);
      } catch (e) {
        process.stderr.write(`  search failed (${order} p${page}): ${e.message}\n`);
        break;
      }
      for (const d of data.results || []) if (!ids.has(d.id)) ids.set(d.id, d.viewCount || 0);
      await sleep(250);
      if (!data.next) break;
    }
  }
  return [...ids.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, SCAN);
}

// Turn one Archidekt deck into our schema, or return null if it fails a gate.
function normalizeDeck(detail, format, views) {
  // Categories flagged includedInDeck:false (Maybeboard, Considering, …) are excluded.
  const excluded = new Set(
    (detail.categories || []).filter((c) => c.includedInDeck === false).map((c) => c.name)
  );
  const main = new Map();
  const side = new Map();
  const colors = new Set();
  let mainTotal = 0;

  for (const row of detail.cards || []) {
    const cats = row.categories || [];
    if (cats.some((c) => excluded.has(c))) continue;
    const name = row.card?.oracleCard?.name || row.card?.name;
    if (!name) continue;
    const qty = row.quantity || 1;
    const isSide = cats.includes('Sideboard') || cats.includes('Sideboard ');
    const { card } = lookup(name);
    if (isSide) {
      side.set(name, (side.get(name) || 0) + qty);
      continue;
    }
    mainTotal += qty;
    // maindeck gates
    if (!card) return null; // unknown / not on Arena
    const isBasicLand = card.basic;
    if (!isBasicLand && !(card.leg || '').includes(format.code)) return null; // not currently legal
    if (!isBasicLand && card.ci) for (const c of card.ci) colors.add(c);
    main.set(card.n, (main.get(card.n) || 0) + qty);
  }

  if (mainTotal !== 60) return null;
  const nonlandNames = [...main.keys()].filter((n) => {
    const { card } = lookup(n);
    return card && !/Land/.test(card.t);
  });
  if (nonlandNames.length < 10) return null;

  const { colors: colStr, label: guild } = colorName(colors);
  const name = String(detail.name || 'Untitled').trim().slice(0, 80);
  return {
    id: `arch-${detail.id}`,
    name,
    format: format.label,
    archetype: guild,
    colors: colStr,
    description: `Community deck on Archidekt${views ? ` · ${views.toLocaleString()} views` : ''}.`,
    source: { site: 'Archidekt', url: `https://archidekt.com/decks/${detail.id}` },
    legalIn: format.code,
    mainboard: [...main.entries()].map(([n, count]) => ({ name: n, count })),
    sideboard: side.size ? [...side.entries()].map(([n, count]) => ({ name: n, count })) : undefined,
  };
}

async function fetchFormat(format) {
  process.stderr.write(`\n[${format.label}] scanning candidates…\n`);
  const ids = await candidateIds(format);
  process.stderr.write(`[${format.label}] ${ids.length} candidates; fetching details…\n`);
  const decks = [];
  const seenNames = new Set();
  for (const id of ids) {
    if (decks.length >= PER_FORMAT) break;
    let detail;
    try {
      detail = await getJson(`https://archidekt.com/api/decks/${id}/`);
    } catch (e) {
      await sleep(200);
      continue;
    }
    await sleep(250);
    const views = detail.viewCount || 0;
    const deck = normalizeDeck(detail, format, views);
    if (!deck) continue;
    const nkey = deck.name.toLowerCase();
    if (seenNames.has(nkey)) continue;
    seenNames.add(nkey);
    decks.push(deck);
    process.stderr.write(`  ✓ ${deck.name} [${deck.colors || 'C'} ${deck.archetype}]\n`);
  }
  process.stderr.write(`[${format.label}] kept ${decks.length} decks.\n`);
  return decks;
}

async function main() {
  const all = [];
  for (const format of FORMATS) {
    try {
      const decks = await fetchFormat(format);
      all.push(...decks);
    } catch (e) {
      process.stderr.write(`[${format.label}] failed: ${e.message}\n`);
    }
  }
  if (!all.length) {
    process.stderr.write('No decks fetched; leaving existing meta-decks.json untouched.\n');
    process.exit(all.length ? 0 : 1);
  }
  const out = {
    updated: new Date().toISOString(),
    source: 'Archidekt community decks, filtered to currently-legal Arena maindecks.',
    formats: FORMATS.map((f) => f.label),
    decks: all,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 0));
  process.stderr.write(`\nWrote ${OUT}: ${all.length} decks across ${FORMATS.length} formats.\n`);
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + '\n');
  process.exit(1);
});
