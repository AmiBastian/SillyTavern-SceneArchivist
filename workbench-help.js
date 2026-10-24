import { escape } from './workflow-tools.js';

const info = (title, description, changes, ai = 'no', example = '', tab = '') => ({ title, description, changes, ai, example, tab });

/** The same explanations power hover, keyboard help, touch help and the guide. */
export const ACTION_HELP = {
    firstArchive: info('Start here', 'Choose a connection, archive and exact chat range with a guided setup.', 'Setup can create and attach a lorebook. It previews the range before you start a model request.', 'no', 'Try one short scene first, then review its summary.', 'archive'),
    rangePreview: info('Preview range', 'Check the first and last message numbers and how much text is in that inclusive range.', 'Displays a preview. It does not summarize, hide messages or change your books.', 'no', '12 to 25 includes both message 12 and message 25.', 'archive'),
    rangeArchive: info('Summarize this range', 'Send exactly the selected messages to your archive model.', 'Prepares dated archive entries using your review settings. The hide option applies only after a successful summary.', 'yes', '12 to 25 creates a summary from those messages, leaving 26 onward for later.', 'archive'),
    rangeHide: info('Hide this range', 'Hide the selected messages from the conversation context used for later replies.', 'Changes message visibility, not summary text. Showing them again restores visibility.', 'no', 'Hide 12 to 25 after checking that their summary is complete.', 'archive'),
    rangeShow: info('Show this range', 'Make the selected messages visible to the conversation again.', 'Changes message visibility. It does not remove summaries or their archived markers.', 'no', 'Show 12 to 25 when you want the original scene in context again.', 'archive'),
    ledgerForget: info('Mark unprocessed', 'Remove this ledger row from the list of already archived ranges.', 'Summaries and message visibility stay as they are. Other overlapping ledger rows still count as archived.', 'no', 'Forget the 12 to 25 marker, then deliberately summarize that range again.', 'archive'),
    ledgerRedo: info('Redo summaries', 'Find the archive entries linked to this ledger row and preview their complete original source ranges.', 'Generates reviewed replacements with the same record identities. Old text stays in revisions; dependent memories may need repair.', 'yes', 'Redo a weak summary instead of adding a second copy beside it.', 'archive'),
    tidy: info('Tidy layout', 'Sort managed archive records and group memory sentences by full date and story unit.', 'Keeps sentence wording. Exact duplicates are removed only if you select that option. Changes are reviewed or confirmed.', 'no', 'Put repeated Day 2 memory groups together without asking a model to rewrite them.', 'archive'),
    inspect: info('Inspect / edit', 'Open this record with its full text, dates, sources, revisions and protection settings.', 'Opening changes nothing. Saving a correction updates that record and can mark dependent records as needing review.', 'no', 'Correct a mistaken date and add a note explaining why.', 'library'),
    sources: info('Sources', 'See which original messages or archive records support this entry.', 'Opens evidence details. It does not regenerate or rewrite anything.', 'no', 'Check which scene supports a character knowing a secret.', 'library'),
    evidence: info('Open cited record', 'Open the original record referenced by this answer or finding.', 'Displays its details so you can check the claim against the source.', 'no', '', 'search'),
    regenerate: info('Rebuild and review', 'Generate a replacement from this record’s recorded sources.', 'Keeps its identity and revisions. Original chat units must be rebuilt in their source chat; invalid source records need correction first.', 'yes', 'Rebuild a recap after correcting one of its source summaries.', 'library'),
    loadDetail: info('Load detail next reply', 'Queue this record’s detailed original sources for the next normal reply.', 'Uses the existing injection budget. It does not rewrite the record or permanently change its activation settings.', 'no', 'Temporarily use the detailed scene behind a short recap.', 'library'),
    selectVisible: info('Select results', 'Select all records matching the current Library search and filters.', 'Updates your selection for condensation, exports and other selected-record tools. No text is changed.', 'no', 'Filter to Day 1 through Day 5, then select those results.', 'library'),
    clearSelection: info('Clear selection', 'Uncheck the records currently selected in Library.', 'Clears only the selection. Your records and filters are kept.', 'no', '', 'library'),
    refresh: info('Refresh Library', 'Read this story’s managed books again and recheck recorded evidence.', 'Updates the view. Source or external text changes can be recorded as needing review; no model request is made.', 'no', 'Refresh after editing a lorebook in SillyTavern.', 'library'),
    quickFilter: info('Quick Library filter', 'Show a useful subset, such as character memories, this chat’s sources or records needing review.', 'Changes the view and filters, not the records themselves.', 'no', 'Choose Needs review to find entries affected by edited sources.', 'library'),
    clip: info('Quick capture', 'Save a passage or note with optional dates, people and original-message links.', 'Opens a form. The text is written only after you approve Save capture.', 'no', 'Keep an exact promise that should not be lost inside a long summary.', 'library'),
    memoriesNext: info('Create next batch', 'Read the next unprocessed archived story units and work out each character’s memories.', 'Prepares character memory updates using your review settings and records which source units were processed.', 'yes', 'Turn the next four archived Days into dated character memories.', 'characters'),
    memoriesAll: info('Create remaining memories', 'Process all eligible unprocessed archive units in batches, then organize the resulting character lists.', 'May make several model requests. Uses your configured review behavior and preserves source evidence.', 'yes', 'Catch up character memories after archiving several scenes.', 'characters'),
    memoryAudit: info('Review & organize memories', 'Review existing character lists, merge repeated meaning and optionally supply original chat evidence or a correction.', 'Prepares replacements for review. With extra evidence, lists may grow to recover omitted details; original versions are retained.', 'yes', 'Add messages 30 to 40 to recover a detail the earlier summary missed.', 'characters'),
    coverageRepair: info('Recheck memory coverage', 'Compare saved processing receipts with the current archive sources.', 'Reports missing, changed and unprocessed units. It does not ask a model to make new memories.', 'no', 'Check what still needs processing after correcting a Day entry.', 'characters'),
    characterUpdate: info('AI update', 'Propose a complete replacement for this character’s memory list, using its linked records and optional selected chat messages.', 'You review the replacement. Earlier text remains in revisions, and additional evidence and author corrections are recorded separately.', 'yes', 'Add the last 20 messages and ask it to check what Rowan actually learned.', 'characters'),
    clearCharacter: info('Clear this character’s memories', 'Preview and confirm clearing this character’s managed memory lists.', 'Keeps old text in revisions and Undo, disables emptied records and resets affected processing receipts. Source summaries stay available.', 'no', 'Clear a mistaken list before deliberately re-extracting from corrected source units.', 'characters'),
    clearAllMemories: info('Clear all character memories', 'Preview and confirm clearing every managed character memory list in this story.', 'Keeps revisions and Undo. Empty lists are disabled; source summaries and original chat messages stay available.', 'no', 'Use when intentionally rebuilding this story’s character memories from scratch.', 'characters'),
    forceMemories: info('Re-extract all source units', 'Read all current archived source units again, including those already marked as processed.', 'Prepares reviewed additions and merges them with the lists you keep. It does not automatically clear existing memories.', 'yes', 'Run after improving the memory prompt, or after clearing lists intentionally.', 'characters'),
    extract: info('Extract from selected', 'Read the source records selected in Library and identify facts, knowledge states and unfinished promises.', 'Creates proposed structured records for review. A shared scene alone does not prove every character knows its secrets.', 'yes', 'Record that Sable is unaware of the contents of a sealed envelope.', 'characters'),
    newKnowledge: info('Add knowledge', 'Manually record what a character knows, suspects, hides or does not know.', 'Opens a capture form. Saving writes your text and its supplied evidence; no AI is needed.', 'no', 'Record that Rowan learned a fact on Day 3, although the event happened on Day 1.', 'characters'),
    newFact: info('Add fact', 'Manually save a story fact with optional date, location and source messages.', 'Writes only after you approve the capture form.', 'no', 'The station closes at midnight.', 'characters'),
    newThread: info('Add promise or thread', 'Manually keep an unresolved promise, question or deadline.', 'Writes only after you approve the capture form.', 'no', 'Rowan promised to return the key by Friday.', 'characters'),
    diary: info('Write diary', 'Write a fictional diary using the chosen character’s recorded knowledge by the selected story date.', 'Creates a reviewed diary entry. Diaries are creative writing and are excluded from memory injection by default.', 'yes', 'Write Rowan’s evening entry without revealing information Rowan has not learned.', 'characters'),
    knowledgeAt: info('Show dated knowledge', 'Look up the character’s recorded learning dates and explicitly preserved historical knowledge states.', 'Displays dated evidence and separates records with unknown learning dates. It does not infer learning from an event date.', 'no', 'Check what Sable knew before a later revelation.', 'characters'),
    rosterApply: info('Preview identity changes', 'Treat the supplied canonical name and confirmed aliases as the same character.', 'Previews merging matching lists and preserves original record identities. Adds keywords only if you tick that option.', 'no', 'Combine Rowan and Rowan Vale after confirming they are one person.', 'characters'),
    condenseSelected: info('Condense selected records', 'Use the Library selection to create a linked recap, or shorten individual entries in the chosen mode.', 'Prepares reviewed results while preserving required chronology and protected sources. A pre-check can skip records that cannot shrink.', 'yes', 'Select several Days and create an Arc recap linked to their originals.', 'condense'),
    condenseSuggested: info('Review suggested sources', 'Select the records that match your current archive-condensation rules.', 'Opens them in Library for inspection. This button alone does not make a model request or condense them.', 'no', 'Review the proposed older Days before choosing Condense selected records.', 'condense'),
    ask: info('Ask the archive', 'Answer your question using relevant records from this story’s managed books.', 'Displays an answer and source buttons. It does not change the saved story records.', 'yes', 'Who last had the marked key?', 'search'),
    continuity: info('Check this claim', 'Compare the text in the question box with relevant recorded story evidence.', 'Shows supported, conflicting or uncertain findings. It does not automatically change canon.', 'yes', 'Check: Sable opened the envelope before the handover.', 'search'),
    continuityAll: info('Check recent continuity', 'Check the configured number of newest eligible records, 20 by default.', 'Retains findings across all batches of this run. Starting another check replaces the previous findings.', 'yes', 'Look for contradictions in the newest scenes before continuing.', 'search'),
    continuityFull: info('Check whole archive', 'Check all eligible records in this story rather than just the recent subset.', 'May require more model requests. Findings stay separate from Ask answers and never edit records automatically.', 'yes', 'Use for a deliberate larger review after correcting story history.', 'search'),
    jobResume: info('Resume / review', 'Continue this unfinished job or reopen the output it has already prepared.', 'Reuses usable prepared results. Further model requests are made only when unfinished processing needs them; the request allowance starts again.', 'maybe', 'Review a paused result without generating the same draft again.'),
    jobPause: info('Pause after this request', 'Ask the running job to stop before its next processing step.', 'The in-flight request can finish. Prepared usable results and saved records remain available for Resume / review.', 'no'),
    jobCancel: info('Discard unfinished job', 'End this job so you can start another one.', 'Its unapproved drafts become unavailable. Records already written to lorebooks are kept. Use Resume / review if you want those drafts.', 'no'),
    protectSelected: info('Update selected protections', 'Apply or clear the chosen protection on the selected Library records.', 'Shows a confirmation before saving. Keep detailed, exact wording and author locks restrict later automatic changes.', 'no', 'Lock an exact contract clause before condensing nearby records.', 'library'),
    repairSelected: info('Repair selected records and dependents', 'Preview an ordered repair plan for the selected corrected sources and affected derived records.', 'Each generated replacement is reviewed and saved before later dependents use it. Protected or circular dependencies need attention first.', 'yes', 'Correct Day 2, then rebuild the recap and memories derived from it.', 'library'),
    repairStale: info('Preview repairs', 'Find this story’s records marked as needing review and explain their repair order.', 'Previewing is local. Starting the proposed repair job uses AI and reviewed replacements; nothing is silently accepted.', 'maybe', 'Use after correcting the source of several stale memories.', 'archive'),
    exportMarkdown: info('Export selected as Markdown', 'Download readable text for the Library selection, optionally including linked sources.', 'Creates a download. It does not remove or alter the selected records.', 'no', '', 'library'),
    exportSelection: info('Export selected as JSON', 'Download the selected entries with their full metadata and optional linked sources.', 'Creates a download. Use Export complete story for a restorable whole-story backup.', 'no', '', 'library'),
    exportStory: info('Export complete story', 'Download this story’s archive, memories, sources, revisions, jobs and workflow settings.', 'Creates a restorable backup. API connection profiles stay on your device.', 'no', 'Save a backup before a large memory rebuild.', 'settings'),
    importStory: info('Import or restore story', 'Choose a complete Scene Archivist story backup and review its import preview.', 'Creates separate destination books. Imported drafts are retained as backup data and are not replayed against renamed books.', 'no', 'Restore an earlier backup without replacing your current story books.', 'settings'),
    exportWorkflow: info('Export workflow preset', 'Download reusable prompts and workflow settings without your story records.', 'Creates a settings download. Connection secrets and profiles are not included.', 'no', '', 'settings'),
    importWorkflow: info('Import workflow preset', 'Choose a workflow settings file and review it before applying.', 'Changes supported settings and prompts. It does not import story records.', 'no', '', 'settings'),
    importLog: info('Import a plain Scene Log', 'Choose an existing plain-text or Markdown archive to bring into this story.', 'Shows a preview before importing. Text without original source evidence cannot prove message ranges or character learning dates.', 'no', '', 'settings'),
    sharing: info('Archive sharing', 'Choose whether other chats can update this same archive and continue its unit numbering.', 'Asks for confirmation. Each chat keeps its own source evidence and progress. Keep one writer active at a time.', 'no', 'Several chats in the same story can use one shared archive.', 'settings'),
    sa_create: info('Create archive', 'Create a lorebook with the name you entered and select it as your archive.', 'Creates a book. Use Attach to chat or the guided setup to connect it to this conversation.', 'no', 'Give each separate story a clear archive name.', 'archive'),
    sa_run: info('Summarize new messages', 'Archive the chat messages that are not yet covered by this chat’s ledger.', 'Uses your model, archive prompt and review settings. Enabled follow-up memory or tracker automation can also run.', 'yes', 'Continue archiving after your last processed scene.', 'archive'),
    sa_thorough: info('Full archive pass', 'Run the archive workflow, then its character-memory and tracker follow-ups.', 'Can make multiple model requests. Uses the configured review behavior and keeps source evidence and processing progress.', 'yes', 'Catch up the summaries and character memories in one workflow.', 'archive'),
    sa_paste: info('Paste an archive reply', 'Import an archivist response you already generated or wrote elsewhere.', 'Parses the text into proposed archive changes using your review settings. Pasted text does not establish original chat evidence by itself.', 'no', '', 'archive'),
    sa_check: info('Check setup', 'Check the selected book, chat attachment and delivery configuration.', 'Displays setup findings. This check does not ask a model for a summary.', 'no', '', 'archive'),
    sa_attach: info('Attach to chat', 'Link the selected archive lorebook to the open chat.', 'Updates this chat’s lorebook attachment. It does not summarize messages or rewrite entries.', 'no', '', 'archive'),
    sa_fix: info('Fix delivery', 'Apply your configured delivery settings to this extension’s managed records.', 'Updates entry delivery settings so eligible records can reach the model. It does not rewrite their story text.', 'no', '', 'archive'),
    sa_undo: info('Undo', 'Preview the last job’s recorded changes and check which can safely be reversed.', 'Reverts only approved safe changes. Later edits and retained dependencies can create conflicts; partial Undo leaves unresolved changes recorded.', 'no', 'Restore a cleared memory list while preserving later unrelated work.', 'archive'),
    sa_diag: info('Diagnostics', 'Copy a short configuration and job report for troubleshooting.', 'Copies diagnostics rather than changing records. Check the copied report before sharing it.', 'no', '', 'archive'),
    sa_through_set: info('Mark archived through', 'Mark messages from 0 through the entered message number as already archived.', 'Replaces this chat’s ledger coverage markers. It does not create a summary or change message visibility.', 'no', 'Use only when that material has already been archived elsewhere.', 'archive'),
    sa_ledger_import: info('Import ledger list', 'Paste a range list to rebuild the chat’s archived coverage markers.', 'Changes coverage metadata, not summary text. Struck-through ranges count as archived.', 'no', 'An imported ~~0-8~~ marks that range as already processed.', 'archive'),
    sa_mem_all: info('Create remaining memories', 'Process eligible archive units that do not have a matching saved memory receipt.', 'Uses model requests and your review settings to prepare character memories.', 'yes', '', 'characters'),
    sa_mem_run: info('Create next batch', 'Read the next batch of eligible archived story units for character memories.', 'Uses model requests and your review settings.', 'yes', '', 'characters'),
    sa_mem_prompt_reset: info('Reset memory prompt', 'Restore the built-in character-memory extraction prompt.', 'Replaces the editable prompt setting. Saved memories are kept; future jobs use the restored prompt.', 'no', '', 'characters'),
    sa_cond_run: info('Condense long memory lists', 'Merge repeated meaning in character lists above your configured size threshold.', 'Prepares shorter reviewed lists while preserving dates. This is for character memories, not Day-to-Arc archive recaps.', 'yes', '', 'condense'),
    sa_cond_prompt_reset: info('Reset condense prompt', 'Restore the built-in prompt for condensing character memory lists.', 'Changes the prompt setting for future requests, not existing records.', 'no', '', 'condense'),
    sa_tr_run: info('Update this tracker', 'Ask the model to update the currently selected tracker from recent archive entries.', 'Writes the tracker result using the configured workflow. Trackers are separate always-on notes.', 'yes', 'Update a relationships or inventory tracker.', 'characters'),
    sa_tr_all: info('Update enabled trackers', 'Update every tracker you have enabled from recent archive entries.', 'Can make several model requests and saves tracker updates using the configured workflow.', 'yes', '', 'characters'),
    sa_tr_new: info('New tracker', 'Add a new editable tracker configuration.', 'Creates a disabled tracker setting. Enable and run it when its prompt is ready.', 'no', '', 'characters'),
    sa_tr_del: info('Delete tracker configuration', 'Remove the selected custom tracker from your settings.', 'Removes its configuration. Built-in tracker configurations cannot be deleted here.', 'no', '', 'characters'),
    sa_tr_reset: info('Reset tracker', 'Restore the selected built-in tracker’s original name and prompt.', 'Replaces that tracker configuration. It does not make a model request.', 'no', '', 'characters'),
    sa_recap: info('Previously on', 'Generate a short return recap from the newest archive entries.', 'Displays a recap for reading. It does not replace those saved source entries.', 'yes', '', 'search'),
    sa_recall_test: info('Test AI Recall', 'Ask your helper model which keyed archive entries fit the recent chat.', 'Shows the model’s selection. Native keyword matching and native vectors remain independent.', 'yes', '', 'search'),
    sa_side_test: info('Test connection', 'Send a small test request using the selected helper connection profile or current model.', 'Checks that the model responds; it does not create story records.', 'yes', '', 'settings'),
    sa_pl_new: info('New archive prompt', 'Create a new editable archive prompt in your local prompt library.', 'Changes your prompt settings, not existing story text.', 'no', '', 'settings'),
    sa_pl_dup: info('Duplicate prompt', 'Make an editable copy of the selected archive prompt.', 'Keeps the original prompt and creates another local preset.', 'no', '', 'settings'),
    sa_pl_del: info('Delete prompt', 'Remove the selected custom prompt from the local prompt library.', 'Changes available prompt presets. Built-in presets are retained.', 'no', '', 'settings'),
    sa_pl_reset: info('Reset prompt', 'Restore the selected built-in archive prompt to its original contents.', 'Replaces that prompt setting; existing archive entries are kept.', 'no', '', 'settings'),
    sa_pl_export: info('Export prompt', 'Download the selected archive prompt for reuse or sharing.', 'Creates a prompt download, not a story backup.', 'no', '', 'settings'),
    sa_pl_import: info('Import prompt', 'Choose an exported archive prompt to add to your local prompt library.', 'Imports prompt settings, not story records.', 'no', '', 'settings'),
    sa_log_md: info('Export archive as Markdown', 'Download the selected archive’s readable log text.', 'Creates a download. Use Export complete story to preserve all books and recovery metadata.', 'no', '', 'settings'),
};

