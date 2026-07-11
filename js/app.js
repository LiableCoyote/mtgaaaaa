// MTGAAAAA — Arena collection deck suggester. Pure client-side, no build step.

const RARITY_ORDER = ['c', 'u', 'r', 'm'];
const RARITY_NAME = { c: 'Common', u: 'Uncommon', r: 'Rare', m: 'Mythic', land: 'Basic land' };
const RARITY_COLOR = {
  c: 'var(--c-common)',
  u: 'var(--c-uncommon)',
  r: 'var(--c-rare)',
  m: 'var(--c-mythic)',
};
const STORE_KEY = 'mtgaaaaa.v1';

const DECK_SITES = [
  { name: 'Moxfield', url: 'https://www.moxfield.com/decks/public', desc: 'Deck builder + huge community database. Exports to Arena.' },
  { name: 'Aetherhub', url: 'https://aetherhub.com/Decks/', desc: 'Meta decks by format with Arena import codes.' },
  { name: 'MTGGoldfish', url: 'https://www.mtggoldfish.com/metagame/standard#paper', desc: 'Metagame breakdowns and budget decks.' },
  { name: 'MTGArena Zone', url: 'https://mtgazone.com/decks/', desc: 'Tier lists and guided decks for Arena.' },
  { name: 'Untapped.gg', url: 'https://mtga.untapped.gg/', desc: 'Meta stats + a companion that tracks your collection.' },
  { name: '17Lands', url: 'https://www.17lands.com/', desc: 'Draft/limited data if you build from your card pool.' },
  { name: 'MTGA Tool', url: 'https://mtgatool.com/', desc: 'Desktop tracker — exports the collection JSON this site reads.' },
  { name: 'Scryfall', url: 'https://scryfall.com/advanced', desc: 'Search every card; great for finding upgrades you own.' },
];

// ---- state ----
let CARDS = {}; // nameKey -> { n, r, ci, cmc, t, basic? }
let ARENA = {}; // arena_id -> nameKey
let DECKS = [];
let META = {};
let METADECKS_UPDATED = null;

/** collection: Map<nameKey, count> */
let collection = new Map();
let wildcards = { c: 0, u: 0, r: 0, m: 0 };

// ---- helpers ----
const $ = (sel) => document.querySelector(sel);

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
  const key = normName(name);
  return CARDS[key] ? { key, card: CARDS[key] } : CARDS[key.split(' // ')[0]] ? { key: key.split(' // ')[0], card: CARDS[key.split(' // ')[0]] } : { key, card: null };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setStatus(msg, kind = '') {
  const el = $('#import-status');
  el.textContent = msg;
  el.className = 'status ' + kind;
}

// ---- persistence ----
function save() {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ collection: [...collection], wildcards })
    );
  } catch (_) {}
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.collection)) collection = new Map(data.collection);
    if (data.wildcards) wildcards = { ...wildcards, ...data.wildcards };
  } catch (_) {}
}

// ---- collection parsing ----
// Returns { counts: Map, resolved, unresolved, wildcards? }
function parseCollection(text) {
  const trimmed = text.trim();
  let json = null;
  try {
    json = JSON.parse(trimmed);
  } catch (_) {
    /* not JSON */
  }
  if (json !== null && typeof json === 'object') return parseJson(json);
  return parseTextList(trimmed);
}

function parseJson(json) {
  const counts = new Map();
  let resolved = 0;
  let unresolved = 0;
  let wc = null;

  // unwrap common wrappers
  let root = json;
  if (!Array.isArray(root)) {
    if (root.wildcards && typeof root.wildcards === 'object') wc = readWildcards(root.wildcards);
    else {
      const maybe = readWildcards(root);
      if (maybe) wc = maybe;
    }
    if (root.cards) root = root.cards;
    else if (root.collection) root = root.collection;
  }

  const add = (nameOrId, count) => {
    const n = Number(count);
    if (!Number.isFinite(n) || n <= 0) return;
    // numeric identifier -> Arena grpId
    if (typeof nameOrId === 'number' || /^\d+$/.test(String(nameOrId))) {
      const key = ARENA[String(nameOrId)];
      if (key) {
        counts.set(key, (counts.get(key) || 0) + n);
        resolved++;
      } else unresolved++;
      return;
    }
    const { key, card } = lookup(nameOrId);
    if (card) {
      counts.set(key, (counts.get(key) || 0) + n);
      resolved++;
    } else unresolved++;
  };

  if (Array.isArray(root)) {
    for (const item of root) {
      if (item == null) continue;
      if (typeof item === 'object') {
        const id = item.grpId ?? item.arena_id ?? item.arenaId ?? item.id ?? null;
        const name = item.name ?? item.cardName ?? item.card ?? item.title ?? null;
        const cnt = item.count ?? item.quantity ?? item.qty ?? item.amount ?? item.owned ?? 1;
        if (id != null && (name == null || /^\d+$/.test(String(id)))) add(id, cnt);
        else if (name != null) add(name, cnt);
      }
    }
  } else if (root && typeof root === 'object') {
    for (const [k, v] of Object.entries(root)) {
      if (v && typeof v === 'object') {
        const cnt = v.count ?? v.quantity ?? v.qty ?? v.owned ?? 1;
        add(k, cnt);
      } else {
        add(k, v);
      }
    }
  }
  return { counts, resolved, unresolved, wildcards: wc };
}

