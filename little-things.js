import { calendarDay, chronology, copy, hash, messageHash, now, record, tokens, uid, unique } from './memory-engine.js';
import { memorySubject } from './chat-workflows.js';

export function littleThings(book) {
    const notes = book?.sceneArchivistStory?.littleThings;
    return Array.isArray(notes) ? notes.filter(note => typeof note?.id === 'string' && typeof note.text === 'string' &&
        ['cues', 'knows', 'participants'].every(key => Array.isArray(note[key]) && note[key].every(value => typeof value === 'string'))) : [];
}

export function setLittleThings(book, notes, storyId = '') {
    if (notes.length) {
        (book.sceneArchivistStory ??= { schema: 1, id: storyId, shared: false }).littleThings = notes;
    } else if (book.sceneArchivistStory) delete book.sceneArchivistStory.littleThings;
}

const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
const unspaced = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
const arabic = /\p{Script_Extensions=Arabic}/u;
const cueText = value => normalize(value).replace(/[\u0640\p{M}]/gu, mark => mark === '\u0640' || arabic.test(mark) ? '' : mark).replace(/ +/g, ' ').trim();
const boundary = symbol => !symbol || symbol === ' ' || unspaced.test(symbol);
const arabicPrefix = / (?:[وف][بكل]?|[بكل])$/;
const arabicConjunction = / [وف]$/;

function phrase(text, cue) {
    if (!cue) return false;
    const symbols = [...cue], first = symbols[0], last = symbols.at(-1);
    const padded = ` ${text} `;
    const looseStart = unspaced.test(first), looseEnd = unspaced.test(last);
    const arabicWord = symbols.length > 1 && arabic.test(first);
    const forms = [[cue, arabicWord ? arabicPrefix : null]];
    // Arabic drops the article's alif after ل, as in المفتاح → للمفتاح.
    if (arabicWord && /^ال\p{L}/u.test(cue)) forms.push([`ل${cue.slice(1)}`, arabicConjunction]);
    for (const [form, prefix] of forms) {
        for (let at = padded.indexOf(form); at >= 0; at = padded.indexOf(form, at + 1)) {
            const end = at + form.length;
            const before = [...padded.slice(Math.max(0, at - 2), at)].at(-1);
            const after = [...padded.slice(end, end + 2)][0];
            const prefixed = prefix?.test(padded.slice(Math.max(0, at - 3), at));
            if ((looseStart || boundary(before) || prefixed) && (looseEnd || boundary(after))) return true;
        }
    }
    return false;
}
const line = (value, max) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const words = (value, max) => unique((Array.isArray(value) ? value : String(value ?? '').split(',')).map(word => line(word, 100))).slice(0, max);
const boundedQuote = value => typeof value === 'string' && value.trim().length <= 180 ? value.trim() : '';

export function makeLittleThing(fields, source = null, previous = null) {
    const text = line(fields.text, 600);
    if (!text) return null;
    const knows = words(fields.knows, 10);
    return {
        id: previous?.id || uid(),
        text,
        cues: words(fields.cues, 10),
        knows,
        knownAvatar: fields.knownAvatar || (knows.length === 1 && knows[0] === previous?.knows?.[0] ? previous.knownAvatar : '') || '',
        participants: words(fields.participants, 10),
        thread: ['open', 'closed'].includes(fields.thread) ? fields.thread : '',
        date: calendarDay(fields.date) || '',
        source: source ? copy(source) : null,
        recordId: previous?.recordId || fields.recordId || '',
        quote: previous?.text === text ? previous.quote : boundedQuote(fields.quote),
        created: previous?.created || now(),
    };
}

export function addLittleThings(book, proposals, storyId) {
    const saved = littleThings(book);
    const keys = new Set(saved.map(note => normalize(note.text)));
    const added = [];
    for (const note of proposals) {
        const key = normalize(note.text);
        if (!key || keys.has(key) || saved.some(item => item.id === note.id)) continue;
        keys.add(key);
        added.push(note);
    }
    if (added.length) setLittleThings(book, [...saved, ...added], storyId);
    return added;
}

