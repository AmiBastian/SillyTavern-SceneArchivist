// Scene Archivist: pure logic (no SillyTavern imports), so it can be tested in Node.

// The log can count its units as Days, Episodes, Chapters and so on. Headings keep whatever word the log uses.
export const UNITS = ['Day', 'Episode', 'Chapter', 'Session', 'Act', 'Part', 'Week', 'Scene'];
let UNIT_ALT = UNITS.join('|');
let RE_HEAD, RE_UNITNUM, RE_SKIPNUM, RE_RETRO, RE_UNITDATE, RE_UNITONLY;
function unitExpressions() {
    RE_HEAD = new RegExp('^## ► (?:(?:' + UNIT_ALT + ')\\s+(?:\\d+|\\?)|Time skip)', 'i');
    RE_UNITNUM = new RegExp('^## ► (?:' + UNIT_ALT + ') (\\d+)', 'i');
    RE_SKIPNUM = new RegExp('^## ► Time skip \\((?:' + UNIT_ALT + ') (\\d+)', 'i');
    RE_RETRO = new RegExp('^## ► (?:' + UNIT_ALT + ')[^—]*—\\s*(.*?)\\s*🔙');
    RE_UNITDATE = new RegExp('^## ► (' + UNIT_ALT + ') (\\d+) — (\\w+), (\\w+) (\\d+)', 'i');
    RE_UNITONLY = new RegExp('^## ► (' + UNIT_ALT + ') (\\d+)', 'i');
}
unitExpressions();

/** Register custom prompt units without guessing that arbitrary headings are events. */
export function registerUnits(units = []) {
    for (const raw of units) {
        const u = String(raw || '').trim();
        if (/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,31}$/u.test(u) && !UNITS.some(x => x.toLowerCase() === u.toLowerCase())) UNITS.push(u);
    }
    UNIT_ALT = [...UNITS].sort((a, b) => b.length - a.length).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    unitExpressions();
    memoryExpressions();
}

/** Swap "Day"/"Days" in a prompt or legend for another unit word. */
export function unitize(text, unit = 'Day') {
    const u = UNITS.includes(unit) ? unit : (String(unit || 'Day').trim() || 'Day');
    if (u === 'Day') return String(text ?? '');
    return String(text ?? '').replace(/\bDays\b/g, u + 's').replace(/\bDay\b/g, u);
}

export function changeUnit(text, from, to) {
    const escaped = String(from || 'Day').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return String(text).replace(new RegExp('\\b' + escaped + 's\\b', 'g'), to + 's').replace(new RegExp('\\b' + escaped + '\\b', 'g'), to);
}

export const STATE_NAMES = ['Open Threads', 'Relationship State', 'Faction State', 'Character State', 'World State'];
export const OPENING_TAG = '<Scene_Log>';
export const CLOSING_TAG = '</Scene_Log>';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// ---------------------------------------------------------------- parsing