function readWildcards(obj) {
  const pick = (...keys) => {
    for (const k of keys) if (obj[k] != null && Number.isFinite(Number(obj[k]))) return Number(obj[k]);
    return null;
  };
  const c = pick('common', 'wcCommon', 'c', 'commonWildcards');
  const u = pick('uncommon', 'wcUncommon', 'u', 'uncommonWildcards');
  const r = pick('rare', 'wcRare', 'r', 'rareWildcards');
  const m = pick('mythic', 'wcMythic', 'm', 'mythicWildcards');
  if (c == null && u == null && r == null && m == null) return null;
  return { c: c || 0, u: u || 0, r: r || 0, m: m || 0 };
}

function parseTextList(text) {
  const counts = new Map();
  let resolved = 0;
  let unresolved = 0;
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    if (/^(deck|sideboard|commander|companion|maybeboard|about)\b/i.test(line)) continue;
    let count = 1;
    const m = line.match(/^(\d+)\s*x?\s+(.*)$/i);
    let rest = line;
    if (m) {
      count = parseInt(m[1], 10);
      rest = m[2];
    }
    // strip trailing "(SET) 123" or "<set> 123" collector info
    rest = rest
      .replace(/\s*\([^)]*\)\s*[\dA-Za-z-]*\s*$/, '')
      .replace(/\s+\*?[FE]?\*?\s*$/, '')
      .trim();
    if (!rest) continue;
    const { key, card } = lookup(rest);
    if (card) {
      counts.set(key, (counts.get(key) || 0) + count);
      resolved++;
    } else unresolved++;
  }
  return { counts, resolved, unresolved, wildcards: null };
}

// ---- apply an import ----
function applyImport(result, { merge = false } = {}) {
  if (result.resolved === 0 && result.unresolved === 0) {
    setStatus('Nothing recognizable found in that input.', 'err');
    return;
  }
  if (!merge) collection = new Map();
  for (const [k, v] of result.counts) collection.set(k, (collection.get(k) || 0) + v);
  if (result.wildcards) {
    wildcards = { ...result.wildcards };
    syncWildcardInputs();
  }
  save();
  render();
  const parts = [`Loaded ${result.resolved} card entries`];
  if (result.unresolved) parts.push(`${result.unresolved} not recognized`);
  if (result.wildcards) parts.push('wildcards detected');
  setStatus(parts.join(' · '), result.unresolved ? '' : 'ok');
}

// ---- deck evaluation ----
function evalDeck(deck) {
  const need = { c: 0, u: 0, r: 0, m: 0 };
  const miss = { c: 0, u: 0, r: 0, m: 0 };
  let totalCards = 0;
  let ownedCards = 0;
  const rows = [];
  for (const { name, count } of deck.mainboard) {
    const { key, card } = lookup(name);
    totalCards += count;
    const basic = card && card.basic;
    if (basic) {
      ownedCards += count;
      rows.push({ name, need: count, owned: count, missing: 0, r: 'land' });
      continue;
    }
    const r = card ? card.r : 'r';
    const owned = Math.min(count, collection.get(key) || 0);
    ownedCards += owned;
    need[r] += count;
    const missing = count - owned;
    if (missing > 0) miss[r] += missing;
    rows.push({ name, need: count, owned, missing, r, unknown: !card });
  }
  let totalMissing = 0;
  const short = { c: 0, u: 0, r: 0, m: 0 };
  let canCraft = true;
  for (const r of RARITY_ORDER) {
    totalMissing += miss[r];
    short[r] = Math.max(0, miss[r] - wildcards[r]);
    if (miss[r] > wildcards[r]) canCraft = false;
  }
  return {
    deck,
    need,
    miss,
    short,
    rows,
    totalCards,
    ownedCards,
    completion: totalCards ? ownedCards / totalCards : 0,
    totalMissing,
    canCraft,
    complete: totalMissing === 0,
  };
}

