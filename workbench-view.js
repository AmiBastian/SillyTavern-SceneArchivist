import * as M from './memory-engine.js';
import { escape as html } from './workflow-tools.js';
import { mountTools } from './workbench-tools.js';
import { mountRecovery } from './workbench-recovery.js';
import { WorkspaceLayout } from './workbench-layout.js';
import { StoryLibrary } from './story-library.js';
import { WorkbenchExtras } from './workbench-extras.js';
import { entryReasons, vectorStatus } from './vector-diagnostics.js';

export const button = (action, label, extra = '') => `<button type="button" class="menu_button" data-sa-action="${action}" ${extra}>${label}</button>`;
export const field = (key, label, value = '', type = 'text', extra = '') => `<label class="sa-field"><span>${label}</span><input class="text_pole" data-sa-field="${key}" type="${type}" value="${html(value)}" ${extra}></label>`;
const card = (title, body, open = true) => `<details class="sa-card" ${open ? 'open' : ''}><summary>${title}</summary><div class="sa-body">${body}</div></details>`;

export function renderMemoryBudget(w) {
    const container = w.root?.querySelector('#sa-budget-view');
    if (!container) return;
    const decision = w.lastBudget;
    const status = vectorStatus(w.vectorRun, {
        enabled: !!w.h.vectorSettings?.()?.enabled_world_info,
        available: typeof globalThis.vectors_rearrangeChat === 'function',
        selected: decision ? decision.accepted.filter(item => w.semanticHits.has(item.id)).length : null,
    });
    const heading = `<p class="sa-vector-status" role="status"><b>Vector search</b> · ${html(status)}</p>`;
    if (!decision) {
        container.innerHTML = heading + '<p>Send a normal chat reply to see which memories were selected.</p>';
        return;
    }
    const { accepted, omitted, used, budget } = decision;
    const filter = w.value('activationFilter');
    const visible = accepted.filter(item => !filter || (item.reasons || [item.reason]).includes(filter));
    const selected = new Set(accepted.map(item => item.id));
    const extra = [...w.activatedIds].filter(id => !selected.has(id)).length;
    const confirmed = accepted.filter(item => w.activatedIds.has(item.id)).length;
    const confirmation = w.activationKnown
        ? `<p>World Info activation confirmed for ${confirmed}/${accepted.length} selected memories.${extra ? ` SillyTavern also activated ${extra} other story entries.` : ''}</p>`
        : '<p>Waiting for World Info to confirm these selections.</p>';
    const mode = decision.enforced === false
        ? '<p class="sa-warnline">This SillyTavern version exposes activation reporting only. Native World Info limits apply.</p>'
        : '<p>The shared budget covers native World Info matches, scene recall and Little Things.</p>';
    const little = w.sceneRecall.selection();
    const rows = visible.map(item => `<div class="sa-retrieval-entry">
        <div class="sa-viewrow"><b>${html(M.title(item.entry))}</b> · ${item.cost} tokens<br>${html(entryReasons(item))}
        ${w.activationKnown ? `<br><span>${w.activatedIds.has(item.id) ? 'World Info activation confirmed' : 'Not activated by World Info'}</span>` : ''}</div>
        <div class="sa-row">${button('inspect', 'Inspect', `data-id="${html(item.id)}"`)}</div>
    </div>`).join('');
    const skipped = omitted.map(item => `<div class="sa-retrieval-entry">${html(item.title)} · ${item.tokens} tokens · ${html(item.reason)}
        ${item.reasons?.length ? `<br>Activation source · ${html(entryReasons(item))}` : ''}</div>`).join('');
    container.innerHTML = heading
        + `<p><b>${used}/${budget}</b> memory tokens retained.${little.items.length ? ` Little Things used ${little.tokens} tokens.` : ''}</p>`
        + mode + confirmation
        + `<p class="sa-hint">Showing ${visible.length} of ${accepted.length} retained entries.</p>${rows}
        <details><summary>${omitted.length} omitted records and reasons</summary>${skipped}</details>`;
    w.layout?.help.refresh(container);
}