export const FIELD_HELP = {
    sa_lorebook: 'Choose the lorebook holding this story’s archive. Selecting a different story can change which managed books and records are shown.',
    sa_newname: 'Enter a distinct name for a new archive, then choose Create. No model request is made.',
    rangeFrom: 'The first original chat message to include. Message numbers are zero-based; 0 is the first message.',
    rangeTo: 'The last original chat message to include, inclusive. Use Preview range to check the selection.',
    rangeHide: 'After a successful summary, hide exactly this selected range from future chat context. The summary remains in the lorebook.',
    question: 'Enter a question for Ask the archive, or a statement for Check this claim. Both use saved story evidence.',
    memorySubject: 'Choose the character whose memory lists you want to browse or update.',
    memorySearch: 'Search the text of the selected character’s memory lists. It does not ask a model or change the lists.',
    branchMode: 'Choose what inherited history a copied chat receives before new writes: inherited books, empty books, or only verified earlier history. Parent books are kept.',
    continuityRecent: 'How many newest eligible records Check recent continuity reads. Check whole archive ignores this subset limit.',
    requestBudget: 'Maximum estimated input tokens for one helper request. Smaller selections can fit without increasing this limit.',
    requestLimit: 'Pause a job before its next model request after this many calls per Resume. 0 allows no fixed request-count limit.',
    budget: 'Memory tokens the extension may retain from entries already selected by native World Info or explicit recall. It does not make unrelated entries eligible.',
    reviewMode: 'Together at the end retains prepared output for one combined approval. After each step reviews and saves each step separately.',
    jobPreview: 'Show the scope and estimated processing batches before starting a manual job. Previewing alone does not call a model.',
    autoCondense: 'Manual only makes no automatic recaps. Suggest proposes sources. Automatic mode can make model requests when the chosen trigger is reached.',
    sa_mem_target: 'Choose where character memory entries are saved. Character-book mode uses each matched character’s lorebook when available.',
    sa_mem_from: 'Optional first archived story unit to process again. Leave both unit fields empty to use saved processing receipts.',
    sa_mem_to: 'Optional last archived story unit, inclusive. This is a unit number such as Day 5, not a chat message number.',
    sa_mem_auto: 'When enabled, character memory extraction can run after archive writes and use extra model requests.',
    sa_hide: 'When enabled, successfully archived chat messages can be hidden according to Keep visible. Hiding and ledger coverage are separate.',
    sa_recall: 'Enable a helper-model selection before normal replies. This can add model calls; native keywords and native vectors keep their own behavior.',
    sa_side_profile: 'Choose an existing SillyTavern Connection Manager profile for helper requests, or use the current model. Credentials stay in SillyTavern.',
    sa_delivery: 'Choose where eligible archive records are inserted into context. Outlet delivery requires the matching outlet macro in your preset.',
    sa_chunk: 'Estimated transcript tokens per archive pass. Smaller passes use more requests and may fit your model’s context more easily.',
    sa_keepvis: 'How many newest chat messages should stay visible when automatic archive hiding is enabled.',
    sa_unit: 'The singular story unit used in headings, such as Day, Episode or Chapter. It is separate from chat message numbering.',
};