// ---- rendering ----
function pips(colors) {
  return (
    '<span class="pips">' +
    [...(colors || '')].map((c) => `<span class="pip ${c}" title="${c}"></span>`).join('') +
    '</span>'
  );
}

function wcChip(r, missing) {
  const enough = missing <= wildcards[r];
  const cls = ['wc-chip', r, missing === 0 ? 'zero' : enough ? '' : 'short'].join(' ').trim();
  return `<span class="${cls}" title="${RARITY_NAME[r]} wildcards needed">${r.toUpperCase()} ${missing}</span>`;
}

function renderDecks() {
  const evals = DECKS.map(evalDeck);
  const sort = $('#sort-select').value;
  const onlyCraft = $('#only-craftable').checked;
  const fmt = $('#format-select').value;
  let list = evals.slice();
  if (fmt) list = list.filter((e) => e.deck.format === fmt);
  if (onlyCraft) list = list.filter((e) => e.canCraft);
  list.sort((a, b) => {
    if (sort === 'name') return a.deck.name.localeCompare(b.deck.name);
    if (sort === 'wildcards') return a.totalMissing - b.totalMissing || b.completion - a.completion;
    // completion
    return b.completion - a.completion || a.totalMissing - b.totalMissing;
  });

  const host = $('#deck-list');
  if (!list.length) {
    host.innerHTML = `<p class="muted">No decks match. Uncheck the filter or load more wildcards.</p>`;
    return;
  }
  host.innerHTML = list.map(deckCardHtml).join('');
  host.querySelectorAll('.deck-top').forEach((el) => {
    el.addEventListener('click', () => el.closest('.deck-card').classList.toggle('open'));
  });
}

function deckCardHtml(e) {
  const d = e.deck;
  const pct = Math.round(e.completion * 100);
  let badge = '';
  if (e.complete) badge = `<span class="badge owned">Complete ✓</span>`;
  else if (e.canCraft) badge = `<span class="badge craftable">Craftable now</span>`;

  const chips = RARITY_ORDER.map((r) => wcChip(r, e.miss[r])).join('');
  const finishLabel = e.totalMissing === 0 ? 'Ready to play' : `${e.totalMissing} cards / wildcards to finish`;
  const srcTag =
    d.kind === 'meta'
      ? `<span class="src-tag src-meta">Meta</span>`
      : `<span class="src-tag src-sample">Sample</span>`;

  return `
  <div class="deck-card">
    <div class="deck-top">
      <div class="deck-id">
        <div class="deck-name">${srcTag} ${escapeHtml(d.name)} ${pips(d.colors)} ${badge}</div>
        <div class="deck-meta">${d.format} · ${d.archetype} · ${d.source.site}</div>
      </div>
      <div class="wc-cost">${chips}</div>
      <div class="deck-prog">
        <div class="bar"><span style="width:${pct}%"></span></div>
        <div class="prog-label"><span>${e.ownedCards}/${e.totalCards} cards</span><span>${finishLabel}</span></div>
      </div>
    </div>
    <div class="deck-detail">
      <p class="deck-desc">${escapeHtml(d.description)}</p>
      ${cardTableHtml(e)}
      ${sideboardHtml(d)}
      <div class="detail-links">
        <a href="${escapeHtml(d.source.url)}" target="_blank" rel="noopener">${
          d.kind === 'meta' ? 'Open this deck' : `More ${d.format} decks`
        } on ${d.source.site} ↗</a>
      </div>
    </div>
  </div>`;
}

function sideboardHtml(d) {
  if (!d.sideboard || !d.sideboard.length) return '';
  const items = d.sideboard
    .map((c) => `<span class="sb-item">${c.count}× ${escapeHtml(c.name)}</span>`)
    .join('');
  return `<div class="sideboard"><span class="sb-label">Sideboard</span>${items}</div>`;
}