export function mountWorkbench(w, root) {
    w.root = root;
    const oldCards = [...root.querySelectorAll(':scope > details.sa-card')];
    const hero = root.querySelector(':scope > .sa-hero');
    const nav = document.createElement('div'); nav.className = 'sa-tabs'; nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', 'Scene Archivist sections');
    const tabs = ['story', 'archive', 'characters', 'library', 'maintain', 'prompt', 'settings'];
    w.panes = {};
    tabs.forEach((id, index) => {
        const b = document.createElement('button'); b.type = 'button'; b.id = `sa-tab-${id}`; b.textContent = id; b.dataset.saTab = id;
        b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', `sa-pane-${id}`); b.tabIndex = index === 0 ? 0 : -1; nav.append(b);
        const panel = document.createElement('section'); panel.id = `sa-pane-${id}`; panel.className = 'sa-pane'; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', b.id);
        w.panes[id] = panel; root.append(panel);
    });
    root.querySelector('.sa-title').after(nav);
    const dashboard = document.createElement('div'); dashboard.id = 'sa-dashboard'; dashboard.className = 'sa-dashboard'; nav.after(dashboard);
    const jobs = document.createElement('div'); jobs.id = 'sa-jobs'; jobs.setAttribute('aria-live', 'polite'); dashboard.after(jobs);
    const heroCard = document.createElement('details'); heroCard.className = 'sa-card'; heroCard.open = true; heroCard.innerHTML = '<summary>🗂️ Your archive</summary><div class="sa-body"></div>'; heroCard.querySelector('.sa-body').append(hero); w.panes.archive.append(heroCard);
    for (const c of oldCards) {
        const text = c.querySelector('summary').textContent;
        const tab = /Ledger/.test(text) ? 'archive' : /Memory settings|Memories|Trackers/.test(text) ? 'characters' : /Recall|model saw/.test(text) ? 'prompt' : /Ask|Previously on/.test(text) ? 'library' : 'settings';
        c.open = false; w.panes[tab].append(c);
    }
    root.querySelector('#sa_range_from')?.closest('.sa-row')?.remove();
    root.querySelector('#sa_run').value = '✨ Summarize new, a quickie';
    root.querySelector('#sa_thorough').value = '💋 Archive thoroughly';
    w.panes.archive.insertAdjacentHTML('beforeend', card('🎯 Pick your messages', `<p class="sa-hint">Both numbers are inclusive. 311 to 372 summarizes exactly that range and leaves 373 and 374 alone. Visibility has its own controls.</p><div class="sa-grid">${field('rangeFrom', 'First message', '', 'number', 'min="0"')}${field('rangeTo', 'Last message, inclusive', '', 'number', 'min="0"')}</div><p id="sa-range-preview" class="sa-hint"></p><label class="checkbox_label"><input type="checkbox" data-sa-field="rangeHide"><span>Hide this range after a successful summary</span></label><label class="checkbox_label"><input type="checkbox" data-sa-field="rangeMemories"><span>Also create memories</span></label><div class="sa-row">${button('rangePreview', 'Preview range')}${button('rangeArchive', 'Summarize this range') + button('rangeCatchUp', 'Catch up this range')}${button('rangeHide', 'Hide this range')}${button('rangeShow', 'Show this range')}</div><p class="sa-hint">“Summarize new” uses uncovered messages. “Mark archived” only marks coverage and does not write a summary.</p>`));
    w.panes.archive.insertAdjacentHTML('beforeend', card('🧹 Tidy the shelves', `<p class="sa-hint">Sort the archive and group memories by date. Every memory sentence keeps its wording. No AI request is made.</p><label class="checkbox_label"><input type="checkbox" data-sa-field="tidyDuplicates"><span>Also remove exact duplicate memories within the same date group</span></label><div class="sa-row">${button('tidy', 'Tidy up, hands off the prose')}</div>`, false));
    { const ledger = [...w.panes.archive.children].find(x => /Ledger/.test(x.querySelector?.('summary')?.textContent || '')); if (ledger) w.panes.archive.append(ledger); }
    w.panes.library.insertAdjacentHTML('beforeend', card('🔬 Memory inspector', `<div class="sa-row"><input id="sa-library-query" class="text_pole" placeholder="Search dates, names, locations or text" aria-label="Search memory library"><select id="sa-library-type" class="text_pole" aria-label="Record type"><option value="">All types</option>${M.TYPES.map(t => `<option>${t}</option>`).join('')}</select><label class="checkbox_label"><input id="sa-library-history" type="checkbox"><span>History</span></label></div><div class="sa-row">${button('selectVisible', 'Select results')}${button('clearSelection', 'Clear selection')}${button('refresh', 'Refresh')}${button('clip', 'Quick capture')}</div><p class="sa-hint">Select records here to condense them, extract structured facts, or inspect their sources. Originals and every revision remain available.</p><div id="sa-library-results"></div>`));
    w.panes.maintain.insertAdjacentHTML('afterbegin', card('✂️ Condense story records', `
        <label class="checkbox_label"><input type="checkbox" data-sa-option="auditCondense"><span>Audit shorter proposals for missing facts, one extra request</span></label>
        <p class="sa-hint">For the archive entries (Day, Episode or Chapter units), not for character memories. Select entries in Library. Shorten preserves each heading; Create recap links a smaller record to all its originals. Protected sources stay detailed.</p><div class="sa-grid"><label class="sa-field"><span>Mode</span><select class="text_pole" data-sa-option="recapMode"><option value="recap">Create recap</option><option value="shorten">Shorten individual entries</option></select></label>${field('recapLabel', 'Name or level, for example Arc or Volume', w.options().recapLabel)}</div><div class="sa-row">${button('condenseSelected', 'Condense selected, gently')}${button('condenseSuggested', 'Review suggested sources')}</div><div id="sa-condense-suggestion" class="sa-hint"></div>
        <details class="sa-inline-tools"><summary>🎯 Token target</summary>
            ${field('condenseTarget', 'Target tokens (0 = shortest faithful version)', 0, 'number', 'min="0"')}
        </details>
        <details class="sa-inline-tools"><summary>✍️ Archive condense prompt</summary>
            <label class="sa-field"><span>Writing instructions for shorter entries and recaps</span><textarea id="sa_archive_cond_prompt" class="text_pole" rows="5"></textarea></label>
            <p class="sa-hint">Use this to guide wording and emphasis. Scene Archivist still checks required headings, dates, times, and quotations.</p>
            <div class="sa-row"><input id="sa_archive_cond_prompt_reset" class="menu_button" type="button" value="Reset archive prompt"></div>
        </details>
        <details class="sa-inline-tools"><summary>🧠 Character memories</summary>
            <p class="sa-hint">Measure savings in tokens while keeping every distinct memory. Review and Undo remain available.</p>
            <div class="sa-row"><input id="sa_cond_run" class="menu_button sa-cond-run" type="button" value="✂️ Condense character memories"></div>
            <label class="sa-field"><span>Condense prompt</span><textarea id="sa_cond_prompt" class="text_pole" rows="6"></textarea></label>
            <div class="sa-row"><input id="sa_cond_prompt_reset" class="menu_button" type="button" value="Reset prompt"></div>
        </details>
        <details class="sa-inline-tools"><summary>⏰ Condense automatically</summary>
            <div class="sa-grid"><label class="sa-field"><span>Automation</span><select class="text_pole" data-sa-option="autoCondense"><option value="off">Manual only</option><option value="suggest">Suggest and review</option><option value="auto">Automatically create recaps</option></select></label><label class="sa-field"><span>Trigger</span><select class="text_pole" data-sa-option="trigger"><option value="units">After newer units</option><option value="time">After fictional calendar time</option><option value="pressure">Archive token pressure</option></select></label>${w.optionField('afterUnits', 'Newer units', 'number')}${w.optionField('afterDays', 'Fictional days passed', 'number')}${w.optionField('pressureTokens', 'Archive token threshold', 'number')}</div><p class="sa-hint">Time-based rules require a known full story date. Automatic mode is opt-in and still keeps original records and revisions. Locked, exact and keep-detailed records are excluded.</p>
        </details>`));
    w.panes.characters.insertAdjacentHTML('afterbegin', card('💭 Create character memories', `<div id="sa-memory-coverage" class="sa-hint"></div><div class="sa-grid"><label class="sa-field"><span>Read from</span><select class="text_pole" data-sa-flow="memorySource"><option value="chat">Chat</option><option value="archive">Archive</option><option value="both">Both</option></select></label><label class="sa-field"><span>Scope</span><select class="text_pole" data-sa-flow="scope"><option value="new">New material</option><option value="messages">Exact chat messages</option><option value="units">Unit range</option><option value="last">Last X units</option></select></label>${field('memoryStart', 'Start (inclusive)', '', 'number', 'min="0"')}${field('memoryEnd', 'End (inclusive)', '', 'number', 'min="0"')}${field('memoryLast', 'Number of units', 5, 'number', 'min="1"')}</div><div class="sa-row">${button('memoriesAll', 'Create memories')}${button('memoryAudit', 'Organize existing memories')}</div>`));
    w.panes.settings.insertAdjacentHTML('afterbegin', card('📖 Context for archive and memories', `<label class="checkbox_label"><input type="checkbox" data-sa-flow="persona"><span>Create memories for my persona</span></label><label class="checkbox_label"><input type="checkbox" data-sa-flow="readReferences"><span>Read selected lorebooks for archive and memories</span></label><div class="sa-row">${button('flowReferences', 'Choose reference lorebooks')}<span id="sa-reference-summary" class="sa-hint"></span></div><div class="sa-grid"><label class="sa-field"><span>Reference tokens, 0 for the whole selection</span><input class="text_pole" type="number" min="0" value="0" data-sa-flow="referenceBudget"></label><label class="sa-field"><span>Reference selection policy</span><select class="text_pole" data-sa-flow="referenceFit"><option value="all">All selected entries, explain overflow</option><option value="relevant">Relevant complete entries within allowance</option></select></label></div><label class="checkbox_label"><input type="checkbox" data-sa-flow="auditMemories"><span>Audit proposed memories against evidence, one extra request</span></label><p class="sa-hint">Audits provide advice for your review and use separate passes. Their extraction result is retained if the audit fails. No memories are rewritten automatically.</p><label class="checkbox_label"><input type="checkbox" data-sa-flow="includeChatContext"><span>Include SillyTavern chat context</span></label><p class="sa-hint">Reference lore supplies background. The selected scene supplies events and character knowledge. Chat context uses SillyTavern's prompt preview. Extensions that only run during live generation may contribute different material.</p>`, false));
    w.panes.settings.insertAdjacentHTML('beforeend', card('⏰ Optional automation', `<label class="checkbox_label"><input type="checkbox" data-sa-flow="singleRequest"><span>Combine stages into one request when they use the same model</span></label><label class="checkbox_label"><input type="checkbox" data-sa-flow="rolling"><span>Prepare rolling memories from chat</span></label><div class="sa-grid"><label class="sa-field"><span>New messages before a review</span><input class="text_pole" type="number" min="1" data-sa-flow="rollingEvery"></label><label class="sa-field"><span>Leave the latest messages out</span><input class="text_pole" type="number" min="0" data-sa-flow="rollingBuffer"></label></div><p class="sa-hint">Rolling memories use Chat or Both and keep a reviewable draft.</p>`, false));
    root.querySelector('.sa-main').insertAdjacentHTML('afterend', '<p id="sa-flow-preview" class="sa-hint"></p>');
    w.panes.characters.insertAdjacentHTML('beforeend', card('🧩 Facts, knowledge and unfinished business', `<p class="sa-hint">Select source entries in Library. Extract who knows, suspects, believes incorrectly, is unaware, or is hiding something, plus living facts and open promises.</p><div class="sa-row">${button('extract', 'Extract from selected')}${button('newKnowledge', 'Add knowledge')}${button('newFact', 'Add fact')}${button('newThread', 'Add promise or thread')}</div><div id="sa-state-list"></div>`, false));
    w.panes.characters.insertAdjacentHTML('beforeend', card('📖 Character diaries', `<p class="sa-hint">Write from original chat messages, the character card and attached background lore. Update adds new material to the latest saved diary for the character. Diaries stay separate from RP memory injection.</p><label class="sa-field"><span>Character</span><select class="text_pole" data-sa-field="diaryCharacter"></select></label><div class="sa-grid">${field('diaryName', 'Character name (optional override)')}${field('diaryDate', 'Story date (optional)')}${field('diaryFrom', 'First message (optional)', '', 'number', 'min="0"')}${field('diaryTo', 'Last message (optional)', '', 'number', 'min="0"')}</div><label class="sa-field"><span>Style note, optional</span><textarea class="text_pole" data-sa-field="diaryStyle" rows="3"></textarea></label><div class="sa-row">${button('diary', 'Write diary')}${button('diaryUpdate', 'Update diary')}${button('diaryCondense', 'Condense diary')}</div>`, false));
    w.panes.library.insertAdjacentHTML('beforeend', card('🔎 Search, evidence and continuity', `<p class="sa-hint">Ask searches this story’s saved records. If evidence is missing, it can make one follow-up pass using related wording and verified original messages in this chat. Evidence used shows what was supplied; source buttons open the saved record or jump to the original passage.</p><div class="sa-row"><input class="text_pole" data-sa-field="question" placeholder="Ask, or enter a claim to check" aria-label="Archive question or continuity claim">${button('ask', 'Ask the archive')}${button('continuity', 'Check this claim')}${button('continuityAll', 'Check recent continuity')}${button('continuityFull', 'Check whole archive')}</div><p class="sa-hint">Recent checks use the configured number of newest eligible records. Findings stay below until another check replaces them.</p><div id="sa-evidence-results" aria-live="polite"></div><div id="sa-continuity-results" aria-live="polite"></div>`));
    w.panes.prompt.insertAdjacentHTML('beforeend', card('💰 Memory budget and loading reasons', `<div class="sa-row"><label>Show activation source<select class="text_pole" data-sa-field="activationFilter"><option value="">All sources</option><option value="keyword">Keyword</option><option value="native vector">Vector</option><option value="always on">Always On</option><option value="recall">AI Recall</option><option value="sticky">Sticky</option></select></label></div><div id="sa-budget-view"></div>`, false));
    w.panes.settings.insertAdjacentHTML('afterbegin', card('🛠️ Story memory settings', `<div class="sa-grid">${w.optionField('budget', 'Total injected memory tokens', 'number')}${w.optionField('requestBudget', 'Helper input tokens (0 = use model context)', 'number')}${w.optionField('batchSize', 'Units per helper request (0 = fit context)', 'number')}${w.optionField('charactersPerBatch', 'Characters per audit request (0 = fit context)', 'number')}<label class="sa-field"><span>Review bulk results</span><select class="text_pole" data-sa-option="reviewMode"><option value="end">Together at the end</option><option value="step">After each step</option></select></label></div><p class="sa-hint">Together at the end runs the whole job before one combined review. Helpers fit the selected model’s context by default. Use a positive input or count limit to cap individual requests. Review later keeps prepared results.</p><label class="checkbox_label"><input type="checkbox" data-sa-option="continuityAuto"><span>Check continuity after new replies, findings only</span></label><label class="checkbox_label"><input type="checkbox" data-sa-option="recapOnReturn"><span>Offer a dated recap when returning to this story</span></label>${w.optionField('recapAfterHours', 'Hours before offering a return recap', 'number')}<div id="sa-telemetry" class="sa-hint"></div>`));
    w.panes.maintain.insertAdjacentHTML('beforeend', card('🔗 Archive sharing', `<p id="sa-sharing-state" class="sa-hint"></p><div class="sa-row">${button('sharing', 'Share this archive across chats')}</div>
        <details id="sa-shared-filing" class="sa-inline-tools" hidden><summary>📁 Where to file new summaries</summary>
            <div class="sa-grid"><label class="sa-field"><span>Where to file new summaries</span><select class="text_pole" data-sa-flow="sharedMode"><option value="new">Start a new unit</option><option value="continue">Continue an existing unit</option><option value="earlier">File an earlier event</option></select></label>${field('sharedUnit', 'Existing unit number', '', 'number', 'min="0"')}</div>
        </details>`, false));
    w.panes.maintain.insertAdjacentHTML('beforeend', card('💾 Backups and restore', `<p class="sa-hint">A story backup includes its archive, character memories, recaps, dependencies, revisions, jobs and workflow settings. Imports show a preview and create separate books. Connection profiles stay on your device.</p><div class="sa-row">${button('exportStory', 'Export complete story')}${button('importStory', 'Import or restore story')}${button('exportWorkflow', 'Export workflow preset')}${button('importWorkflow', 'Import workflow preset')}${button('importLog', 'Import a plain Scene Log')}</div><input data-sa-field="file" type="file" accept=".json,.md,.txt" hidden>`, false));
    w.panes.settings.insertAdjacentHTML('beforeend', card('🧭 Existing SillyTavern vectors', `<p class="sa-hint">Configure World Info vectors in SillyTavern’s native Vector Storage and each lorebook entry’s vector setting. Scene Archivist observes those searches without changing entry eligibility, query text, result limits, or similarity thresholds. The memory budget only trims the entries selected by World Info.</p>`, false));
    mountTools(w);
    mountRecovery(w);
    w.extras = new WorkbenchExtras(w);
    mountStoryTools(w);
    w.layout = new WorkspaceLayout(w);
    w.library = new StoryLibrary(w);
    root.addEventListener('click', event => {
        const tab = event.target.closest('[data-sa-tab]'); if (tab) { w.showTab(tab.dataset.saTab); return; }
        const b = event.target.closest('[data-sa-action]');
        if (b) { event.preventDefault(); w.dispatch(b.dataset.saAction, b).catch(e => w.h.notify(String(e?.message ?? e), 'error')); }
    });
    root.querySelector('[data-sa-field="question"]').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); w.dispatch('ask').catch(error => w.h.notify(error.message, 'error')); }
    });
    nav.addEventListener('keydown', e => {
        const buttons = [...nav.querySelectorAll(':scope > [role=tab]:not([hidden])')], i = buttons.indexOf(document.activeElement);
        if (i < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault(); const n = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : -1) + buttons.length) % buttons.length;
        w.showTab(buttons[n].dataset.saTab); buttons[n].focus();
    });
    root.addEventListener('change', event => {
        const control = event.target.closest('[data-sa-flow]');
        if (control) {
            const state = (w.liveState().flowSettings ??= {});
            state[control.dataset.saFlow] = control.type === 'checkbox' ? control.checked : control.type === 'number' ? Number(control.value) : control.value;
            w.renderFlow();
            void w.persist().catch(error => w.h.notify(error.message, 'error'));
            return;
        }
        const el = event.target;
        if (el.dataset.saOption) {
            const key = el.dataset.saOption;
            w.options()[key] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
            w.h.saveSettings();
            if (key === 'messageBadges') w.chatControls?.mount();
        }
        if (el.dataset.saField === 'activationFilter') w.renderBudget();
        if (el.dataset.saSelect) { el.checked ? w.selected.add(el.dataset.saSelect) : w.selected.delete(el.dataset.saSelect); w.renderDashboard(); }
        if (el.matches('#sa-library-type, #sa-library-history, .sa-library-filter')) w.renderLibrary();
        if (el.dataset.saField === 'file' && el.files?.[0]) { w.readImport(el.files[0], w.importKind).catch(e => w.h.notify(e.message, 'error')); el.value = ''; }
        w.layout?.refresh();
    });
    root.querySelector('#sa-library-query').addEventListener('input', () => w.scheduleLibraryRender());
    for (const input of root.querySelectorAll('[data-sa-field="rangeFrom"],[data-sa-field="rangeTo"]')) input.addEventListener('input', () => {
        root.querySelector('#sa-range-preview').textContent = '';
        root.querySelector('#sa-range-message-preview')?.replaceChildren();
    });
    w.syncOptions(); w.showTab('story'); w.updateUnitLabels(); w.installVectorBridge();
}

