// Chat-local controls and prompt bookkeeping. These helpers also run without SillyTavern.
import { record, uid } from './memory-engine.js';

const messageKey = 'sceneArchivistMessageId';

export function anchorMessage(message) {
    if (!message) throw new Error('That message is no longer in this chat.');
    // SillyTavern replaces extra when swiping. The message itself keeps its ID.
    return (message[messageKey] ||= uid());
}

export function anchorIndex(chat, anchor) {
    if (!anchor) return null;
    const index = chat.findIndex(message => message[messageKey] === anchor);
    return index === -1 ? null : index;
}

export function rangeControl(metadata) {
    return (metadata.rangeControl ??= { endpoints: {}, skipped: [] });
}

export function setEndpoint(state, chat, endpoint, index) {
    if (!['from', 'to'].includes(endpoint)) throw new Error('Choose Start or End.');
    state.endpoints[endpoint] = anchorMessage(chat[index]);
    return state.endpoints[endpoint];
}

export function resolveEndpoints(state, chat) {
    return Object.fromEntries(['from', 'to'].map(endpoint => {
        const anchor = state?.endpoints?.[endpoint];
        const index = anchorIndex(chat, anchor);
        return [endpoint, { index, missing: !!anchor && index === null }];
    }));
}

export function toggleSkipped(state, message) {
    const id = anchorMessage(message);
    if (state.skipped.includes(id)) {
        state.skipped = state.skipped.filter(item => item !== id);
        return false;
    }
    state.skipped.push(id);
    return true;
}

export function isSkipped(state, message) {
    const anchor = message?.[messageKey];
    return !!anchor && !!state?.skipped?.includes(anchor);
}

export async function isChatRename({ previous, current, parent, integrity, previousIntegrity, listFiles }) {
    if (!previous || previous === current || parent === previous || !integrity || integrity !== previousIntegrity) return false;
    if (!listFiles) return true;
    const files = await listFiles();
    if (!Array.isArray(files)) throw new Error('Could not check the previous chat name. Open Scene Archivist again to retry.');
    return !files.includes(previous.replace(/\.jsonl$/i, ''));
}

const normalizeName = value => String(value ?? '').trim().normalize('NFKC').toLowerCase();
const normalizeAvatar = value => String(value ?? '').replace(/\.[^/.]+$/, '');

export function memorySubject(record, members) {
    if (record.subjectAvatar) {
        const exact = members.find(member => member.avatar === record.subjectAvatar);
        if (exact) return exact;
        const matches = members.filter(member => normalizeAvatar(member.avatar) === normalizeAvatar(record.subjectAvatar));
        return matches.length === 1 ? matches[0] : null;
    }
    const subject = normalizeName(record.subject || record.character);
    if (!subject) return null;
    const matches = members.filter(member => [member.name, ...(member.aliases || [])].some(name => [subject, ...(record.aliases || []).map(normalizeName)].includes(normalizeName(name))));
    return matches.length === 1 ? matches[0] : null;
}

export function groupMemoryReason(record, group, enabled) {
    if (!enabled || !group || record?.type !== 'memory') return '';
    const subject = memorySubject(record, group.members);
    if (!subject || !group.speaker) return 'No unique character card for this memory';
    return subject.avatar === group.speaker ? '' : 'Belongs to another group character';
}

function ownsNativeGroupFilter(entry) {
    const card = record(entry)?.nativeGroupCard;
    const filter = entry.characterFilter;
    return !!card && filter?.isExclude === false && filter.names?.length === 1 && filter.names[0] === card && filter.tags?.length === 0;
}

/** Preserve native rules edited in World Info. Write our rule only for a uniquely identified group card. */
export function saveNativeGroupFilter(entry, group, currentAvatar) {
    const r = record(entry);
    if (r?.type !== 'memory' || !group) return;
    if ((r.nativeGroupCard || entry.characterFilter) && !ownsNativeGroupFilter(entry)) return;
    const subjectAvatar = r.subjectAvatar && (currentAvatar?.(r.subjectAvatar) || r.subjectAvatar);
    const subject = memorySubject({ ...r, subjectAvatar }, group.members);
    const card = normalizeAvatar(subject?.avatar);
    if (!card || group.members.filter(member => normalizeAvatar(member.avatar) === card).length !== 1) return;
    r.subjectAvatar = subject.avatar;
    r.nativeGroupCard = card;
    entry.characterFilter = { names: [card], tags: [], isExclude: false };
}

/** Native rules are portable, but Scene Archivist's solo and opt-out behavior stays chat-local. */
export function prepareNativeGroupFilter(entry, group, enabled, currentAvatar) {
    if (!ownsNativeGroupFilter(entry)) return;
    if (!enabled || !group) {
        delete entry.characterFilter;
        return;
    }
    const r = record(entry);
    const card = normalizeAvatar(currentAvatar?.(r.subjectAvatar) || r.subjectAvatar);
    if (card && card !== r.nativeGroupCard) entry.characterFilter = { ...entry.characterFilter, names: [card] };
}

export function sharedPrefix(previous = '', current = '') {
    let end = 0;
    const limit = Math.min(previous.length, current.length);
    while (end < limit && previous[end] === current[end]) end++;
    return current.slice(0, end);
}