function cardTableHtml(e) {
  const rows = e.rows
    .map((row) => {
      const have = row.missing === 0;
      const haveCell = row.r === 'land'
        ? '<span class="have-ok">✓ basic</span>'
        : have
          ? '<span class="have-ok">✓ have</span>'
          : `<span class="have-no">need ${row.missing}</span>`;
      const rr = row.r === 'land' ? 'land' : row.r;
      const nameCell = row.unknown
        ? `${escapeHtml(row.name)} <span class="muted">(unknown)</span>`
        : escapeHtml(row.name);
      return `<tr class="${have ? '' : 'missing'}">
        <td class="cnt">${row.need}</td>
        <td><span class="dot ${rr}"></span>${nameCell}</td>
        <td class="cnt">${row.owned}</td>
        <td>${haveCell}</td>
      </tr>`;
    })
    .join('');
  return `<table class="card-table">
    <thead><tr><th class="cnt">#</th><th>Card</th><th class="cnt">Own</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function renderCollectionSummary() {
  const host = $('#collection-summary');
  if (collection.size === 0) {
    host.classList.add('hidden');
    return;
  }
  host.classList.remove('hidden');

  let unique = 0;
  let copies = 0;
  const byR = { c: 0, u: 0, r: 0, m: 0 };
  const byColor = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const [key, count] of collection) {
    const card = CARDS[key];
    if (!card || card.basic) continue;
    unique++;
    copies += count;
    if (byR[card.r] != null) byR[card.r] += count;
    const ci = card.ci || 'C';
    for (const c of ci) if (byColor[c] != null) byColor[c] += count;
    if (!card.ci) byColor.C += count;
  }
  const totalR = byR.c + byR.u + byR.r + byR.m || 1;
  const seg = (r) =>
    byR[r] ? `<span style="width:${(byR[r] / totalR) * 100}%;background:${RARITY_COLOR[r]}"></span>` : '';

  host.innerHTML = `
    <div class="stat-row">
      <div class="stat"><div class="num">${unique.toLocaleString()}</div><div class="lbl">Unique cards</div></div>
      <div class="stat"><div class="num">${copies.toLocaleString()}</div><div class="lbl">Total copies</div></div>
      <div class="stat"><div class="num">${byR.r.toLocaleString()}</div><div class="lbl">Rare copies</div></div>
      <div class="stat"><div class="num">${byR.m.toLocaleString()}</div><div class="lbl">Mythic copies</div></div>
      <div class="stat"><div class="num">${(wildcards.c + wildcards.u + wildcards.r + wildcards.m).toLocaleString()}</div><div class="lbl">Wildcards</div></div>
    </div>
    <div>
      <div class="rarity-bar">${RARITY_ORDER.map(seg).join('')}</div>
      <div class="legend" style="margin-top:8px">
        ${RARITY_ORDER.map((r) => `<span><i style="background:${RARITY_COLOR[r]}"></i>${RARITY_NAME[r]} ${byR[r]}</span>`).join('')}
      </div>
    </div>`;
}

function render() {
  renderCollectionSummary();
  renderDecks();
}

// ---- wildcard inputs ----
function syncWildcardInputs() {
  $('#wc-c').value = wildcards.c;
  $('#wc-u').value = wildcards.u;
  $('#wc-r').value = wildcards.r;
  $('#wc-m').value = wildcards.m;
}
function wireWildcards() {
  for (const r of RARITY_ORDER) {
    $(`#wc-${r}`).addEventListener('input', (ev) => {
      wildcards[r] = Math.max(0, parseInt(ev.target.value, 10) || 0);
      save();
      render();
    });
  }
}

// ---- sample collection ----
function buildSampleCollection() {
  // Own a believable partial pool: most commons/uncommons, some rares, few mythics.
  const rate = { c: 1, u: 0.85, r: 0.45, m: 0.2 };
  const counts = new Map();
  const seen = new Set();
  for (const deck of DECKS) {
    for (const { name, count } of deck.mainboard) {
      const { key, card } = lookup(name);
      if (!card || card.basic || seen.has(key)) continue;
      seen.add(key);
      if (Math.random() < rate[card.r]) {
        // own between 1 and the playset
        const own = 1 + Math.floor(Math.random() * count);
        counts.set(key, Math.min(4, own));
      }
    }
  }
  return { counts, resolved: counts.size, unresolved: 0, wildcards: { c: 40, u: 30, r: 9, m: 3 } };
}