const reviewedSelection = info('Approve result', 'Tick the proposed records you want to save in this review.', 'Unchecked proposals are retained for later review. Dependent results still need approved, valid source evidence.', 'no');

export function helpKey(control) {
    if (control.dataset?.saAction) return control.dataset.saAction;
    if (control.id && ACTION_HELP[control.id]) return control.id;
    if (control.dataset?.reviewInclude != null) return 'reviewInclude';
    const label = (control.value || control.textContent || '').trim();
    if (label === 'Select all') return 'reviewSelectAll';
    if (label === 'Deselect all') return 'reviewDeselectAll';
    return '';
}

export function helpFor(control) {
    const key = helpKey(control);
    if (ACTION_HELP[key]) return ACTION_HELP[key];
    if (key === 'reviewInclude') return reviewedSelection;
    if (key === 'reviewSelectAll') return info('Select all review results', 'Tick every proposed result in this review.', 'Selects proposals only. Saving still checks changed, missing and unchecked source dependencies.', 'no');
    if (key === 'reviewDeselectAll') return info('Deselect all review results', 'Untick every proposed result in this review.', 'Keeps the proposals available so you can choose a smaller set. It does not discard the job.', 'no');
    const field = control.id || control.dataset?.saField || control.dataset?.saOption;
    if (FIELD_HELP[field]) return info(control.getAttribute('aria-label') || control.closest('label')?.querySelector('span')?.textContent || 'About this setting', FIELD_HELP[field], '', 'no');
    return null;
}