function mountStoryTools(w) {
    w.panes.story.innerHTML = `<section class="sa-story-home">
        <p class="sa-eyebrow">THE STORY SO FAR</p><h3 id="sa-story-name">📖 This story</h3>
        <div id="sa-story-stats"></div><p id="sa-story-job" class="sa-hint"></p><p id="sa-story-warnings" class="sa-warnline"></p>
        <div class="sa-row">${button('storyThorough', '📚 Archive thoroughly')}${button('storyRange', '🎯 Choose range')}${button('storyAttach', '🔗 Attach archive to this chat', 'hidden')}${button('estimateThorough', '📊 Estimate this run')}</div>
        <p class="sa-hint">Summaries, character memories and enabled trackers, with one review. The lore can be dramatic. The buttons can behave.</p>
    </section>`;
    w.panes.story.insertAdjacentHTML('beforeend', `<section class="sa-story-secondary"><h3>🗂️ Recently saved</h3><ul id="sa-story-recent"></ul></section>
        <section class="sa-story-secondary"><h3>Get started or troubleshoot</h3><div class="sa-row">${button('workflowPreset', 'Choose a workflow')}${button('setupHealth', 'Check setup')}${button('forgotten', 'Why was this forgotten?')}${button('safeDiagnostics', 'Export reviewed diagnostics')}${button('groundingCheck', 'Test helper grounding, up to 5 requests')}</div></section>
        <section class="sa-story-secondary"><h3>🔎 Last reply’s Memory Trail</h3><p id="sa-story-trace" class="sa-hint"></p>${button('dockPromptTrace', '🔎 Open trail beside chat')}</section>`);
    const range = w.root.querySelector('#sa-range-preview');
    range.insertAdjacentHTML('beforebegin', '<p id="sa-range-anchor-note" class="sa-hint" hidden></p>');
    range.insertAdjacentHTML('afterend', `<div class="sa-row">${button('rangeClear', '🧽 Clear picks')}${button('estimateRange', '📊 Estimate this range')}${button('sharedFiling', '📂 Shared filing options', 'hidden')}</div>
        <details class="sa-inline-tools"><summary>💡 Find a scene break</summary><p class="sa-hint">Ask the helper to suggest where this scene ends. Pick a suggestion to set the end. The chat and archive stay untouched until you choose an archive action.</p>
        ${field('rangeHold', 'Keep the newest messages out of suggestions for unarchived chat', 4, 'number', 'min="0"')}${button('sceneBreaks', '💡 Suggest scene breaks')}</details>`);
    w.root.querySelector('[data-sa-action=memoriesAll]').after(document.createRange().createContextualFragment(button('estimateMemories', '📊 Estimate memories run')));
    w.root.querySelector('#sa-character-memories').insertAdjacentHTML('beforebegin', `<div class="sa-row">${button('characterTimeline', '🗓️ Character timeline')}${button('characterExport', '📄 Export character memories')}</div>`);
    w.panes.prompt.insertAdjacentHTML('afterbegin', card('🔍 What went into the reply?', `<p id="sa-last-prompt" class="sa-hint"></p>${button('showPromptTrace', '🔎 View last reply’s memory trail')}
        <label class="checkbox_label"><input type="checkbox" data-sa-option="sceneRecall"><span>🧵 Match Little Things and story records to the scene</span></label>
        <p class="sa-hint">Use recent cues and explicit scene markers to recall details inside the memory budget. This runs locally and uses no extra model request.</p>
        <label class="checkbox_label"><input type="checkbox" data-sa-option="preciseDelivery"><span>Send relevant complete bullets from activated character lists</span></label>
        <p class="sa-hint">Native World Info filters run first. Protected lists and explicit full-detail requests stay whole. Native vector matches can load independently of keyword matches; excerpts are chosen locally when an evidenced cue matches.</p>
        <label class="checkbox_label"><input type="checkbox" data-sa-option="groupMemoryScope"><span>🧠 Only load the speaking character’s memories in groups</span></label>
        <p class="sa-hint">When you save a group memory for a specific card, its lorebook can use that card filter in SillyTavern too.</p>
        <label class="checkbox_label"><input type="checkbox" data-sa-option="cacheLayers"><span>⚡ Cache-friendly delivery · experimental</span></label>
        <p class="sa-hint">Cache-friendly delivery puts fixed lore earlier and changing matches near the reply. It overrides delivery position for Scene Archivist entries during the scan. Compare shared prompt prefix in the memory trail.</p>
        <label class="checkbox_label"><input type="checkbox" data-sa-option="memoryTools"><span>🛠️ Let supported models look up story memories · experimental</span></label>
        <p class="sa-hint">This may add a model request. SillyTavern can show the lookup in chat so the model can use the result.</p>`));
    w.panes.settings.insertAdjacentHTML('afterbegin', card('🔧 Setup and workflow profiles', `<p id="sa-profile-scope"></p>
        <div class="sa-row">${button('setupHealth', '🔧 Check setup')}${button('profiles', '⚙️ Manage workflow profiles')}</div>
        <label class="sa-field"><span>🏷️ Chat status badges</span><select class="text_pole" data-sa-option="messageBadges"><option value="desktop">Show on desktop</option><option value="all">Show on desktop and mobile</option><option value="off">Hide coverage badges</option></select></label>`));
    w.root.querySelector('[data-sa-action=importLog]').after(document.createRange().createContextualFragment(button('importLore', '📥 Copy from another lorebook')));
}
