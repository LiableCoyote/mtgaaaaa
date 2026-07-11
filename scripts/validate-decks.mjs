#!/usr/bin/env node
// Validate that every card in data/decks.json resolves against data/cards.json.
// Prints unresolved names (which would show as "unknown" and break wildcard
// math) and a rarity breakdown per deck.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const cards = JSON.parse(fs.readFileSync(path.join(dataDir, 'cards.json'), 'utf8')).cards;
const decks = JSON.parse(fs.readFileSync(path.join(dataDir, 'decks.json'), 'utf8')).decks;

function normName(name) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/’/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

let missing = 0;
for (const deck of decks) {
  const rar = { c: 0, u: 0, r: 0, m: 0, land: 0, unknown: 0 };
  let total = 0;
  for (const { name, count } of deck.mainboard) {
    total += count;
    const key = normName(name);
    const c = cards[key] || cards[key.split(' // ')[0]];
    if (!c) {
      rar.unknown += count;
      missing++;
      process.stdout.write(`  ✗ [${deck.id}] unresolved: "${name}"\n`);
      continue;
    }
    if (c.basic) rar.land += count;
    else rar[c.r] = (rar[c.r] || 0) + count;
  }
  process.stdout.write(
    `${total === 60 ? '✓' : '!'} ${deck.name.padEnd(26)} total=${total} ` +
      `C${rar.c} U${rar.u} R${rar.r} M${rar.m} land${rar.land}` +
      (rar.unknown ? ` UNKNOWN=${rar.unknown}` : '') + '\n'
  );
}
process.stdout.write(missing ? `\n${missing} unresolved card name(s).\n` : '\nAll cards resolved.\n');
process.exit(missing ? 1 : 0);
