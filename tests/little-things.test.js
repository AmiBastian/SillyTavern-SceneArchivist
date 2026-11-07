import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../memory-engine.js';
import * as Little from '../little-things.js';
import * as Journal from '../entry-journal.js';
import { projectBranch } from '../recovery-tools.js';

const chat = [
    { name: 'Mara', is_user: true, mes: 'Time: October 6, 2026\nPlace: Ember Station\n“I owe you a coffee,” Mara said.' },
    { name: 'Rowan', mes: 'He tucked the brass key under his coat.' },
];
const evidence = index => ({ ...M.sourceSnapshot('source', chat, [{ from: index, to: index }]), actualChatId: 'main' });
const note = Little.makeLittleThing({ text: 'Mara promised Rowan a coffee.', cues: ['coffee', 'brass key'], knows: ['Rowan'],
    participants: ['Mara', 'Rowan'], thread: 'open', date: 'October 6, 2026', quote: 'I owe you a coffee' }, evidence(0));
const speaker = { names: ['Rowan'] };
const candidates = (messages, options = {}, notes = [note]) => Little.noteRecall(notes, {
    frame: Little.recallFrame(messages, 'normal', speaker.names), speaker, chat: messages, sourceId: 'source',
    carry: new Map(), requested: new Set(), ...options,
});

test('recall finds unspaced scripts, short names and Arabic attached prefixes', () => {
    const samples = [
        ['铜钥匙', '她把铜钥匙放在左边的口袋里。'],
        ['青い鍵', '彼女は青い鍵をそっとしまった。'],
        ['กุญแจ', 'เธอเก็บกุญแจไว้ในกระเป๋า'],
        ['المفتاح', 'خبّأت مريم المصباح وَبِالْمِفْتَاحِ فتحت الباب.'],
        ['Jo', 'Mara handed Jo the key.'],
        ['Jo', '彼女はJoに鍵を渡した。'],
        ['李', '李把它带回家。'],
    ];
    for (const [cue, mes] of samples) {
        const detail = Little.makeLittleThing({ text: 'Remember the handover.', cues: [cue], knows: ['Rowan'] });
        const messages = [{ name: 'Mara', is_user: true, mes }];
        assert.equal(candidates(messages, {}, [detail]).length, 1, cue);
    }
    const short = Little.makeLittleThing({ text: 'Jo has the key.', cues: ['Jo'] });
    assert.equal(candidates([{ name: 'Mara', mes: 'Joanne found her journal.' }], {}, [short]).length, 0);

    const entry = { key: ['青い鍵'], sceneArchivist: { type: 'unit' } };
    assert.equal(Little.recordRecall([entry], Little.recallFrame([{ mes: samples[1][1] }], 'normal'))[0].entry, entry);
});

test('notes match an evidenced cue and verify exact quotes against the live source', async () => {
    const messages = [...chat, { name: 'Mara', is_user: true, mes: 'What were the exact words about the coffee?' }];
    const [matched] = candidates(messages);
    assert.match(matched.reason, /^Cue/);
    assert.equal(matched.quote, 'I owe you a coffee');
    const edited = [{ ...messages[0], mes: 'Time: October 6, 2026\nI said something else.' }, ...messages.slice(1)];
    assert.equal(candidates(edited)[0].quote, '');
    const packed = await Little.packLittleThings([matched], 100);
    assert.match(packed.text, /“I owe you a coffee”/);
    assert.ok(packed.tokens <= 100);
    assert.equal((await Little.packLittleThings([matched], 5)).text, '');
});

test('vague promises require both participants and ambiguous group names stay private', () => {
    const messages = [...chat, { name: 'Mara', is_user: true, mes: 'Scene: Kitchen\nYou still owe me.' }];
    assert.match(candidates(messages)[0].reason, /Open promise/);
    const members = [{ avatar: 'r1.png', name: 'Rowan' }, { avatar: 'r2.png', name: 'Rowan' }];
    assert.equal(candidates(messages, { speaker: { names: ['Rowan'], group: { members, speaker: 'r1.png' } } }).length, 0);
    const withOtherSpeaker = { ...speaker, names: ['Keeper'] };
    assert.equal(candidates(messages, { speaker: withOtherSpeaker, requested: new Set([note.id]) }).length, 0);
});

test('carry and date cutoffs preserve the scene and suppress future details during a flashback', () => {
    const carry = new Map([[note.id, { index: 1, hash: M.messageHash(chat[1]), date: note.date, place: 'ember station' }]]);
    const later = [...chat, ...Array.from({ length: 3 }, () => ({ name: 'Rowan', mes: 'He waited.' })), { name: 'Mara', is_user: true, mes: 'He looked over.' }];
    assert.equal(candidates(later, { carry })[0].reason, 'Carried from this scene');
    assert.equal(candidates([...later, { name: 'Rowan', mes: 'Still waiting.' }], { carry }).length, 0);
    const moved = [...later, { name: 'Mara', is_user: true, mes: 'Place: Lighthouse\nWhat now?' }];
    assert.equal(candidates(moved, { carry }).length, 0);
    const past = [...later, { name: 'Mara', is_user: true, mes: 'Flashback: October 1, 2026\nWould you like coffee?' }];
    assert.equal(candidates(past, { carry, requested: new Set([note.id]) }).length, 0);
    const memory = { sceneArchivist: { type: 'memory', dates: ['October 1, 2026'], learnedAt: 'October 6, 2026' } };
    assert.equal(Little.flashbackReason(memory, Little.recallFrame(past, 'normal')), 'After this flashback');
});

test('branch projection keeps only matching source messages, and note Undo preserves unrelated notes', () => {
    const later = Little.makeLittleThing({ text: 'Rowan hid the brass key.' }, evidence(1));
    const before = { entries: {}, sceneArchivistStory: { schema: 1, id: 'story', shared: false } };
    const after = M.copy(before);
    Little.addLittleThings(after, [note, later], 'story');
    const args = { oldSource: 'source', sourceId: 'branch-source', storyId: 'branch', chatId: 'branch chat',
        chat: chat.slice(0, 1), archive: 'Archive', mapping: { Archive: 'Branch archive' } };
    const branch = projectBranch({ Archive: after }, { ...args, mode: 'prune' }).books.Archive;
    assert.deepEqual(Little.littleThings(branch).map(item => item.id), [note.id]);
    assert.equal(Little.littleThings(branch)[0].source.chatId, 'branch-source');
    assert.deepEqual(Little.littleThings(projectBranch({ Archive: after }, { ...args, mode: 'fresh' }).books.Archive), []);
    const journal = Journal.makeJournal();
    Journal.stageWrite(journal, 'Archive', before, after);
    Journal.confirmWrite(journal, 'Archive', after);
    const newNote = Little.makeLittleThing({ text: 'The fountain was dry.' });
    Little.addLittleThings(after, [newNote], 'story');
    const books = { Archive: after };
    const plan = Journal.planUndo(journal, books);
    assert.ok(plan.complete);
    const restored = Journal.applyUndo(books, plan);
    assert.deepEqual(Little.littleThings(restored.Archive), [newNote]);
    Journal.confirmUndo(journal, 'Archive', restored.Archive, plan);
    assert.ok(journal.changes.every(change => change.status === 'undone'));
});