export const aiLabel = value => value === 'yes' ? 'Uses AI requests' : value === 'maybe' ? 'May use AI requests' : 'No AI request';
export const helpHtml = data => `<div class="sa-help-badges"><span class="sa-badge ${data.ai === 'no' ? '' : 'sa-ai-badge'}">${aiLabel(data.ai)}</span></div><p>${escape(data.description)}</p>${data.changes ? `<p><b>What changes:</b> ${escape(data.changes)}</p>` : ''}${data.example ? `<p class="sa-help-example"><b>For example:</b> ${escape(data.example)}</p>` : ''}`;

/** A tooltip never invokes its target action. Touch help opens a separate dialog. */
export class ControlHelp {
    constructor(w) {
        this.w = w; this.roots = new WeakSet(); this.tooltip = null; this.anchor = null; this.timer = null;
        this.explain = false; this.pendingRoots = new Set(); this.enhanceFrame = null;
        this.touch = matchMedia('(hover: none), (pointer: coarse)');
        this.touch.addEventListener?.('change', () => this.setExplain(this.explain));
        this.listen = (name, fn, capture = false) => document.addEventListener(name, fn, capture);
        this.listen('pointerover', e => { if (e.pointerType === 'touch') return; const target = this.control(e.target); if (target && !target.contains(e.relatedTarget)) this.schedule(target); });
        this.listen('pointerout', e => { if (this.anchor?.contains(e.target) && !this.anchor.contains(e.relatedTarget)) this.hide(); });
        this.listen('focusin', e => { const target = this.control(e.target); if (target) this.schedule(target, 120); });
        this.listen('focusout', e => { if (this.anchor?.contains(e.target)) this.hide(); });
        this.listen('pointerdown', () => this.hide(), true);
        this.listen('keydown', e => { if (e.key !== 'Escape') return; if (this.tooltip || this.timer) { this.escapeDialog = this.anchor?.closest('dialog'); this.escapeAt = performance.now(); this.hide(); e.preventDefault(); e.stopImmediatePropagation(); } else this.escapeDialog = null; }, true);
        // ST's native cancel listener completes the popup even when another
        // handler prevented the key event. Stop that separate cancel event.
        this.listen('cancel', e => { if (this.escapeDialog === e.target && performance.now() - this.escapeAt < 500) { e.preventDefault(); e.stopImmediatePropagation(); this.escapeDialog = null; } }, true);
        this.listen('scroll', () => { const focused = this.anchor === document.activeElement ? this.anchor : null; this.hide(); if (focused) this.schedule(focused, 180); }, true);
        this.listen('toggle', e => { if (e.target instanceof Element && e.target.open && e.target.closest('.sa-help-scope')) this.refresh(e.target); }, true);
        this.listen('click', e => {
            const button = e.target.closest?.('[data-sa-help-for]'); if (!button) return;
            e.preventDefault(); e.stopPropagation(); this.hide();
            const target = button.parentElement.querySelector('[data-sa-help-ready]'), data = target && helpFor(target);
            if (data) { const root = document.createElement('div'); root.className = 'sa-review sa-help-detail'; root.innerHTML = `<h3>${escape(data.title)}</h3>${helpHtml(data)}`; void Promise.resolve(this.w.h.show(root, {large:false})).catch(error => this.w.h.notify(error.message, 'error')); }
        }, true);
    }
    observe(root) {
        if (!(root instanceof Element) || this.roots.has(root)) return;
        this.roots.add(root); root.classList.add('sa-help-scope'); root.classList.toggle('sa-explain-on', this.explain);
        this.refresh(root);
    }
    control(target) {
        const control = target.closest?.('button.menu_button,input.menu_button,[data-review-include],input.text_pole,select.text_pole,[data-sa-option],[data-sa-field]');
        if (!control || !control.closest('.sa-help-scope') || control.closest('.sa-help-hub') || !helpFor(control)) return null;
        return this.prepare(control);
    }
    prepare(control) {
        if (control.hasAttribute('data-sa-help-ready')) return control;
        const data = helpFor(control); if (!data) return control;
        control.dataset.saHelpReady = 'true';
        if (control.title) { control.dataset.saOriginalTitle = control.title; control.removeAttribute('title'); }
        control.setAttribute('aria-description', `${data.description} ${data.changes}`.trim());
        return control;
    }
    refresh(root = this.w.root) {
        if (!(root instanceof Element) || !(this.explain || this.touch.matches)) return;
        this.pendingRoots.add(root);
        if (this.enhanceFrame != null) return;
        this.enhanceFrame = requestAnimationFrame(() => {
            this.enhanceFrame = null;
            const roots = [...this.pendingRoots]; this.pendingRoots.clear();
            if (!(this.explain || this.touch.matches)) return;
            for (const scope of roots) if (scope.isConnected) this.decorate(scope);
        });
    }
    decorate(root) {
        if (!(this.explain || this.touch.matches)) return;
        // Read visibility in one pass before making DOM changes. Interleaving
        // a geometry read with each wrapper forces repeated browser layouts.
        const controls = [...root.querySelectorAll('button.menu_button,input.menu_button')].filter(control => !control.closest('.sa-help-control,.sa-help-hub') && helpFor(control) && control.getClientRects().length);
        for (const control of controls) {
            const data = helpFor(this.prepare(control));
            const wrapper = document.createElement('span'); wrapper.className = 'sa-help-control';
            control.before(wrapper); wrapper.append(control);
            const help = document.createElement('button'); help.type = 'button'; help.className = 'sa-context-help'; help.textContent = '?';
            help.dataset.saHelpFor = helpKey(control); help.setAttribute('aria-label', `Help: ${data.title}`); help.setAttribute('aria-haspopup', 'dialog');
            wrapper.append(help);
        }
    }
    setExplain(value) {
        this.explain = !!value;
        for (const root of document.querySelectorAll('.sa-help-scope')) {
            root.classList.toggle('sa-explain-on', this.explain);
            if (this.explain || this.touch.matches) this.refresh(root);
            else for (const wrapper of root.querySelectorAll('.sa-help-control')) {
                const control = wrapper.querySelector('button.menu_button,input.menu_button'); if (control) wrapper.replaceWith(control);
            }
        }
    }
    schedule(anchor, delay = 420) {
        if (!helpFor(anchor) || anchor.closest('[hidden]') || !anchor.getClientRects().length) return;
        this.hide(); this.anchor = anchor; this.timer = setTimeout(() => { this.timer = null; this.show(anchor); }, delay);
    }
    show(anchor) {
        if (!anchor.isConnected || !anchor.getClientRects().length) return;
        const data = helpFor(anchor); if (!data) return;
        const tip = document.createElement('div'); tip.className = 'sa-control-tooltip'; tip.id = 'sa-control-tooltip'; tip.setAttribute('role', 'tooltip');
        tip.innerHTML = `<b>${escape(data.title)}</b>${helpHtml(data)}`;
        (anchor.closest('dialog') || document.body).append(tip); this.tooltip = tip; this.anchor = anchor;
        const ids = (anchor.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean); ids.push(tip.id); anchor.setAttribute('aria-describedby', [...new Set(ids)].join(' '));
        const a = anchor.getBoundingClientRect(), b = tip.getBoundingClientRect(), gap = 10;
        const left = Math.max(gap, Math.min(innerWidth - b.width - gap, a.left));
        const top = a.bottom + b.height + gap < innerHeight ? a.bottom + gap : Math.max(gap, a.top - b.height - gap);
        tip.style.left = `${left}px`; tip.style.top = `${top}px`;
    }
    hide() {
        clearTimeout(this.timer); this.timer = null;
        if (this.anchor) {
            const ids = (this.anchor.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== 'sa-control-tooltip');
            if (ids.length) this.anchor.setAttribute('aria-describedby', ids.join(' ')); else this.anchor.removeAttribute('aria-describedby');
        }
        this.tooltip?.remove(); this.tooltip = null; this.anchor = null;
    }
}