// ---- site links ----
function renderSiteLinks() {
  $('#site-links').innerHTML = DECK_SITES.map(
    (s) => `<a class="site-link" href="${s.url}" target="_blank" rel="noopener">
      <div class="sl-name">${s.name} ↗</div><div class="sl-desc">${s.desc}</div></a>`
  ).join('');
}

// ---- wiring ----
function wireImport() {
  const dz = $('#dropzone');
  const fi = $('#file-input');
  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fi.click();
    }
  });
  fi.addEventListener('change', () => {
    if (fi.files[0]) readFile(fi.files[0]);
    fi.value = '';
  });
  ['dragenter', 'dragover'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add('drag');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove('drag');
    })
  );
  dz.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f) readFile(f);
  });

  $('#paste-load').addEventListener('click', () => {
    const text = $('#paste-area').value;
    if (!text.trim()) {
      setStatus('Paste a card list or JSON first.', 'err');
      return;
    }
    applyImport(parseCollection(text));
  });

  $('#sample-btn').addEventListener('click', () => {
    applyImport(buildSampleCollection());
    setStatus('Loaded a sample collection — edit wildcards or import your own to replace it.', 'ok');
  });

  $('#clear-btn').addEventListener('click', () => {
    collection = new Map();
    wildcards = { c: 0, u: 0, r: 0, m: 0 };
    syncWildcardInputs();
    save();
    render();
    setStatus('Collection cleared.');
  });
}

function readFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      applyImport(parseCollection(String(reader.result)));
    } catch (err) {
      setStatus('Could not read that file: ' + err.message, 'err');
    }
  };
  reader.onerror = () => setStatus('Could not read that file.', 'err');
  reader.readAsText(file);
}

function populateFormatFilter() {
  const formats = [...new Set(DECKS.map((d) => d.format))].sort();
  const sel = $('#format-select');
  for (const f of formats) {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f;
    sel.appendChild(opt);
  }
}

function wireControls() {
  $('#format-select').addEventListener('change', renderDecks);
  $('#sort-select').addEventListener('change', renderDecks);
  $('#only-craftable').addEventListener('change', renderDecks);
  $('#how-toggle').addEventListener('click', () => {
    const how = $('#how');
    const open = how.classList.toggle('hidden');
    $('#how-toggle').setAttribute('aria-expanded', String(!open));
  });
}

// ---- init ----
async function init() {
  wireControls();
  wireWildcards();
  wireImport();
  renderSiteLinks();
  try {
    const [cardsRes, decksRes] = await Promise.all([
      fetch('data/cards.json'),
      fetch('data/decks.json'),
    ]);
    const cardsData = await cardsRes.json();
    const decksData = await decksRes.json();
    CARDS = cardsData.cards;
    ARENA = cardsData.arena;
    META = cardsData.counts || {};
    const bundled = decksData.decks.map((d) => ({ ...d, kind: 'sample' }));

    // The auto-refreshed meta library is optional; tolerate it being absent.
    let metaDecks = [];
    try {
      const md = await fetch('data/meta-decks.json');
      if (md.ok) {
        const mdData = await md.json();
        METADECKS_UPDATED = mdData.updated || null;
        metaDecks = (mdData.decks || []).map((d) => ({ ...d, kind: 'meta' }));
      }
    } catch (_) {
      /* no meta library yet */
    }

    DECKS = [...metaDecks, ...bundled];
    populateFormatFilter();
    const metaBit = metaDecks.length
      ? ` · ${metaDecks.length} auto-refreshed meta decks (${(METADECKS_UPDATED || '').slice(0, 10)})`
      : '';
    $('#data-meta').textContent =
      `Card dataset: ${META.names?.toLocaleString?.() || '?'} Arena cards · updated ${(cardsData.updated || '').slice(0, 10)} · ${bundled.length} sample decks${metaBit}.`;
  } catch (err) {
    setStatus('Failed to load card data: ' + err.message, 'err');
    $('#deck-list').innerHTML = `<p class="muted">Could not load card data. If you are viewing this locally, serve the folder over HTTP (e.g. <code>python3 -m http.server</code>) so <code>fetch</code> can read the data files.</p>`;
    return;
  }
  load();
  syncWildcardInputs();
  render();
}

init();