/** Strip chatter and code fences, return the log text between the Scene Log markers. */
export function extractLogText(raw) {
    let t = String(raw ?? '').replace(/\r\n?/g, '\n');
    t = t.replace(/<think(ing)?>[\s\S]*?<\/think(ing)?>/gi, '');
    const fence = t.match(/```(?:markdown|md|text)?\n([\s\S]*?)```/);
    if (fence && /## ► /.test(fence[1])) t = fence[1];
    const start = t.indexOf('=== Scene Log ===');
    if (start >= 0) t = t.slice(start + '=== Scene Log ==='.length);
    const end = t.indexOf('=== End Scene Log ===');
    const hasEnd = end >= 0;
    if (hasEnd) t = t.slice(0, end);
    const firstHeading = t.search(/^#{1,2} ► /m);
    if (firstHeading > 0) t = t.slice(firstHeading);
    return { text: t.trim(), hasEnd };
}

function cleanBlock(lines) {
    let out = lines.join('\n');
    out = out.replace(/\n-{3,}\s*$/g, '').replace(/^\s*-{3,}\s*\n/g, '');
    return out.replace(/\s+$/g, '').replace(/^\n+/, '');
}

/**
 * Parse archivist output into epoch, legend, day-type entries and state sections.
 * @returns {{epoch:string|null, legend:string|null, entries:Array, states:Object, warnings:string[], hasEnd:boolean}}
 */
export function parseArchivistOutput(raw) {
    const { text, hasEnd } = extractLogText(raw);
    const lines = text.split('\n');
    const blocks = [];
    let cur = null;
    for (const line of lines) {
        if (/^#{1,2} ► /.test(line)) {
            cur = { heading: line.trim(), lines: [line.trimEnd()] };
            blocks.push(cur);
        } else if (cur) {
            cur.lines.push(line);
        }
    }
    const res = { epoch: null, legend: null, entries: [], states: {}, warnings: [], hasEnd };
    for (const b of blocks) {
        const content = cleanBlock(b.lines);
        const h = b.heading;
        if (/^# ► STORY EPOCH/i.test(h)) { res.epoch = h; continue; }
        if (/^## ► Legend/i.test(h)) { res.legend = content; continue; }
        const st = STATE_NAMES.find(n => new RegExp('^## ► ' + n.replace(/ /g, '\\s+') + '\\s*$', 'i').test(h));
        if (st) { res.states[st] = content; continue; }
        if (RE_HEAD.test(h)) {
            const retro = h.includes('🔙');
            const kind = retro ? 'retro' : /^## ► Time skip/i.test(h) ? 'skip' : 'day';
            const dayNum = (h.match(RE_UNITNUM) || h.match(RE_SKIPNUM) || [])[1];
            res.entries.push({ kind, heading: h, content, dayNum: dayNum ? Number(dayNum) : null });
            continue;
        }
        res.warnings.push('Ignored an unrecognised section: ' + h.slice(0, 60));
    }
    if (!res.entries.length && !Object.keys(res.states).length) res.warnings.push('No Day entries or state sections were found in the output.');
    const missing = STATE_NAMES.filter(n => !(n in res.states));
    if (res.entries.length && missing.length === STATE_NAMES.length) res.warnings.push('The output has no state sections (Open Threads to World State). It may have been cut off.');
    else if (missing.length && Object.keys(res.states).length) res.warnings.push('Missing state sections (existing ones stay as they are): ' + missing.join(', '));
    return res;
}

// ---------------------------------------------------------------- entry classification

/** What kind of managed entry is this lorebook entry? */
export function classifyEntry(entry) {
    const r = entry?.sceneArchivist;
    if (r && r.type !== 'unit' && !['state', 'memory', 'tracker', 'opening', 'closing', 'epoch', 'legend'].includes(r.type)) return { type: r.type, name: r.subject || '', heading: String(entry.content ?? '').trim().split('\n')[0] };
    const c = String(entry?.content ?? '').trim();
    if (c.startsWith(OPENING_TAG)) return { type: 'opening' };
    if (c.startsWith(CLOSING_TAG)) return { type: 'closing' };
    if (/^# ► STORY EPOCH/i.test(c)) return { type: 'epoch' };
    if (/^## ► Legend/i.test(c)) return { type: 'legend' };
    const first = c.split('\n')[0];
    const st = STATE_NAMES.find(n => first.startsWith('## ► ' + n));
    if (st) return { type: 'state', name: st };
    const mem = first.match(/^## ► Memories — (.+)$/);
    if (mem) return { type: 'memory', name: mem[1].trim() };
    const trk = first.match(/^## ► Tracker — (.+)$/);
    if (trk) return { type: 'tracker', name: trk[1].trim() };
    if (RE_HEAD.test(first)) {
        const retro = first.includes('🔙');
        const kind = retro ? 'retro' : /^## ► Time skip/i.test(first) ? 'skip' : 'day';
        const m = first.match(RE_UNITNUM) || first.match(RE_SKIPNUM);
        return { type: kind, heading: first, dayNum: m ? Number(m[1]) : null };
    }
    if (r?.type === 'unit') return { type: 'day', heading: first, dayNum: r.unit?.number ?? null };
    return null;
}

export function bulletCount(text) {
    return String(text ?? '').split('\n').filter(l => /^\s*[-*] /.test(l)).length;
}

/** Sort key for retroactive headings so new ones can be inserted at their true date. Unknown dates return null. */
export function retroSortKey(heading) {
    const h = heading.replace(new RegExp('^## ► (?:' + UNIT_ALT + ')[^—]*—\\s*', 'i'), '').replace(/🔙.*$/, '').trim();
    if (/unknown/i.test(h)) return null;
    const y = h.match(/\b(1[0-9]{3}|20[0-9]{2})(s?)\b/);
    if (!y) return null;
    let key = Number(y[1]);
    if (y[2] === 's') key += 0.05;
    if (/\bearly\b/i.test(h)) key += 0.02;
    if (/\blate\b/i.test(h)) key += 0.08;
    if (/\bafter\b/i.test(h)) key += 0.5;
    const lower = h.toLowerCase();
    const mi = MONTHS.findIndex(m => lower.includes(m));
    if (mi >= 0 && !/\bafter\b/i.test(h)) key += (mi + 1) / 100;
    const d = lower.match(/\b(\d{1,2})\b(?!\d)/);
    if (d && mi >= 0) key += Number(d[1]) / 10000;
    return key;
}

// ---------------------------------------------------------------- keywords

const STOP = new Set(('The A An And Of In On At To For With By From As Is Was He She His Her They Their It Its This That These Those Day Main Secondary ' +
    'Unknown Time Location Bullet Form Never Also After Before When While Then Now Not No Yes All Both Each Every Some Any But Or If So ' +
    'Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December ' +
    'Mon Tue Wed Thu Fri Sat Sun Jan Feb Mar Apr Jun Jul Aug Sep Sept Oct Nov Dec AM PM EDT CET CEST EST UTC').split(/\s+/));

export function foldAscii(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const CAP = /^[A-ZÀ-ÖØ-Þ]/;
const WORD = /[A-Za-zÀ-ÖØ-öø-ÿ0-9][\wÀ-ÿ'’\-_]*/g;

function bodyLines(text) {
    return text.split('\n').filter(l => !/^(##|#|📍)/.test(l.trim()));
}

/** Candidate terms: runs of capitalised words, codes like PELL_17JULY or 77-B, and quoted capitalised phrases. */
function termsOf(text) {
    const c = new Map();
    const add = (t, n = 1) => {
        t = t.trim().replace(/^(The|A|An)\s+/, '').replace(/['’]s$/, '');
        if (t.length < 3 || t.length > 40 || !/[A-Za-zÀ-ÿ]/.test(t) || STOP.has(t)) return;
        c.set(t, (c.get(t) ?? 0) + n);
    };
    const body = bodyLines(text).join('\n').replace(/[*_`]/g, m => (m === '_' ? '_' : ' '));
    for (const seg of body.split(/[.,;:!?()"“”\n—–\[\]]+/)) {
        let run = [];
        const flush = () => { if (run.length) add(run.join(' ')); run = []; };
        for (const w of seg.match(WORD) ?? []) {
            if (CAP.test(w) && !STOP.has(w) && !/^\d/.test(w)) run.push(w); else flush();
            if (/^[A-Z0-9][A-Z0-9_\-]{2,}$/.test(w) && /[A-Z]{2}/.test(w) && /[A-Z]/.test(w) && !STOP.has(w) && !/^\d+$/.test(w)) add(w);
        }
        flush();
    }
    for (const m of body.matchAll(/"([^"\n]{4,36})"/g)) { const q = m[1].replace(/[.,!?]+$/, ''); if (/[A-ZÀ-Þ]/.test(q) && q.split(/\s+/).length >= 2) add(q); }
    return c;
}

/**
 * Heuristic trigger keywords: distinctive names, places and phrases that are rare across the other entries.
 */
export function suggestKeys(text, corpusTexts, { avoid = [], max = 9 } = {}) {
    const mine = termsOf(text);
    const lowerWords = new Set();
    for (const t of [text, ...corpusTexts]) for (const w of t.matchAll(/(?<![A-Za-zÀ-ÿ])[a-zà-ÿ][a-zà-ÿ'’\-]{2,}/g)) lowerWords.add(w[0]);
    const df = new Map();
    for (const t of corpusTexts) for (const k of new Set(termsOf(t).keys())) df.set(k, (df.get(k) ?? 0) + 1);
    const N = Math.max(corpusTexts.length, 1);
    const avoidSet = new Set(avoid.map(a => a.toLowerCase()));
    const scored = [];
    for (const [term, n] of mine) {
        if (avoidSet.has(term.toLowerCase()) || term.split(/\s+/).every(w => avoidSet.has(w.toLowerCase()))) continue;
        if (!term.includes(' ') && lowerWords.has(term.toLowerCase())) continue;
        const d = df.get(term) ?? 0;
        if (N >= 6 && d / N > 0.25) continue;
        const words = term.split(/\s+/).length;
        const score = (Math.min(n, 4) + (words > 1 ? 1 : 0) + (/\d|_/.test(term) ? 1 : 0)) * Math.log((N + 1) / (d + 1) + 1);
        scored.push([term, score]);
    }
    scored.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const picked = [];
    for (const [t] of scored) {
        picked.push(t);
        if (picked.length >= max) break;
    }
    return withVariants(picked);
}

/** Add ASCII-folded spelling variants (Théo -> Theo) and drop duplicates. */
export function withVariants(keys) {
    const out = [];
    const seen = new Set();
    const push = (k) => { const l = k.toLowerCase(); if (k && !seen.has(l)) { seen.add(l); out.push(k); } };
    for (const k of keys) { push(k.trim()); }
    for (const k of keys) { const f = foldAscii(k.trim()); if (f !== k.trim()) push(f); }
    return out;
}

export function buildKeywordPrompt(items, avoid) {
    const list = items.map((it, i) => `### ENTRY ${i}\n${it.content}`).join('\n\n');
    return {
        system: 'You write trigger keywords for roleplay lorebook entries. Reply with JSON only.',
        prompt:
`Below are lorebook entries from a roleplay's running Scene Log. For each entry, choose 5 to 10 keywords. An entry loads into the model's context only when one of its keywords appears in the recent chat, so the keywords must be what a roleplay message would actually contain when this entry becomes relevant.

Rules:
- Prefer specific proper nouns, places, objects, codenames and distinctive phrases from the entry.
- Include spelling variants (with and without accents) and the short form characters would use.
- Never use these main-cast names or other terms that appear in almost every scene: ${avoid.join(', ') || '(none)'}.
- Never use generic words (day, night, fight, home, money, plane, phone, meeting).
- Each keyword is at most 3 words.

Return only JSON shaped like {"0": ["keyword", "keyword"], "1": [...]}, one array per entry number.

${list}`,
    };
}

export function parseKeywordResponse(text, n) {
    const m = String(text ?? '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
        const obj = JSON.parse(m[0]);
        const out = [];
        for (let i = 0; i < n; i++) {
            const arr = obj[String(i)] ?? obj[i];
            out.push(Array.isArray(arr) ? arr.map(x => String(x).trim()).filter(x => x.length >= 2 && x.length <= 48) : null);
        }
        return out;
    } catch { return null; }
}

export function cleanKeys(keys, avoid = []) {
    const avoidSet = new Set(avoid.map(a => a.toLowerCase()));
    return withVariants((keys ?? []).filter(k => k && !avoidSet.has(k.toLowerCase())));
}

// ---------------------------------------------------------------- lorebook planning and applying

function comment(kind, heading, constant) {
    if (kind === 'retro') {
        const m = heading.match(RE_RETRO);
        return '🔙| ' + (m ? m[1] : heading.slice(0, 40));
    }
    const icon = constant ? '📌' : '📜';
    let m = heading.match(RE_UNITDATE);
    if (m) return `${icon}| ${m[1]} ${m[2]} · ${m[3].slice(0, 3)} ${m[4].slice(0, 3)} ${m[5]}`;
    m = heading.match(RE_UNITONLY);
    if (m) return `${icon}| ${m[1]} ${m[2]}`;
    m = heading.match(/^## ► Time skip.*?—\s*(.*)$/);
    return `${icon}| Time skip` + (m ? ' · ' + m[1].slice(0, 40) : '');
}

// ---------------------------------------------------------------- delivery (where the log is injected)

const POS = { outlet: 7, before: 0, after: 1, depth: 4 };

export function deliveryMode(opts) { return POS[opts?.delivery] !== undefined ? opts.delivery : 'outlet'; }

/** SillyTavern lists OUTLET entries from the highest order to the lowest, but every other position from the lowest to the highest. */
function dirOf(data) {
    const first = Object.values(data.entries ?? {}).find(e => classifyEntry(e));
    return first && first.position !== POS.outlet ? 1 : -1;
}

export function matchesDelivery(e, opts) {
    const mode = deliveryMode(opts);
    if (e.position !== POS[mode]) return false;
    if (mode === 'outlet') return e.outletName === opts.outlet;
    if (mode === 'depth') return Number(e.depth) === Number(opts.depth ?? 4) && Number(e.role ?? 0) === Number(opts.role ?? 0);
    return true;
}

function setDelivery(e, opts) {
    const mode = deliveryMode(opts);
    e.position = POS[mode];
    e.outletName = mode === 'outlet' ? opts.outlet : '';
    e.depth = mode === 'depth' ? Number(opts.depth ?? 4) : 4;
    e.role = mode === 'depth' ? Number(opts.role ?? 0) : 0;
}

/** Move every log entry to the chosen delivery mode and renumber `order` so the reading order is unchanged. Returns how many entries were touched. */
export function convertDelivery(data, opts) {
    const list = managed(data);
    if (!list.length || list.every(x => matchesDelivery(x.e, opts))) return 0;
    const lo = Math.max(0, Math.min(...list.map(x => Number(x.e.order) || 0)));
    const desc = deliveryMode(opts) === 'outlet';
    list.forEach((x, i) => { setDelivery(x.e, opts); x.e.order = desc ? lo + (list.length - 1 - i) : lo + i; });
    return list.length;
}

function managed(data) {
    const list = [];
    for (const e of Object.values(data.entries ?? {})) {
        const cl = classifyEntry(e);
        if (cl) list.push({ e, cl });
    }
    const dir = dirOf(data); // reading order: ascending `order`, except outlets which are listed in descending order
    list.sort((a, b) => dir * (a.e.order - b.e.order) || a.e.uid - b.e.uid);
    return list;
}

/** Build the list of changes for the review step. Nothing is modified. */
export function planChanges(data, parsed, opts) {
    const m = managed(data);
    const hasLog = m.some(x => x.cl.type === 'state' || x.cl.type === 'day' || x.cl.type === 'retro');
    const plan = { seed: !hasLog, adds: [], states: [], demotions: [], warnings: [...parsed.warnings] };
    const existingHeads = new Set(m.map(x => (x.cl.heading ?? '').trim()));
    for (const en of parsed.entries) {
        if (existingHeads.has(en.heading.trim())) { plan.warnings.push('Skipped "' + en.heading.slice(0, 60) + '" because an entry with that exact heading already exists.'); continue; }
        const constant = en.kind !== 'retro';
        plan.adds.push({ include: true, kind: en.kind, heading: en.heading, content: en.content, dayNum: en.dayNum, constant, label: comment(en.kind, en.heading, constant), keys: [] });
    }
    for (const name of STATE_NAMES) {
        if (!(name in parsed.states)) continue;
        const old = m.find(x => x.cl.type === 'state' && x.cl.name === name);
        if (old?.e.sceneArchivist?.protection?.locked || old?.e.sceneArchivist?.protection?.exact) { plan.warnings.push(name + ' is author locked or preserves exact wording, so it was left unchanged.'); continue; }
        const oldB = old ? bulletCount(old.e.content) : 0;
        const newB = bulletCount(parsed.states[name]);
        const st = { include: true, name, content: parsed.states[name], uid: old ? old.e.uid : null, oldBullets: oldB, newBullets: newB, warn: null };
        if (old && oldB >= 4 && newB < oldB * 0.75) st.warn = `Fewer bullets than before (${oldB} to ${newB}). Check that nothing unresolved was dropped.`;
        plan.states.push(st);
    }
    if (plan.seed && !parsed.epoch && !opts.legend) plan.warnings.push('No story epoch line was found in the output.');
    // which Day entries drop out of the always-on window (time skips follow the Day they sit after)
    const num = (cl, fallback) => (cl.dayNum ?? fallback) + (cl.type === 'skip' || cl.kind === 'skip' ? 0.5 : 0);
    const dayEntries = [
        ...m.filter(x => x.cl.type === 'day' || x.cl.type === 'skip').map(x => ({ uid: x.e.uid, real: x.cl.type === 'day', n: num(x.cl, 0), constant: x.e.constant, label: x.e.comment, hasKeys: !!x.e.key?.length, content: x.e.content })),
        ...plan.adds.filter(a => a.kind === 'day' || a.kind === 'skip').map(a => ({ uid: null, real: a.kind === 'day', n: num({ dayNum: a.dayNum, kind: a.kind }, 0), constant: true, label: a.label, add: a })),
    ];
    const keep = Math.max(0, Number(opts.keepDays ?? 3));
    const real = dayEntries.filter(d => d.real).sort((a, b) => b.n - a.n);
    const cutoff = keep === 0 ? Infinity : (real.length >= keep ? real[keep - 1].n : -Infinity);
    for (const d of dayEntries) {
        if (!d.constant || !(d.n < cutoff)) continue;
        if (d.add) { d.add.constant = false; d.add.label = d.add.label.replace('📌', '📜'); }
        else plan.demotions.push({ include: true, uid: d.uid, label: d.label, needsKeys: !d.hasKeys, content: d.content, keys: [] });
    }
    return plan;
}

function newEntry(data, makeEntry) {
    const e = makeEntry(data);
    return e;
}

function applyDefaults(e, opts, constant) {
    setDelivery(e, opts);
    e.selective = true;
    e.selectiveLogic = 0;
    e.excludeRecursion = true;
    e.preventRecursion = true;
    e.matchWholeWords = true;
    e.vectorized = false;
    e.constant = !!constant;
    e.ignoreBudget = !!constant;
    e.sticky = constant ? 0 : Number(opts.sticky ?? 4);
    e.scanDepth = constant ? null : Number(opts.scanDepth ?? 4);
    e.disable = false;
}

/**
 * Apply an (optionally user-edited) plan to lorebook data. Returns a report.
 * `makeEntry(data)` must create and register a blank entry (ST's createWorldInfoEntry).
 */
export function applyPlan(data, plan, parsed, opts, makeEntry) {
    const report = { added: [], states: [], demoted: [], seeded: false, converted: 0 };
    data.entries ??= {};
    const addEntry = (content, commentText, keys, constant) => {
        const e = newEntry(data, makeEntry);
        applyDefaults(e, opts, constant);
        e.content = '\n' + content.trim() + '\n';
        e.comment = commentText;
        e.key = keys ?? [];
        e.keysecondary = [];
        return e;
    };
    // switch the whole log to the chosen delivery mode first (keeps the reading order)
    report.converted = convertDelivery(data, opts);
    // seed wrappers and epoch when the book has no log yet
    let m = managed(data);
    if (plan.seed && !m.some(x => x.cl.type === 'opening')) {
        addEntry(opts.openingText || (OPENING_TAG + '\n\nRunning record of the roleplay so far.'), '🗃️| Scene Log Opening', [], true);
        const epoch = parsed.epoch || '# ► STORY EPOCH: Day 1 = (set the date)';
        addEntry([epoch, opts.legend ? '\n' + opts.legend.trim() : ''].join('\n').trim(), '📌| Story Epoch and Legend', [], true);
        addEntry(CLOSING_TAG, '🗃️| Scene Log Closing', [], true);
        report.seeded = true;
        m = managed(data);
    }
    // state replacements
    for (const st of plan.states) {
        if (!st.include) continue;
        const target = m.find(x => x.cl.type === 'state' && x.cl.name === st.name);
        if (target) {
            target.e.content = '\n' + st.content.trim() + '\n';
            applyDefaults(target.e, opts, true);
            target.e.comment = target.e.comment || '🧭| ' + st.name;
            report.states.push(st.name);
        } else {
            addEntry(st.content, '🧭| ' + st.name, [], true);
            report.states.push(st.name + ' (new)');
        }
    }
    // new day-type entries
    const created = [];
    for (const a of plan.adds) {
        if (!a.include) continue;
        const e = addEntry(a.content, a.label, a.keys, a.constant);
        created.push({ e, a });
        report.added.push(a.label);
    }
    // demotions
    for (const d of plan.demotions) {
        if (!d.include) continue;
        const e = data.entries[d.uid];
        if (!e) continue;
        e.constant = false;
        e.ignoreBudget = false;
        e.sticky = Number(opts.sticky ?? 4);
        e.scanDepth = Number(opts.scanDepth ?? 4);
        e.comment = String(e.comment || '').replace('📌', '📜');
        if (!e.key?.length) e.key = d.keys ?? [];
        report.demoted.push(e.comment);
    }
    reorder(data, created.map(c => c.e.uid), opts);
    return report;
}

/** Re-number `order` (descending, because ST outlets list high to low) on managed entries so the outlet reads: opening, epoch, flashbacks by date, Days, states, closing. */
export function reorder(data, newUids, opts) {
    const m = managed(data);
    if (!m.length) return;
    const dir = dirOf(data);
    const fresh = new Set(newUids);
    const oldList = m.filter(x => !fresh.has(x.e.uid));
    const newList = m.filter(x => fresh.has(x.e.uid));
    const lo = Math.max(0, Math.min(...(oldList.length ? oldList : m).map(x => Number(x.e.order) || 0)));
    const rank = (t) => ({ opening: 0, epoch: 1, retro: 2, day: 3, skip: 3, memory: 4, tracker: 4.5, state: 5, closing: 6 })[t];
    let seq = oldList.slice().sort((a, b) => rank(a.cl.type) - rank(b.cl.type) || dir * (a.e.order - b.e.order) || (a.e.uid - b.e.uid));
    // states in canonical order
    const stateIdx = seq.map((x, i) => x.cl.type === 'state' ? i : -1).filter(i => i >= 0);
    const states = stateIdx.map(i => seq[i]).sort((a, b) => STATE_NAMES.indexOf(a.cl.name) - STATE_NAMES.indexOf(b.cl.name));
    stateIdx.forEach((i, k) => { seq[i] = states[k]; });
    for (const nw of newList.sort((a, b) => a.e.uid - b.e.uid)) {
        const t = nw.cl.type;
        let at;
        if (t === 'retro') {
            const key = retroSortKey(nw.cl.heading);
            const retros = seq.map((x, i) => ({ x, i })).filter(o => o.x.cl.type === 'retro');
            at = -1;
            if (key !== null) {
                for (const o of retros) { const k2 = retroSortKey(o.x.cl.heading); if (k2 !== null && k2 > key) { at = o.i; break; } }
            }
            if (at < 0) {
                if (retros.length) at = retros[retros.length - 1].i + 1;
                else { const ep = seq.findIndex(x => x.cl.type === 'epoch' || x.cl.type === 'opening'); at = ep >= 0 ? ep + 1 : 0; if (seq[at - 1]?.cl.type === 'opening' && seq[at]?.cl.type === 'epoch') at += 1; }
            }
        } else if (t === 'day' || t === 'skip') {
            const days = seq.map((x, i) => ({ x, i })).filter(o => o.x.cl.type === 'day' || o.x.cl.type === 'skip');
            if (days.length) at = days[days.length - 1].i + 1;
            else { const r = seq.map((x, i) => ({ x, i })).filter(o => o.x.cl.type === 'retro'); at = r.length ? r[r.length - 1].i + 1 : (seq.findIndex(x => x.cl.type === 'state') >= 0 ? seq.findIndex(x => x.cl.type === 'state') : seq.length); }
        } else if (t === 'memory') {
            const firstTracker = seq.findIndex(x => x.cl.type === 'tracker');
            const firstState = seq.findIndex(x => x.cl.type === 'state');
            const closing = seq.findIndex(x => x.cl.type === 'closing');
            at = firstTracker >= 0 ? firstTracker : (firstState >= 0 ? firstState : (closing >= 0 ? closing : seq.length));
        } else if (t === 'tracker') {
            const lastMem = seq.map((x, i) => ({ x, i })).filter(o => o.x.cl.type === 'tracker' || o.x.cl.type === 'memory');
            const firstState = seq.findIndex(x => x.cl.type === 'state');
            const closing = seq.findIndex(x => x.cl.type === 'closing');
            at = lastMem.length ? lastMem[lastMem.length - 1].i + 1 : (firstState >= 0 ? firstState : (closing >= 0 ? closing : seq.length));
        } else if (t === 'state') {
            const closing = seq.findIndex(x => x.cl.type === 'closing');
            at = closing >= 0 ? closing : seq.length;
        } else if (t === 'opening') at = 0;
        else if (t === 'closing') at = seq.length;
        else at = seq.length;
        seq.splice(at, 0, nw);
    }
    // closing wrapper always last, opening first
    const closingI = seq.findIndex(x => x.cl.type === 'closing');
    if (closingI >= 0 && closingI !== seq.length - 1) seq.push(seq.splice(closingI, 1)[0]);
    const openI = seq.findIndex(x => x.cl.type === 'opening');
    if (openI > 0) seq.unshift(seq.splice(openI, 1)[0]);
    seq.forEach((x, i) => { x.e.order = dir < 0 ? lo + (seq.length - 1 - i) : lo + i; x.e.displayIndex = x.e.displayIndex ?? x.e.uid; });
}

/** Text of what the model currently sees as always-on (for the optional "append log to prompt" fallback). */
export function currentLogText(data) {
    const list = managed(data).filter(x => x.e.constant && !x.e.disable && (!x.e.sceneArchivist || x.e.sceneArchivist.status === 'current'));
    const covered = new Set(list.filter(x => x.cl.type === 'recap').flatMap(x => x.e.sceneArchivist.covers || []));
    return list.filter(x => !covered.has(x.e.sceneArchivist?.id) && !['opening', 'closing', 'tracker'].includes(x.cl.type))
        .map(x => x.e.content.trim()).join('\n\n');
}

export function managedSummary(data) {
    const m = managed(data);
    const days = m.filter(x => x.cl.type === 'day').map(x => x.cl.dayNum ?? 0);
    return { total: m.length, constant: m.filter(x => x.e.constant).length, keyed: m.filter(x => !x.e.constant).length, lastDay: days.length ? Math.max(...days) : 0 };
}


// ---------------------------------------------------------------- Recall (model picks keyed entries)

const strip = (s) => String(s ?? '').replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF\uFE0F|]/gu, '').replace(/\s+/g, ' ').trim();

/** Keyed (not always-on) log entries, numbered for the model. Entries that are always on are already in the prompt. */
export function buildRecallIndex(data, { limit = 120, recentText = '' } = {}) {
    let out = [];
    for (const { e, cl } of managed(data)) {
        if (!['day', 'retro', 'skip', 'memory'].includes(cl.type) || e.constant || e.disable) continue;
        const bullet = String(e.content ?? '').split('\n').find(l => /^\s*[-*] /.test(l)) ?? '';
        out.push({
            id: 0, uid: e.uid, pos: out.length,
            title: strip(e.comment) || strip(cl.heading ?? ''),
            keys: (e.key ?? []).slice(0, 8),
            gist: strip(bullet.replace(/^\s*[-*] /, '')).slice(0, 110),
        });
    }
    // Big archives: offer only the most plausible entries so the index stays small. Rank by word overlap with the recent messages, newest first on ties.
    if (out.length > limit) {
        const words = new Set(String(recentText).toLowerCase().match(/[\p{L}\p{N}']{3,}/gu) ?? []);
        const score = (x) => {
            let s = 0;
            for (const w of `${x.title} ${x.keys.join(' ')} ${x.gist}`.toLowerCase().match(/[\p{L}\p{N}']{3,}/gu) ?? []) if (words.has(w)) s += 1;
            for (const k of x.keys) if (words.has(String(k).toLowerCase())) s += 3;
            return s;
        };
        out = out.map(x => ({ x, s: score(x) })).sort((a, b) => b.s - a.s || b.x.pos - a.x.pos).slice(0, limit).map(o => o.x).sort((a, b) => a.pos - b.pos);
    }
    return out.map((x, i) => ({ id: i + 1, uid: x.uid, title: x.title, keys: x.keys, gist: x.gist }));
}

export function buildRecallPrompt(index, recentText, maxPicks) {
    const lines = index.map(x => `${x.id} | ${x.title} | ${x.keys.join(', ')} | ${x.gist}`).join('\n');
    return {
        system: 'You choose which archived story notes a roleplay model needs for its next reply. Answer with JSON only.',
        prompt: `ARCHIVE INDEX (id | title | keywords | gist)\n${lines}\n\nRECENT MESSAGES\n${recentText}\n\nChoose up to ${maxPicks} ids whose notes the next reply is likely to need: people, places, events or secrets that the recent messages touch or hint at, including indirect references where no keyword appears. Skip notes the recent messages already make fully clear. Return only {"load":[ids]}. Use an empty list if none apply.`,
    };
}

/** Returns an array of valid ids (possibly empty), or null when the reply was unusable. */
export function parseRecallResponse(text, index, maxPicks) {
    const m = String(text ?? '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
        const obj = JSON.parse(m[0]);
        if (!Array.isArray(obj.load)) return null;
        const valid = new Set(index.map(x => x.id));
        const out = [];
        for (const v of obj.load) { const n = Number(v); if (valid.has(n) && !out.includes(n)) out.push(n); }
        return out.slice(0, maxPicks);
    } catch { return null; }
}


// ---------------------------------------------------------------- Character memories

/**
 * The next Days to process, OLDEST first: everything after `progress`, or an explicit fromDay..toDay range.
 * At most `maxDays` per call. Also returns each Day's calendar date so memories can be dated.
 */
export function selectMemorySource(data, progress = 0, maxDays = 3, { fromDay = null, toDay = null } = {}) {
    const m = managed(data);
    const lo = fromDay != null && fromDay !== '' ? Number(fromDay) : Number(progress || 0) + 1;
    const hi = toDay != null && toDay !== '' ? Number(toDay) : Infinity;
    const days = m.filter(x => x.cl.type === 'day' && (x.cl.dayNum ?? 0) >= lo && (x.cl.dayNum ?? 0) <= hi)
        .sort((a, b) => a.cl.dayNum - b.cl.dayNum);
    const picked = days.slice(0, Math.max(1, Number(maxDays) || 3));
    const ctx = m.filter(x => x.cl.type === 'state' && ['Relationship State', 'Character State'].includes(x.cl.name));
    const dates = {};
    for (const x of m.filter(y => y.cl.type === 'day' && y.cl.dayNum != null)) {
        const h = String(x.e.content ?? '').match(new RegExp('^##[ \\t]*\\u25ba?[ \\t]*(?:' + UNIT_ALT + ')[ \\t]+\\d+[ \\t]*[\\u2014\\u2013-][ \\t]*(.+?)[ \\t]*$', 'm'));
        if (h) dates[x.cl.dayNum] = h[1].replace(/\s*\S*\u{1F519}.*$/u, '').trim();
    }
    // Days without an entry of their own (the log skips quiet days) get their date from the Story Epoch line: "Day 1 = Tuesday, October 6, 2026".
    const ep = m.find(x => x.cl.type === 'epoch');
    const er = ep && String(ep.e.content).match(/Day\s*1\s*=\s*([^\n]*?\d{4})/);
    const t0 = er ? Date.parse(er[1].replace(/[*_`]/g, '').trim() + ' UTC') : NaN;
    if (!Number.isNaN(t0) && m.filter(x => x.cl.type === 'day').every(x => /^\s*## ► Day\s/i.test(x.e.content))) {
        const top = Math.max(0, ...m.filter(y => y.cl.type === 'day').map(y => y.cl.dayNum ?? 0));
        for (let n = 1; n <= top; n++) if (!dates[n]) dates[n] = new Date(t0 + (n - 1) * 86400000).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    }
    return {
        dates,
        remaining: days.length - picked.length,
        days: picked.map(x => x.cl.dayNum),
        lastDay: picked.length ? Math.max(...picked.map(x => x.cl.dayNum ?? 0)) : 0,
        text: picked.map(x => x.e.content.trim()).join('\n\n'),
        context: ctx.map(x => x.e.content.trim()).join('\n\n'),
    };
}

/** Rewrite a leading "[Day 4]" or "[Days 4-9]" tag so it carries the calendar date. Unknown Days are left alone. */
export function datedTag(raw, dates = {}) {
    raw = String(raw).replace(/^\s*[-*]\s+/, '');
    const m = raw.match(TAG_RE);
    if (!m) return raw;
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : null;
    const rest = raw.slice(m[0].length);
    if (b == null || b === a) return dates[a] ? `[Day ${a}, ${dates[a]}] ${rest}` : `[Day ${a}] ${rest}`;
    return dates[a] && dates[b] ? `[Days ${a}-${b}, ${dates[a]} to ${dates[b]}] ${rest}` : `[Days ${a}-${b}] ${rest}`;
}

// A memory entry is stored grouped by date:
//   ## ► Memories — Name
//
//   [Thursday, October 15, 2026 - Day 10]
//   - memory
//   - memory
let TAG_RE, INLINE_RE, GROUP_RE;
function memoryExpressions() {
    TAG_RE = new RegExp('^[\\[(]\\s*(?:' + UNIT_ALT + ')s?\\s*(\\d+)\\s*(?:[-\\u2013]|to)?\\s*(\\d+)?\\s*[\\])]\\s*:?\\s*', 'i');
    INLINE_RE = new RegExp('^\\[\\s*(?:' + UNIT_ALT + ')s?\\s*(\\d+)\\s*(?:[-\\u2013]\\s*(\\d+))?\\s*(?:,\\s*([^\\]]*))?\\]\\s*(.*)$', 'i');
    GROUP_RE = new RegExp('^\\[\\s*(?:(.+?)\\s+-\\s+)?(?:' + UNIT_ALT + ')s?\\s+(\\d+)(?:\\s*[-\\u2013]\\s*(\\d+))?\\s*\\]\\s*$', 'i');
}
memoryExpressions();

const dateFor = (a, b, dates) => {
    if (!dates) return '';
    if (b == null || b === a) return dates[a] || '';
    return dates[a] && dates[b] ? `${dates[a]} to ${dates[b]}` : (dates[a] || '');
};

/** Read a memory entry (new grouped layout or the older inline-tag layout) into [{a, b, date, text}] items. */
export function parseMemoryDoc(content) {
    const items = [];
    let group = null;
    for (const raw of String(content ?? '').split('\n')) {
        const l = raw.trim();
        if (!l || l.startsWith('## ►')) continue;
        const g = l.match(GROUP_RE);
        if (g) { group = { date: g[1] || '', a: Number(g[2]), b: g[3] ? Number(g[3]) : null }; continue; }
        if (!/^[-*] /.test(l)) continue;
        const text = l.replace(/^[-*] /, '').trim();
        const i = text.match(INLINE_RE);
        if (i) items.push({ a: Number(i[1]), b: i[2] ? Number(i[2]) : null, date: (i[3] || '').trim(), text: i[4].trim() });
        else items.push({ a: group?.a ?? null, b: group?.b ?? null, date: group?.date ?? '', text });
    }
    return items;
}

/** Turn items into the grouped entry text. Groups run oldest first. */
export function memoryDocText(name, items, dates = {}, unit = 'Day') {
    const u = UNITS.includes(unit) ? unit : (String(unit || 'Day').trim() || 'Day');
    const groups = new Map();
    for (const it of items) {
        const k = `${it.a ?? 'x'}-${it.b ?? ''}-${it.date || dateFor(it.a, it.b, dates)}`;
        if (!groups.has(k)) groups.set(k, { a: it.a, b: it.b, date: it.date || '', list: [] });
        const g = groups.get(k);
        if (!g.date && it.date) g.date = it.date;
        g.list.push(it.text);
    }
    const ordered = [...groups.values()].sort((x, y) => (x.a ?? -1) - (y.a ?? -1) || (x.b ?? 0) - (y.b ?? 0));
    const out = [`## ► Memories — ${name}`, ''];
    for (const g of ordered) {
        if (g.a != null) {
            const date = g.date || dateFor(g.a, g.b, dates);
            const label = g.b != null && g.b !== g.a ? `${u}s ${g.a}-${g.b}` : `${u} ${g.a}`;
            out.push(date ? `[${date} - ${label}]` : `[${label}]`);
        }
        for (const x of g.list) out.push('- ' + x);
        out.push('');
    }
    return '\n' + out.join('\n').replace(/\n+$/, '') + '\n';
}

/** "[Day 4] text" for one item, the flat form used in review lists and sent to Condense. */
const flatLine = (it, unit = 'Day') => {
    if (it.a == null) return it.text;
    const tag = it.b != null && it.b !== it.a ? `${unit}s ${it.a}-${it.b}` : `${unit} ${it.a}`;
    return `[${tag}${it.date ? ', ' + it.date : ''}] ${it.text}`;
};

/** Read "[Day 4] text" lines back into items (dates are filled from `dates`). */
function itemsFromFlat(lines, dates = {}) {
    return lines.map(raw => {
        const l = String(raw).replace(/^\s*[-*]\s+/, '').trim();
        const dated = l.match(INLINE_RE);
        if (dated) {
            const a = Number(dated[1]), b = dated[2] ? Number(dated[2]) : null;
            return { a, b, date: (dated[3] || '').trim() || dateFor(a, b, dates), text: dated[4].trim() };
        }
        const m = l.match(TAG_RE);
        if (!m) return { a: null, b: null, date: '', text: l };
        const a = Number(m[1]), b = m[2] ? Number(m[2]) : null;
        return { a, b, date: dateFor(a, b, dates), text: l.slice(m[0].length).trim() };
    });
}

export function buildMemoryRequest(promptText, source, userName = 'the user') {
    return {
        system: String(promptText).replaceAll('{{user}}', userName),
        prompt: `SCENE LOG EXCERPT (the new Days to extract memories from)\n\n${source.text}\n\n---\nBACKGROUND, for who is who only (do not extract from this)\n\n${source.context || '(none)'}\n\n---\nReturn only the JSON.`,
    };
}

/** Returns [{name, aliases, memories}] or null when the reply was unusable. */
/** True for the format example a model sometimes echoes back instead of real content. */
const isPlaceholderText = (x) => /^(\[[^\]]*\]\s*)?[.\u2026\s]*$/.test(String(x)) || /^(\[[^\]]*\]\s*)?<[^>]*>$/.test(String(x).trim());
const isPlaceholderName = (n) => ['name', 'other name', 'character name', '<character name>', '<other name>'].includes(String(n).trim().toLowerCase());

export function parseMemoryResponse(text) {
    const m = String(text ?? '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    let obj; try { obj = JSON.parse(m[0]); } catch { return null; }
    if (!Array.isArray(obj.characters)) return null;
    const byName = new Map();
    let echoed = 0;
    for (const c of obj.characters) {
        const name = String(c?.name ?? '').trim();
        if (!name || name.length > 60) continue;
        if (isPlaceholderName(name)) { echoed++; continue; }
        const mem = (Array.isArray(c.memories) ? c.memories : []).map(x => String(x).replace(/\s+/g, ' ').trim()).filter(x => x.length >= 8 && !isPlaceholderText(x));
        if (!mem.length) continue;
        const al = (Array.isArray(c.aliases) ? c.aliases : []).map(x => String(x).trim()).filter(x => x.length >= 2 && x.length <= 40 && x.toLowerCase() !== name.toLowerCase());
        const k = name.toLowerCase();
        const cur = byName.get(k) ?? { name, aliases: [], memories: [] };
        cur.aliases = [...new Set([...cur.aliases, ...al])].slice(0, 6);
        cur.memories.push(...mem);
        byName.set(k, cur);
    }
    if (!byName.size && echoed) return null; // the model copied the format example: treat as unusable so it is retried
    return [...byName.values()];
}

const textKey = (s) => {
    const text = String(s).replace(/^\s*[-*] /, '');
    return (text.match(INLINE_RE)?.[4] ?? text.replace(TAG_RE, '')).trim().toLowerCase();
};
const comparableDate = date => String(date || '').toLowerCase().replace(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s*/g, '').replace(/,/g, '').replace(/\s+/g, ' ').trim();

/** Work out what would be added to each character's memory entry. Nothing is modified. */
export function planMemories(data, chars, { cap = 30, tag = '', unit = 'Day', dates = {} } = {}) {
    const existing = managed(data).filter(x => x.cl.type === 'memory');
    const out = [];
    for (const c of chars) {
        const name = c.name.toLowerCase();
        const direct = existing.filter(x => x.cl.name.toLowerCase() === name);
        const aliases = existing.filter(x => (x.e.sceneArchivist?.aliases || []).some(k => String(k).toLowerCase() === name));
        const matches = direct.length ? direct : aliases;
        const ex = matches.length === 1 ? matches[0] : null;
        const have = ex ? parseMemoryDoc(ex.e.content) : [];
        const bullets = [];
        for (const raw of c.memories) {
            const clean = String(raw).replace(/^\s*[-*]\s+/, '').trim();
            const withTag = TAG_RE.test(clean) || INLINE_RE.test(clean) || !tag ? clean : `${tag} ${clean}`;
            const it = itemsFromFlat([withTag], dates)[0];
            const k = textKey(it.text);
            if (!k || have.some(old => textKey(old.text) === k && old.a === it.a && old.b === it.b && (!old.date || !it.date || comparableDate(old.date) === comparableDate(it.date)))) continue;
            have.push(it); bullets.push(flatLine(it, unit));
        }
        if (!bullets.length || ex?.e.sceneArchivist?.protection?.locked || ex?.e.sceneArchivist?.protection?.exact) continue;
        const total = (ex ? parseMemoryDoc(ex.e.content).length : 0) + bullets.length;
        out.push({
            include: true, name: ex ? ex.cl.name : c.name, aliases: c.aliases, uid: ex?.e.uid ?? null, bullets,
            keys: withVariants([c.name, ...c.aliases]), total,
            warn: matches.length > 1 ? 'This name or alias is ambiguous. A separate entry is proposed; review the identity before saving.' : total > cap ? `${total} memories is a lot for one character. Consider reviewing the whole list.` : '',
        });
    }
    return out;
}

/** Add to existing memory entries or create new ones, grouped by date, then put everything in reading order. */
export function applyMemories(data, plan, opts, makeEntry, { constant = false, dates = {}, unit = 'Day' } = {}) {
    data.entries ??= {};
    const rep = { created: [], updated: [], converted: convertDelivery(data, opts) };
    const fresh = [];
    for (const p of plan) {
        if (!p.include) continue;
        const add = itemsFromFlat(p.bullets, dates);
        const ex = p.uid != null ? data.entries[p.uid] : null;
        if (ex) {
            const name = (String(ex.content).match(/^## ► Memories — (.+)$/m) || [, p.name])[1].trim();
            ex.content = memoryDocText(name, [...parseMemoryDoc(ex.content), ...add], dates, unit);
            ex.key = withVariants([...(ex.key ?? []), ...p.keys]).slice(0, 16);
            rep.updated.push(p.name);
        } else {
            const e = newEntry(data, makeEntry);
            applyDefaults(e, opts, constant);
            e.content = memoryDocText(p.name, add, dates, unit);
            e.comment = `🧠| Memories · ${p.name}`;
            e.key = p.keys.slice(0, 16);
            e.keysecondary = [];
            fresh.push(e.uid);
            rep.created.push(p.name);
        }
    }
    reorder(data, fresh, opts);
    return rep;
}


// ---------------------------------------------------------------- Condense memories

/** Memory entries in a lorebook, each with its memories as flat "[Day 4] text" lines. */
export function memoryEntries(data, unit = 'Day') {
    return managed(data).filter(x => x.cl.type === 'memory').map(x => ({
        uid: x.e.uid, name: x.cl.name, title: x.e.comment,
        bullets: parseMemoryDoc(x.e.content).map(i => flatLine(i, unit)),
    }));
}

export function buildCondenseRequest(promptText, name, bullets) {
    return { system: String(promptText), prompt: `CHARACTER: ${name}\n\nMEMORIES (${bullets.length})\n${bullets.map(b => '- ' + b).join('\n')}\n\nReturn only the JSON.` };
}

/** Returns { bullets, suspicious } or null when the reply is unusable or would make the list longer. */
export function parseCondenseResponse(text, before) {
    const m = String(text ?? '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    let obj; try { obj = JSON.parse(m[0]); } catch { return null; }
    if (!Array.isArray(obj.memories)) return null;
    const bullets = obj.memories.map(x => String(x).replace(/\s+/g, ' ').replace(/^[-*]\s*/, '').trim()).filter(x => x.length >= 8 && !isPlaceholderText(x));
    if (!bullets.length || bullets.length > before.length) return null;
    return { bullets, suspicious: bullets.length * 3 < before.length };
}

/** Replace the memories of one entry with the condensed list, regrouped by date. */
export function applyCondense(data, uid, bullets, { dates = {}, unit = 'Day' } = {}) {
    const e = data.entries?.[uid];
    if (!e) return false;
    if (e.sceneArchivist?.protection?.locked || e.sceneArchivist?.protection?.exact || e.sceneArchivist?.protection?.detailed) return false;
    const name = (String(e.content).match(/^## ► Memories — (.+)$/m) || [, ''])[1].trim();
    e.content = memoryDocText(name, itemsFromFlat(bullets, dates), dates, unit);
    return true;
}


// ---------------------------------------------------------------- Trackers, ask the archive, recap

/** The newest `n` Day entries plus the state sections for background. */
export function latestUnits(data, n = 3) {
    const m = managed(data);
    const days = m.filter(x => x.cl.type === 'day').sort((a, b) => (a.cl.dayNum ?? 0) - (b.cl.dayNum ?? 0)).slice(-Math.max(1, Number(n) || 3));
    return {
        days: days.map(x => x.cl.dayNum),
        text: days.map(x => x.e.content.trim()).join('\n\n'),
        context: m.filter(x => x.cl.type === 'state').map(x => x.e.content.trim()).join('\n\n'),
    };
}

export const cleanTrackerText = (t) => String(t ?? '').replace(/^\s*```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/, '').replace(/^## ► Tracker.*\n+/i, '').trim();

/** Body text of an existing tracker entry (without its heading). */
export function trackerText(data, name) {
    const x = managed(data).find(y => y.cl.type === 'tracker' && y.cl.name.toLowerCase() === String(name).toLowerCase());
    return x ? x.e.content.replace(/^\s*## ► Tracker — .*\n+/, '').trim() : '';
}

export function buildTrackerRequest(tracker, src, previous, userName = 'the user') {
    return {
        system: `${tracker.prompt}\n\nRules:\n- Rewrite the whole tracker: keep what is still true, update what changed, drop what is resolved.\n- Use only what the log says. Never write ${userName}'s private thoughts.\n- Return only the tracker as short markdown bullets, with no heading and no commentary.`,
        prompt: `TRACKER UPDATE: ${tracker.name}\n\nPREVIOUS VERSION\n${previous || '(none yet)'}\n\n---\nLATEST LOG\n${src.text}\n\n---\nBACKGROUND\n${src.context || '(none)'}\n\n---\nWrite the updated tracker now.`,
    };
}

/** Create or replace one tracker entry. Trackers are always on and sit between the memories and the states. */
export function applyTracker(data, name, text, opts, makeEntry) {
    data.entries ??= {};
    const rep = { action: '', converted: convertDelivery(data, opts) };
    const content = `\n## ► Tracker — ${name}\n\n${cleanTrackerText(text)}\n`;
    const ex = managed(data).find(x => x.cl.type === 'tracker' && x.cl.name.toLowerCase() === String(name).toLowerCase());
    if (ex?.e.sceneArchivist?.protection?.locked || ex?.e.sceneArchivist?.protection?.exact) return { action: 'protected', converted: 0 };
    if (ex) { ex.e.content = content; rep.action = 'updated'; return rep; }
    const e = newEntry(data, makeEntry);
    applyDefaults(e, opts, true);
    e.content = content;
    e.comment = `📌| Tracker · ${name}`;
    e.key = []; e.keysecondary = [];
    reorder(data, [e.uid], opts);
    rep.action = 'created';
    return rep;
}

/** Everything the log says, newest first within a size budget, for a free-form question. */
export function buildAskRequest(askPrompt, question, data, { maxChars = 60000 } = {}) {
    const m = managed(data).filter(x => !['opening', 'closing'].includes(x.cl.type));
    const keep = new Set(m.filter(x => x.e.constant).map(x => x.e.uid));
    let used = m.filter(x => x.e.constant).reduce((n, x) => n + x.e.content.length, 0);
    const rest = m.filter(x => !x.e.constant).sort((a, b) => (b.cl.dayNum ?? -1) - (a.cl.dayNum ?? -1));
    let omitted = 0;
    for (const x of rest) { const len = x.e.content.length; if (used + len > maxChars) { omitted++; continue; } used += len; keep.add(x.e.uid); }
    const text = m.filter(x => keep.has(x.e.uid)).map(x => x.e.content.trim()).join('\n\n');
    return { omitted, system: String(askPrompt), prompt: `ASK THE ARCHIVE: ${String(question).trim()}\n\nSCENE LOG\n${text}\n\n---\nAnswer the question now.` };
}

export function buildRecapRequest(recapPrompt, data, n = 3) {
    const src = latestUnits(data, n);
    return { days: src.days, system: String(recapPrompt), prompt: `PREVIOUSLY ON: recap\n\nSCENE LOG EXCERPT\n${src.text}\n\n---\nBACKGROUND\n${src.context || '(none)'}\n\n---\nWrite the recap now.` };
}


// ---------------------------------------------------------------- Transcripts, passes and the archive ledger

export const estimateTokens = (s) => Math.ceil(String(s ?? '').length / 3.6);

/** Messages: [{ idx, name, text }]. One line per message so the model can refer to message numbers. */
export function buildTranscript(msgs) {
    return msgs.map(m => `[#${m.idx}] ${m.name}: ${String(m.text).trim()}`).join('\n\n');
}

/** Split consecutive messages into passes of at most `maxTokens` (a single huge message gets a pass of its own). */
export function splitPasses(msgs, maxTokens = 12000) {
    const passes = [];
    let cur = null;
    for (const m of msgs) {
        const tk = estimateTokens(`[#${m.idx}] ${m.name}: ${m.text}`) + 4;
        if (!cur || m.idx !== cur.to + 1 || (cur.tokens + tk > maxTokens && cur.messages.length)) { cur = { from: m.idx, to: m.idx, messages: [], tokens: 0 }; passes.push(cur); }
        cur.messages.push(m); cur.to = m.idx; cur.tokens += tk;
    }
    return passes;
}

/** Ledger ranges are authoritative; migrate marker-only records as one range. */
export function archivedRanges(meta = {}) {
    const ranges = Array.isArray(meta.ranges) ? meta.ranges :
        (Number(meta.archivedThrough ?? -1) >= 0 ? [{ from: 0, to: Number(meta.archivedThrough) }] : []);
    return ranges.filter(r => Number.isInteger(r.from) && Number.isInteger(r.to) && r.from >= 0 && r.to >= r.from);
}

/** Highest index covered continuously from message zero. */
export function coverageThrough(meta = {}) {
    let through = -1;
    for (const r of archivedRanges(meta).slice().sort((a, b) => a.from - b.from)) {
        if (r.from > through + 1) break;
        through = Math.max(through, r.to);
    }
    return through;
}

/** Explicit bounds request a redo; automatic runs process every uncovered message. */
export function pendingMessages(chat, meta = {}, { from = null, to = null } = {}) {
    const explicit = from != null || to != null;
    const start = from != null ? Number(from) : 0;
    const end = to != null ? Number(to) : chat.length - 1;
    const ranges = archivedRanges(meta);
    const out = [];
    for (let i = Math.max(0, start); i <= Math.min(end, chat.length - 1); i++) {
        if (!explicit && ranges.some(r => i >= r.from && i <= r.to)) continue;
        const m = chat[i];
        if (!m || m.is_system || !String(m.mes ?? '').trim()) continue;
        out.push({ idx: i, name: m.name || (m.is_user ? 'User' : 'Character'), text: String(m.mes) });
    }
    return out;
}

export function buildArchivistRequest(promptText, logText, transcript, range, unit = 'Day') {
    const log = logText && logText.trim()
        ? `CURRENT SCENE LOG (the always-on part; continue from it, never reprint it):\n\n${logText.trim()}`
        : `CURRENT SCENE LOG: (none yet, so start the log from ${unit} 1)`;
    return {
        system: String(promptText),
        prompt: `${log}\n\n---\n\nTRANSCRIPT TO SUMMARIZE (messages ${range.from} to ${range.to}):\n\n${transcript}\n\n---\n\nNow write the update.`,
    };
}

/** Add an archived range to the ledger and move the "archived through" marker. */
export function ledgerAdd(meta, { from, to, days = [], hidden = false, hiddenTo = null, note = '' }) {
    const m = { ...(meta ?? {}) };
    m.ranges = [...archivedRanges(m), { from, to, days: [...new Set(days)].sort((a, b) => a - b), hidden: !!hidden, hiddenTo: hidden ? (hiddenTo ?? to) : null, note: String(note || '') }];
    m.archivedThrough = coverageThrough(m);
    return m;
}

/** Ledger rows for display, newest last. */
export function ledgerRows(meta) {
    return (meta?.ranges ?? []).map((r, i) => ({ i, label: r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`, days: r.days ?? [], hidden: !!r.hidden, note: r.note || ((r.days ?? []).length ? 'Day ' + r.days.join(', ') : '') }));
}

/**
 * Parse a hand-kept list like
 *   * ~~0-8 Tuesday, October 6, 2026~~
 *   * 311-348 Friday, October 23, 2026
 * Struck-through lines are archived (and hidden); plain lines are not archived yet.
 */
export function parseLedgerList(text) {
    const rows = [];
    for (const line of String(text ?? '').split('\n')) {
        const m = line.trim().match(/^[*\-\u2022]?\s*(~~)?\s*(\d+)\s*[-\u2013]\s*(\d+)\s*(.*?)\s*(~~)?\s*$/);
        if (!m) continue;
        const from = Number(m[2]), to = Number(m[3]);
        if (to < from) continue;
        rows.push({ from, to, note: m[4].replace(/~~/g, '').trim(), archived: !!m[1] });
    }
    return rows;
}

/** Plain-text export of the whole log in reading order. */
export function exportLogMarkdown(data) {
    return managed(data).map(x => x.e.content.trim()).filter(Boolean).join('\n\n') + '\n';
}

// ---------------------------------------------------------------- Prompt library

/** Built-in prompts overlaid with the user's saved ones. Custom ids start with "u-". */
export function promptList(builtinTexts, library = []) {
    const out = [];
    for (const b of builtinTexts) {
        const o = library.find(p => p.id === b.id);
        out.push({ id: b.id, name: o?.name ?? b.name, text: o?.text ?? b.text, unit: o?.unit || b.unit || 'Day', builtin: true, modified: !!o });
    }
    for (const p of library) if (!builtinTexts.some(b => b.id === p.id)) out.push({ id: p.id, name: p.name, text: p.text, unit: p.unit || 'Day', builtin: false, modified: false });
    return out;
}

export function exportPrompt(p) {
    return JSON.stringify({ sceneArchivistPrompt: 1, name: p.name, text: p.text, unit: p.unit || 'Day' }, null, 2);
}

export function parsePromptImport(raw) {
    try {
        const o = JSON.parse(String(raw));
        if (o && o.sceneArchivistPrompt && typeof o.text === 'string' && o.text.trim().length >= 20) return { name: String(o.name || 'Imported prompt').slice(0, 60), text: o.text, unit: String(o.unit || 'Day').slice(0, 32) };
    } catch { /* fall through */ }
    return null;
}