export function reviewLittleThing(note, book) {
    const sources = note.source?.ranges?.map(range => range.from === range.to ? `#${range.from}` : `#${range.from} to #${range.to}`).join(', ');
    return { id: note.id, note, book, optional: true, section: 'Little Things', title: note.text.slice(0, 85), content: note.text,
        evidence: [sources && `Messages ${sources}`, note.knows.length ? `Known by ${note.knows.join(', ')}` : 'Shared detail',
            note.cues.length && `Cues ${note.cues.join(', ')}`].filter(Boolean).join(' · ') };
}

export function notePrompt(sourceField) {
    return `\nAdd an optional "littleThings" array to the same JSON. Keep the full requested main result. Suggest at most 12 brief, distinct details that are easy to lose and useful later: habits, gifts, small callbacks, sensory details, quiet promises or loose threads. Leave the array empty if there are none. Use only the supplied evidence, never background lore or invented events. Each suggestion is {"text":"short fact","cues":["specific phrase that might come up later"],"knows":["names of people confirmed to know"],"shared":false,"participants":["people in the detail"],"thread":"","date":"","${sourceField}":${sourceField === 'message' ? '0' : '"exact supplied record ID"'},"evidence":"short verbatim excerpt from that source"}. Use thread "open" or "closed" for unresolved or resolved promises, otherwise empty. Supply the full story date only if stated. Use shared:true only for a detail established as public. If awareness is uncertain, omit the suggestion.`;
}

export function proposedLittleThings(items, evidenceFor) {
    if (!Array.isArray(items)) return [];
    const result = [];
    for (const item of items.slice(0, 12)) {
        const evidence = evidenceFor(item);
        const quote = boundedQuote(item?.evidence);
        if (!evidence || !quote || !String(evidence.text).includes(quote)) continue;
        if (!evidence.knows && !words(item.knows, 10).length && item.shared !== true) continue;
        const dates = chronology(evidence.text).dates.map(calendarDay).filter(Boolean);
        const date = calendarDay(item.date);
        const note = makeLittleThing({ ...item, knows: evidence.knows || item.knows, knownAvatar: evidence.knownAvatar,
            date: dates.includes(date) ? date : '', recordId: evidence.recordId, quote: evidence.recordId ? '' : quote }, evidence.source);
        if (!note) continue;
        note.id = 'little-' + hash([normalize(note.text), note.source?.chatId, note.source?.ranges?.[0]?.from, note.recordId]);
        result.push(note);
    }
    return result;
}

export function verifiedNoteSource(source, sourceId, chat) {
    return source?.chatId === sourceId && !!source.ranges?.length && source.ranges.every(range =>
        Number.isInteger(range.from) && Number.isInteger(range.to) && range.from >= 0 && range.to < chat.length &&
        range.messages?.length === range.to - range.from + 1 && range.messages.every((m, i) =>
            m.index === range.from + i && chat[m.index] && messageHash(chat[m.index]) === m.hash));
}

export function projectLittleThings(book, { mode, oldSource, sourceId, chatId, chat }) {
    if (mode === 'fresh') return [];
    return littleThings(book).filter(note => verifiedNoteSource(note.source, oldSource, chat)).map(note => ({
        ...note, source: { ...note.source, chatId: sourceId, actualChatId: chatId, inheritedFrom: note.source.actualChatId || oldSource },
    }));
}

export function noteMatchesUnit(note, unit) {
    const r = record(unit);
    if (!r) return false;
    if (note.recordId === r.id || r.covers?.includes(note.recordId)) return true;
    if (note.source?.ranges?.length) return sourcesOverlap(note.source, r.source);
    return !!(note.date && r.dates?.some(date => calendarDay(date) === note.date));
}

export function sourcesOverlap(first, second) {
    if (!first?.chatId || first.chatId !== second?.chatId) return false;
    const hashes = new Map((first.ranges || []).flatMap(range => range.messages || []).map(m => [m.index, m.hash]));
    return !!second.ranges?.some(range => range.messages?.some(m => hashes.get(m.index) === m.hash));
}

