import * as Core from './core.js';
import * as M from './memory-engine.js';
import { isSkipped } from './chat-workflows.js';

export function messageRuns(messages) {
    return Core.splitPasses(messages, Infinity);
}

export function selectedMessages(chat, range) {
    return range ? M.messageRange(chat, range.from, range.to).messages : [];
}

export function uncoveredMemoryMessages(chat, receipts = [], persona = false) {
    const covered = new Set(receipts.filter(receipt => !persona || receipt.persona)
        .flatMap(receipt => receipt.source?.ranges?.flatMap(range => range.messages.map(message => message.hash)) ?? []));
    // Repeated text needs positional evidence. An identical later message must
    // not inherit the receipt of an earlier occurrence.
    const counts = new Map();
    for (const message of chat) {
        const hash = M.messageHash(message);
        counts.set(hash, (counts.get(hash) || 0) + 1);
    }
    const indexed = new Set(receipts.filter(receipt => !persona || receipt.persona)
        .flatMap(receipt => receipt.source?.ranges?.flatMap(range => range.messages.map(message => `${message.index}:${message.hash}`)) ?? []));
    return Core.pendingMessages(chat).filter(message => {
        const hash = M.messageHash(chat[message.idx]);
        return !indexed.has(`${message.idx}:${hash}`) && !(counts.get(hash) === 1 && covered.has(hash));
    });
}

export function uncoveredArchiveMessages(chat, metadata) {
    const ranges = Core.archivedRanges(metadata);
    const receipts = ranges.filter(range => range.source?.ranges?.length).map(range => ({ source: range.source }));
    const legacy = ranges.filter(range => !range.source?.ranges?.length);
    return uncoveredMemoryMessages(chat, receipts).filter(message => !isSkipped(metadata.rangeControl, chat[message.idx]) && !legacy.some(range => message.idx >= range.from && message.idx <= range.to));
}

export function archiveAnswer(raw) {
    const obj = M.parseJSON(raw);
    if (typeof obj?.archive !== 'string') {
        if (/^\s*(?:\x60{3}(?:json)?\s*)?\{/.test(raw)) throw new Error('The archive response was incomplete. Edit it as Markdown or retry the stage.');
        return { raw, keywords: [] };
    }
    return { raw: obj.archive, keywords: Array.isArray(obj.keywords) ? obj.keywords : [], littleThings: obj.littleThings };
}

export const archiveOutputId = index => `new-archive-${index + 1}`;

export function trackerAnswer(raw, trackers) {
    const result = M.parseJSON(raw)?.trackers;
    if (!Array.isArray(result) || result.length !== trackers.length) throw new Error('The response must contain every enabled tracker exactly once.');
    return trackers.map(tracker => {
        const matches = result.filter(item => item?.id === tracker.id && typeof item.content === 'string');
        const content = matches.length === 1 ? Core.cleanTrackerText(matches[0].content) : '';
        if (!content) throw new Error(`The response is missing a usable update for ${tracker.name}.`);
        return { id: tracker.id, content };
    });
}

export function halve(items = []) {
    if (items.length < 2) return null;
    const middle = Math.ceil(items.length / 2);
    return [items.slice(0, middle), items.slice(middle)];
}
