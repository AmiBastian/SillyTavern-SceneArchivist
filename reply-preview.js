import * as M from './memory-engine.js';

// Preview only direct matches. Do not run SillyTavern's scan here: even its
// dry-run scan can clear externally activated entries and change prompt state.
export function previewActivations(entries, { messages, messageCount, native, excluded, choices, details, cues }) {
    const activated = [], omitted = [], reasons = new Map();
    for (const entry of [...entries].sort((a, b) => (b.order || 0) - (a.order || 0))) {
        const id = M.record(entry).id;
        const scope = excluded(entry) || (!M.active(entry) ? 'In History' : entry.disable ? 'Disabled in World Info' : '');
        const choice = choices.get('record:' + id), requested = choice === 'load' || details.has(id);
        const match = scope ? { reason: scope, blocked: true } :
            matchEntry(entry, messages, messageCount, native, requested, cues.get(id));
        if (choice === 'skip') {
            omitted.push({ entry, id, reason: 'Skipped once', blocked: match.blocked });
        } else if (match.trigger) {
            activated.push(entry);
            reasons.set(id, [choice === 'load' ? 'load once' : match.trigger]);
        } else {
            omitted.push({ entry, id, reason: match.reason, blocked: match.blocked });
        }
    }
    return { activated, omitted, reasons };
}

function matchEntry(entry, messages, messageCount, native, requested, cue) {
    if (entry.triggers?.length && !entry.triggers.includes('normal')) return { reason: 'World Info excludes normal replies', blocked: true };
    const filter = entry.characterFilter;
    if ((filter?.names?.length && filter.names.includes(native.card) === !!filter.isExclude) ||
        (filter?.tags?.length && Array.isArray(native.tags) && filter.tags.some(tag => native.tags.includes(tag)) === !!filter.isExclude)) {
        return { reason: 'World Info character filter', blocked: true };
    }
    const directives = String(entry.content || '').match(/^(?:@@[^\n]*(?:\n|$))+/)?.[0] || '';
    if (directives.startsWith('@@dont_activate')) return { reason: 'World Info activation disabled', blocked: true };
    if (entry.delay > messageCount) return { reason: 'Waiting for World Info delay', blocked: true };
    const timed = native.timed?.cooldown?.[`${entry.world}.${entry.uid}`];
    if (entry.group || entry.sticky || timed && timed.end > messageCount || entry.delayUntilRecursion ||
        entry.useProbability && Number(entry.probability) < 100) return { reason: 'Activation depends on live World Info rules' };
    if (directives.startsWith('@@activate')) return { trigger: 'Activation decorator' };
    if (requested || entry.constant || cue) return { trigger: requested ? 'detail requested' : entry.constant ? 'Always on' : cue };

    const depth = Math.min(1000, Math.max(0, Number(entry.scanDepth ?? native.depth ?? 2) || 0));
    if (!depth) return { reason: 'World Info scan depth is zero' };
    const fields = Object.entries(native.fields || {}).filter(([flag, value]) => entry[flag] && value).map(([, value]) => value);
    const text = '\x01' + [...messages.slice(0, depth), ...fields].join('\n\x01');
    const primary = (entry.key || []).map(key => staticKey(key, native));
    if (!primary.some(key => matches(key, text, entry, native))) {
        return { reason: primary.includes(null) || entry.vectorized ? 'May activate when the reply is sent' : 'No matching keywords' };
    }
    const secondary = entry.selective ? (entry.keysecondary || []).map(key => staticKey(key, native)) : [];
    if (secondary.includes(null)) return { reason: 'A secondary keyword depends on a live macro' };
    const hits = secondary.map(key => matches(key, text, entry, native));
    const pass = !hits.length || [
        hits.some(Boolean), hits.some(hit => !hit), !hits.some(Boolean), hits.every(Boolean),
    ][entry.selectiveLogic ?? 0];
    return pass ? { trigger: 'Keyword match' } : { reason: 'Secondary keywords did not match' };
}

function staticKey(key, { character, user }) {
    const text = String(key || '').replace(/\{\{char\}\}/gi, () => character || '').replace(/\{\{user\}\}/gi, () => user || '').trim();
    return text.includes('{{') ? null : text;
}

function matches(key, text, entry, native) {
    if (!key) return false;
    const regex = native.parseRegex?.(key);
    if (regex) return regex.test(text);
    const sensitive = entry.caseSensitive ?? native.caseSensitive;
    const needle = sensitive ? key : key.toLowerCase(), haystack = sensitive ? text : text.toLowerCase();
    if (!(entry.matchWholeWords ?? native.wholeWords) || /\s/.test(needle)) return haystack.includes(needle);
    const literal = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\W)${literal}(?:$|\\W)`).test(haystack);
}