const marker = /^\s*(?:[*_#[>]+\s*)?(flashback|time|date|place|location|scene)\s*(?:[*_]+\s*)?[:：]\s*(.+)$/i;
const sceneBreak = /^\s*(?:#{1,6}\s*)?\b(?:scene break|new scene)\b[.!]?\s*$/i;

export function recallFrame(chat, type, speakerNames = []) {
    const end = type === 'swipe' && chat.at(-1) && !chat.at(-1).is_user ? chat.length - 1 : chat.length;
    const recent = [];
    let date = '', place = '', scene = '', flashback = false, boundary = -1;
    for (let index = Math.max(0, end - 24); index < end; index++) {
        const m = chat[index];
        if (!m || m.is_system) continue;
        const text = String(m.mes || '');
        for (const raw of text.split('\n')) {
            const match = raw.match(marker);
            const sceneName = match?.[1].toLowerCase() === 'scene' ? normalize(match[2]) : '';
            if (sceneBreak.test(raw) || (sceneName && sceneName !== scene)) {
                recent.length = 0; boundary = index; date = ''; place = ''; flashback = false;
                scene = sceneName;
            }
            if (!match) continue;
            const field = match[1].toLowerCase();
            if (field === 'place' || field === 'location') {
                const nextPlace = normalize(match[2]);
                if (place && place !== nextPlace) { recent.length = 0; boundary = index; }
                place = nextPlace;
            } else if (field === 'flashback' || field === 'time' || field === 'date') {
                const nextDate = calendarDay(chronology(match[2]).dates[0] || match[2]);
                if (nextDate && (date && date !== nextDate || field === 'flashback')) {
                    recent.length = 0; boundary = index;
                    flashback = field === 'flashback';
                }
                if (nextDate) date = nextDate;
            }
        }
        recent.push({ index, text: cueText(text), name: normalize(m.name), isUser: !!m.is_user, hash: messageHash(m) });
    }
    const focus = recent.at(-1);
    const prior = recent.slice(-4, -1).reverse();
    const participants = new Set([...speakerNames.map(normalize), ...recent.slice(-3).filter(m => m.isUser).map(m => m.name)].filter(Boolean));
    return { focus, prior, participants, place, date, flashback: flashback ? date : '', boundary, end };
}

function cueMatch(cues, frame, eligible) {
    const hits = [...new Set(cues.map(cueText).filter(cue => cue && eligible(cue, [...cue].length)))];
    for (const [i, message] of [frame.focus, ...frame.prior].entries()) {
        if (!message) continue;
        const matched = hits.filter(cue => phrase(message.text, cue)).sort((a, b) => b.length - a.length)[0];
        if (matched) return { score: 30 - i * 6 + Math.min(10, matched.split(' ').length), reason: `${i ? 'Recent cue' : 'Cue'} · ${matched}`, anchor: message };
    }
    return null;
}

export function noteAudience(note, speaker) {
    if (note.knownAvatar) return speaker.avatar === (speaker.currentAvatar?.(note.knownAvatar) || note.knownAvatar);
    if (!note.knows?.length) return true;
    if (speaker.group) return note.knows.some(subject => {
        const card = memorySubject({ subject }, speaker.group.members);
        return !!card && card.avatar === speaker.group.speaker;
    });
    const names = new Set(speaker.names.map(normalize).filter(Boolean));
    return note.knows.some(name => names.has(normalize(name)));
}

function carryMatch(item, frame, chat) {
    if (!item || item.index < frame.boundary || item.date && frame.date && item.date !== frame.date ||
        item.place && frame.place && item.place !== frame.place || item.index >= frame.end ||
        !chat[item.index] || messageHash(chat[item.index]) !== item.hash) return null;
    const replies = chat.slice(item.index + 1, frame.end).filter(message => !message.is_user && !message.is_system).length;
    return replies > 0 && replies <= 3 ? { score: 10, reason: 'Carried from this scene', anchor: item } : null;
}

export function noteRecall(notes, { frame, speaker, chat, sourceId, carry, requested }) {
    const allowed = notes.filter(note => note.text && noteAudience(note, speaker) &&
        (!frame.flashback || note.date && note.date <= frame.flashback));
    const speaking = new Set(speaker.names.map(normalize));
    const openPromises = allowed.filter(note => {
        const involved = (note.participants || []).map(normalize);
        return note.thread === 'open' && involved.some(name => speaking.has(name)) &&
            involved.some(name => name && !speaking.has(name) && (frame.participants.has(name) || phrase(frame.focus?.text || '', cueText(name))));
    });
    const reminder = /\b(?:you (?:still )?owe me|you promised|our promise|did you forget (?:our|your) promise|hold you to (?:it|that))\b/.test(frame.focus?.text || '');
    const exact = /\b(?:exact words|word for word|verbatim|quote|what did .{1,60} say)\b/.test(frame.focus?.text || '');
    return allowed.flatMap(note => {
        const names = [...(note.participants || []), ...(note.knows || [])];
        const match = requested.has(note.id) ? { score: 100, reason: 'Requested for this reply' } :
            cueMatch(note.cues || [], frame, (cue, length) => length >= 3 || unspaced.test(cue) ||
                length === 2 && names.some(name => cueText(name) === cue)) ||
            (reminder && openPromises.length === 1 && openPromises[0] === note ? { score: 28, reason: 'Open promise between scene participants', anchor: frame.focus } : null) ||
            carryMatch(carry.get(note.id), frame, chat);
        if (!match) return [];
        const quote = exact && note.quote && verifiedNoteSource(note.source, sourceId, chat) &&
            note.source.ranges.some(range => range.messages.some(m => String(chat[m.index].mes).includes(note.quote))) ? note.quote : '';
        return [{ note, ...match, quote }];
    }).sort((a, b) => b.score - a.score);
}

const recalledTypes = new Set(['unit', 'recap', 'memory', 'fact', 'knowledge', 'thread', 'clip']);
export function flashbackReason(entry, frame) {
    const r = record(entry);
    if (!frame.flashback || !r || !recalledTypes.has(r.type) && !['tracker', 'state'].includes(r.type)) return '';
    const dates = [...(r.dates || []), r.learnedAt].map(calendarDay).filter(Boolean);
    if (!dates.length) return 'No dated evidence for this flashback';
    return dates.some(date => date > frame.flashback) ? 'After this flashback' : '';
}

export function recordRecall(entries, frame, chat = [], carry = new Map()) {
    return entries.flatMap(entry => {
        const r = record(entry);
        if (!recalledTypes.has(r?.type) || r.knowledge === 'unaware' || entry.disable || entry.constant || entry.keysecondary?.length || entry.probability < 100 ||
            entry.group || entry.characterFilter?.names?.length || entry.characterFilter?.tags?.length || entry.decorators?.length ||
            entry.delay || entry.cooldown || entry.sticky || flashbackReason(entry, frame)) return [];
        const match = cueMatch([...(entry.key || []), ...(r.locations || []), ...(r.aliases || [])], frame,
            (cue, length) => cue.includes(' ') || length > 1 && unspaced.test(cue)) ||
            carryMatch(carry.get(r.id), frame, chat);
        return match ? [{ entry, ...match }] : [];
    }).sort((a, b) => b.score - a.score).slice(0, 4);
}

const noteLine = ({ note, quote }) => `- ${note.text}${quote ? ` Exact words: “${quote}”` : ''}`;
const block = items => items.length ? 'Small details from this story. Treat these as story evidence and use them when relevant.\n' + items.map(noteLine).join('\n') : '';
export async function packLittleThings(ranked, budget, count = tokens) {
    const items = [];
    let used = 0;
    for (const match of ranked) {
        if (items.length >= 4) break;
        const next = [...items, match];
        const cost = await count(block(next));
        if (cost > budget) continue;
        used = cost;
        items.push(match);
    }
    return { items, text: block(items), tokens: used };
}
