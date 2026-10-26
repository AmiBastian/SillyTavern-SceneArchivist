import { escape as h } from './workflow-tools.js';
import { ACTION_HELP, ControlHelp, aiLabel, helpHtml } from './workbench-help.js';

export const TAB_GUIDE = {
    archive: { icon: '🗂️', label: 'Archive', title: 'Keep the scene. Keep the story.', note: 'Turn chat messages into dated summaries you can review and return to.' },
    characters: { icon: '🧠', label: 'Characters', title: 'What they remember matters.', note: 'Create character memories from your archive, then browse, check and update them.' },
    library: { icon: '📚', label: 'Library', title: 'Find the thread.', note: 'Search your saved records, inspect their evidence, or select them for another tool.' },
    search: { icon: '🔎', label: 'Search', title: 'Ask the story. Check the evidence.', note: 'Find an answer, check continuity, or see what loaded into the last reply.' },
    condense: { icon: '🧬', label: 'Condense', title: 'Less repetition. The same history.', note: 'Create linked archive recaps or shorten long character memory lists.' },
    settings: { icon: '⚙️', label: 'Settings', title: 'Make it work your way.', note: 'Choose prompts and connections, set delivery, and keep a story backup.' },
};

// Essential sections remain visible. Advanced sections are revealed in place,
// preserving their DOM, bindings, form values and any queued work.
const SECTIONS = [
    ['#sa_lorebook', 'archive-book', 'Choose the book and summarize new messages.', false],
    ['[data-sa-action="rangePreview"]', 'archive-range', 'Choose an exact scene before sending it to the model.', false],
    ['#sa_ledger', 'archive-ledger', 'See what has been processed and redo a saved range.', false],
    ['[data-sa-action="tidy"]', 'archive-tidy', 'Reorder and group entries without an AI rewrite.', true],
    ['[data-sa-action="repairStale"]', 'archive-repair', 'Rebuild records affected by corrected sources.', true],
    ['#sa-character-memories', 'character-browser', 'Read one character’s memories and review proposed updates.', false],
    ['[data-sa-action="memoriesNext"]', 'character-create', 'Make memories from summaries you have already saved.', false],
    ['#sa_mem_target', 'character-settings', 'Destinations, source units, batch size and extraction prompt.', true],
    ['#sa_tr_sel', 'character-trackers', 'Keep extra notes such as relationships or inventory.', true],
    ['[data-sa-action="extract"]', 'character-facts', 'Record knowledge, facts and unresolved promises.', true],
    ['[data-sa-action="diary"]', 'character-diary', 'Creative diary entries based on recorded knowledge.', true],
    ['[data-sa-action="knowledgeAt"]', 'character-knowledge', 'Check learning dates and historical knowledge states.', true],
    ['[data-sa-action="rosterApply"]', 'character-roster', 'Confirm aliases and combine matching memory lists.', true],
    ['#sa-library-results', 'library-records', 'Search, filter, inspect and select saved records.', false],
    ['[data-sa-action="protectSelected"]', 'library-selected', 'Protect, export or repair the records you select.', false],
    ['[data-sa-action="condenseSelected"]', 'condense-archive', 'Turn selected story units into a smaller linked recap.', false],
    ['#sa_cond_run', 'condense-memories', 'Merge repetition in character lists above the threshold.', false],
    ['[data-sa-option="autoCondense"]', 'condense-automation', 'Optional suggestions or automatic archive recaps.', true],
    ['#sa-evidence-results', 'search-answer', 'Answers and continuity findings with source buttons.', false],
    ['#sa-budget-view', 'search-loading', 'See separate keyword, vector and other activation reasons.', false],
    ['#sa_view_sum', 'search-context', 'Inspect the archive entries recorded for the last reply.', false],
    ['#sa_recap', 'search-return', 'A short recap to help you return to the story.', true],
    ['#sa_recall', 'search-recall', 'Optional helper-model selection before normal replies.', true],
    ['#sa_side_profile', 'settings-connection', 'Helper connection, model tests and additional preferences.', false],
    ['#sa_pl_sel', 'settings-prompts', 'Archive prompts, unit names and reusable prompt presets.', false],
    ['#sa_delivery', 'settings-delivery', 'Where eligible records are inserted into the model context.', false],
    ['[data-sa-action="exportStory"]', 'settings-backups', 'Download a complete story backup or restore a separate copy.', false],
    ['[data-sa-action="firstArchive"]', 'settings-first', 'The same guided setup available from Start here.', true],
    ['[data-sa-option="requestBudget"]', 'settings-processing', 'Budgets, batch sizes, review behavior and request limits.', true],
    ['[data-sa-action="sharing"]', 'settings-sharing', 'Opt in to writing one archive from several chats.', true],
    ['[data-sa-option="branchMode"]', 'settings-branches', 'Choose inherited, empty or verified earlier branch history.', true],
    ['#sa-activity-list', 'settings-activity', 'Recent jobs, writes and Undo history for this story.', true],
];

function readPreferences() {
    try { const p = JSON.parse(localStorage.getItem('sa.interface.1') || '{}'); return { mode: p.mode === 'all' ? 'all' : 'essentials', explain: !!p.explain }; }
    catch { return { mode: 'essentials', explain: false }; }
}

const primary = element => element?.classList.add('sa-primary');
const byAction = (root, action) => root.querySelector(`[data-sa-action="${action}"]`);

export class WorkspaceLayout {
    constructor(w) {
        this.w = w; this.root = w.root; this.preferences = readPreferences(); this.help = new ControlHelp(w); this.guideNumber = 0;
        this.mount();
    }
    savePreferences() { try { localStorage.setItem('sa.interface.1', JSON.stringify(this.preferences)); } catch { /* A blocked store still permits the current view. */ } }
    mount() {
        const root = this.root;
        root.classList.add('sa-workspace');
        const labels = { sa_lorebook: 'Story archive lorebook', sa_newname: 'New archive name', sa_tr_sel: 'Tracker', sa_pl_sel: 'Archive prompt preset', sa_pl_name: 'Prompt name', sa_prompt: 'Archive prompt', sa_mem_prompt: 'Character memory prompt', sa_cond_prompt: 'Character memory condense prompt', sa_tr_prompt: 'Tracker prompt', sa_mem_from: 'First story unit', sa_mem_to: 'Last story unit, inclusive', sa_through: 'Mark archived through message' };
        for (const [id, label] of Object.entries(labels)) root.querySelector('#' + id)?.setAttribute('aria-label', label);
        const title = root.querySelector('.sa-title'), version = title.querySelector('.sa-ver')?.textContent || 'v1.0.8';
        title.innerHTML = `<div class="sa-brand"><span class="sa-brand-mark" aria-hidden="true">🗂️</span><div><span class="sa-eyebrow">YOUR STORY, KEPT TOGETHER</span><div class="sa-wordmark">Scene Archivist <span class="sa-ver">${h(version)}</span></div></div></div><div class="sa-header-actions"><button type="button" class="sa-toolbar-button" data-sa-ui="guide">🌱 Start here</button><button type="button" class="sa-toolbar-button" data-sa-ui="help">? Help & examples</button></div>`;
        const toolbar = document.createElement('div'); toolbar.className = 'sa-workspace-toolbar';
        toolbar.innerHTML = `<div class="sa-view-choice" role="group" aria-label="Interface detail"><button type="button" data-sa-ui="essentials" aria-pressed="true">Essentials</button><button type="button" data-sa-ui="all" aria-pressed="false">All tools</button></div><label class="sa-explain-switch"><input type="checkbox" data-sa-ui="explain"><span>Show help buttons</span></label><span class="sa-display-note">Choose how much you see.</span>`;
        title.after(toolbar);
        for (const [tab, metadata] of Object.entries(TAB_GUIDE)) {
            const button = root.querySelector(`[data-sa-tab="${tab}"]`);
            button.innerHTML = `<span aria-hidden="true">${metadata.icon}</span><span>${metadata.label}</span>`;
            button.title = metadata.note;
        }
        const heading = document.createElement('header'); heading.className = 'sa-page-heading'; heading.id = 'sa-page-heading';
        root.querySelector('.sa-tabs').after(heading);
        const notice = document.createElement('p'); notice.id = 'sa-automation-notice'; notice.className = 'sa-automation-notice'; notice.hidden = true;
        root.querySelector('#sa-jobs').after(notice);
        for (const pane of Object.values(this.w.panes)) {
            for (const card of pane.querySelectorAll(':scope > .sa-card')) {
                const match = SECTIONS.find(([selector]) => card.querySelector(selector));
                const summary = card.querySelector(':scope > summary');
                card.dataset.saSection = match?.[1] || 'settings-vectors';
                card.dataset.saAdvanced = String(match ? match[3] : true);
                if (match) { const sub = document.createElement('small'); sub.className = 'sa-card-description'; sub.textContent = match[2]; summary.append(sub); }
            }
            const reveal = document.createElement('div'); reveal.className = 'sa-more-tools'; reveal.innerHTML = '<span></span><button type="button" class="sa-text-button" data-sa-ui="all">Show all tools →</button>';
            pane.append(reveal);
        }
        this.arrangeActions();
        const welcome = document.createElement('section'); welcome.className = 'sa-start-banner'; welcome.setAttribute('aria-label', 'Getting started');
        welcome.innerHTML = `<div><span class="sa-eyebrow">A LITTLE GUIDANCE</span><h3>Start with one scene.</h3><p>Pick messages. Review a summary. Create character memories.</p></div><div class="sa-start-actions"><button type="button" class="menu_button sa-primary" data-sa-action="firstArchive">🌱 Start here</button><button type="button" class="sa-toolbar-button" data-sa-ui="example">See a worked example</button></div>`;
        this.w.panes.archive.prepend(welcome);
        const libraryHint = document.createElement('div'); libraryHint.className = 'sa-selection-strip'; libraryHint.id = 'sa-selection-strip'; libraryHint.hidden = true;
        libraryHint.innerHTML = '<span></span><button type="button" class="sa-text-button" data-sa-ui="condenseSelection">Condense selection →</button><button type="button" class="sa-text-button" data-sa-ui="selectionTools">Selected-record tools →</button>';
        this.w.panes.library.prepend(libraryHint);
        root.addEventListener('click', e => {
            const button = e.target.closest('[data-sa-ui]'); if (!button || button.matches('input')) return;
            const action = button.dataset.saUi;
            if (action === 'all' || action === 'essentials') this.setMode(action);
            else if (action === 'guide') void this.w.dispatch('firstArchive').catch(error => this.w.h.notify(error.message, 'error'));
            else if (action === 'help' || action === 'example') void this.showGuide(action === 'example' ? 'example' : 'start').catch(error => this.w.h.notify(error.message, 'error'));
            else if (action === 'condenseSelection') this.jump('condense-archive');
            else if (action === 'selectionTools') this.jump('library-selected');
        });
        root.querySelector('[data-sa-ui="explain"]').addEventListener('change', e => { this.preferences.explain = e.target.checked; this.help.setExplain(e.target.checked); this.savePreferences(); });
        this.help.observe(root); this.help.setExplain(this.preferences.explain);
        root.querySelector('[data-sa-ui="explain"]').checked = this.preferences.explain;
        this.setMode(this.preferences.mode, false); this.select(this.w.currentTab);
        const nav = root.querySelector('.sa-tabs');
        const main = document.createElement('div'); main.className = 'sa-workspace-main';
        for (const node of [...root.children]) if (node !== title && node !== nav) main.append(node);
        root.append(main); this.w.panes.archive.append(welcome);
        welcome.querySelector('h3').textContent = 'Need a hand?';
        root.classList.add('sa-sidebar-workspace');
    }
    arrangeActions() {
        const root = this.root;
        const labels = { sa_run: '✨ Summarize new messages', sa_thorough: '🗂️ Full archive pass', sa_paste: '📋 Paste a summary', sa_cond_run: 'Condense long memory lists' };
        for (const [id, text] of Object.entries(labels)) { const node = root.querySelector('#' + id); if (node) node.value = text; }
        const replacements = [
            ['[data-sa-section="character-create"] > summary', '💭 Create character memories'],
            ['[data-sa-section="library-records"] > summary', '📚 Story library'],
            ['[data-sa-section="character-diary"] > summary', '📖 Character diaries'],
            ['[data-sa-section="settings-connection"] > summary', '🔌 Connections & preferences'],
        ];
        for (const [selector, title] of replacements) {
            const summary = root.querySelector(selector); if (summary) summary.childNodes[0].textContent = title;
        }
        const actionLabels = { memoriesNext: 'Create next batch', memoriesAll: 'Create remaining memories', memoryAudit: 'Review & organize memories', diary: '📖 Write diary', tidy: 'Tidy layout', condenseSelected: 'Condense selected records' };
        for (const [action, label] of Object.entries(actionLabels)) { const button = byAction(root, action); if (button) button.textContent = label; }
        for (const action of ['rangeArchive', 'memoriesNext', 'characterUpdate', 'ask', 'condenseSelected']) primary(byAction(root, action));
        primary(root.querySelector('#sa_run'));
        // Put occasional archive utilities in one named disclosure, keeping Undo close.
        const hero = root.querySelector('.sa-hero');
        const tools = document.createElement('details'); tools.className = 'sa-inline-tools'; tools.innerHTML = '<summary>Archive setup & tools</summary><div class="sa-row"></div>';
        for (const id of ['sa_check', 'sa_attach', 'sa_fix', 'sa_diag', 'sa_paste']) tools.lastElementChild.append(root.querySelector('#' + id));
        hero.append(tools);
        const history = document.createElement('div'); history.className = 'sa-row sa-history-row'; history.append(root.querySelector('#sa_undo')); hero.append(history);
        hero.querySelector('.sa-mini')?.remove();
        const browser = root.querySelector('[data-sa-section="character-browser"]');
        const recovery = document.createElement('details'); recovery.className = 'sa-inline-tools'; recovery.dataset.saRecoveryTools = 'true';
        recovery.innerHTML = '<summary>Reset & rebuild memories</summary><p class="sa-hint">For deliberate corrections and fresh extraction. Each action explains its scope before continuing.</p><div class="sa-row"></div>';
        for (const action of ['clearCharacter', 'forceMemories', 'clearAllMemories']) recovery.lastElementChild.append(byAction(browser, action));
        browser.querySelector('#sa-character-memories').before(recovery);
        // Separate ordinary coverage from settings that change processing behavior.
        const ledger = root.querySelector('[data-sa-section="archive-ledger"] .sa-body');
        const ledgerTools = document.createElement('details'); ledgerTools.className = 'sa-inline-tools'; ledgerTools.innerHTML = '<summary>Coverage & visibility settings</summary><div></div>';
        const rows = [...ledger.children];
        for (const row of rows) if (!['sa_ledger', 'sa_ledger_sum'].includes(row.id)) ledgerTools.lastElementChild.append(row);
        ledger.append(ledgerTools);
        // Full-width coverage belongs before the two smaller advanced cards.
        // Inserting it between them leaves an empty column on both rows.
        const ledgerCard = ledger.closest('.sa-card'), tidyCard = root.querySelector('[data-sa-section="archive-tidy"]');
        if (tidyCard) tidyCard.before(ledgerCard);
        const range = root.querySelector('[data-sa-section="archive-range"] .sa-body');
        range.querySelector('.sa-hint').textContent = 'Both message numbers are included. Preview the range before summarizing.';
        const visibility = document.createElement('details'); visibility.className = 'sa-inline-tools';
        visibility.innerHTML = '<summary>Message visibility</summary><p class="sa-hint">Hide or show original messages in future chat context. Saved summaries and ledger coverage stay as they are.</p><div class="sa-row"></div>';
        for (const action of ['rangeHide', 'rangeShow']) visibility.lastElementChild.append(byAction(range, action));
        range.append(visibility);
        const search = root.querySelector('[data-sa-section="search-answer"] .sa-row');
        const question = search.querySelector('[data-sa-field="question"]'); question.classList.add('sa-question');
        const askRow = document.createElement('div'); askRow.className = 'sa-row sa-question-row'; question.before(askRow); askRow.append(question, byAction(search, 'ask'));
        const checks = document.createElement('details'); checks.className = 'sa-inline-tools'; checks.innerHTML = '<summary>Check a claim or find continuity issues</summary><div class="sa-row"></div>';
        for (const action of ['continuity', 'continuityAll', 'continuityFull']) checks.lastElementChild.append(byAction(search, action));
        search.after(checks);
        for (const key of ['archive-book', 'archive-range', 'character-browser', 'character-create', 'library-records', 'search-answer', 'condense-archive']) {
            const card = root.querySelector(`[data-sa-section="${key}"]`); if (card) card.open = true;
        }
        const selected = root.querySelector('[data-sa-section="library-selected"]'); if (selected) selected.open = false;
    }
    setMode(mode, persist = true) {
        this.preferences.mode = mode === 'all' ? 'all' : 'essentials';
        this.root.dataset.saView = this.preferences.mode;
        for (const button of this.root.querySelectorAll('.sa-view-choice [data-sa-ui]')) button.setAttribute('aria-pressed', String(button.dataset.saUi === this.preferences.mode));
        for (const card of this.root.querySelectorAll('[data-sa-advanced="true"]')) card.hidden = this.preferences.mode !== 'all';
        for (const pane of Object.values(this.w.panes)) {
            const hidden = pane.querySelectorAll(':scope > [data-sa-advanced="true"]').length, more = pane.querySelector('.sa-more-tools');
            more.hidden = this.preferences.mode === 'all' || !hidden;
            more.querySelector('span').textContent = `${hidden} more ${hidden === 1 ? 'section' : 'sections'} available when you need them.`;
        }
        if (persist) this.savePreferences();
        this.help.hide();
        this.refresh();
        this.help.refresh(this.w.panes[this.w.currentTab]);
    }
    select(tab) {
        const metadata = TAB_GUIDE[tab] || TAB_GUIDE.archive;
        this.root.querySelector('#sa-page-heading').innerHTML = `<div><span class="sa-eyebrow">${h(metadata.label.toUpperCase())}</span><h2>${h(metadata.label)}</h2><p>${h(metadata.note)}</p></div>`;
        this.root.querySelector('.sa-header-actions [data-sa-ui="guide"]').hidden = tab === 'archive';
        this.help.hide();
        this.help.refresh(this.w.panes[tab]);
    }
    refresh() {
        const count = this.w.selected.size, selection = this.root.querySelector('#sa-selection-strip');
        selection.hidden = !count; selection.querySelector('span').textContent = `${count} ${count === 1 ? 'record' : 'records'} selected`;
        const s = this.w.h.settings(), enabled = [];
        const archive = this.root.querySelector('#sa_lorebook');
        if (s.lorebook && document.activeElement !== archive) {
            if (![...archive.options].some(option => option.value === s.lorebook) && this.w.h.context().getWorldInfoNames().includes(s.lorebook)) archive.add(new Option(s.lorebook, s.lorebook));
            archive.value = s.lorebook;
        }
        if (s.autoArchive) enabled.push('archiving at the configured reminder interval');
        if (s.memoryAuto) enabled.push('character memories after archiving');
        if (s.trackerAuto) enabled.push('trackers after archiving');
        if (s.workbench?.autoCondense === 'auto') enabled.push('automatic recaps');
        if (s.recall) enabled.push('AI Recall before replies');
        if (s.workbench?.continuityAuto) enabled.push('continuity checks');
        const notice = this.root.querySelector('#sa-automation-notice');
        const text = enabled.length ? `Automatic work enabled: ${enabled.join(' · ')}. View choice only changes what is shown.` : '';
        notice.hidden = !enabled.length; if (notice.textContent !== text) notice.textContent = text;
    }
    jump(section) {
        const card = this.root.querySelector(`[data-sa-section="${section}"]`); if (!card) return;
        if (card.dataset.saAdvanced === 'true') this.setMode('all');
        const tab = Object.entries(this.w.panes).find(([, pane]) => pane.contains(card))?.[0];
        if (tab) this.w.showTab(tab);
        card.open = true; card.scrollIntoView({ block: 'start', behavior: 'auto' }); card.querySelector('summary')?.focus();
    }
    async showGuide(page = 'start') {
        this.help.hide();
        const root = document.createElement('div'); root.className = 'sa-review sa-help-hub';
        const id = `sa-guide-${++this.guideNumber}`; let route = '';
        root.innerHTML = `<div class="sa-guide-heading"><span class="sa-eyebrow">A FRIENDLIER FIRST CHAPTER</span><h3>🧭 A little help finding your way.</h3><p>You can learn the workflow here before changing a real story.</p></div><div class="sa-guide-tabs" role="tablist" aria-label="Help topics">${[['start', 'Start here'], ['buttons', 'Button guide'], ['example', 'Worked example']].map(([key, label]) => `<button type="button" role="tab" id="${id}-${key}" aria-controls="${id}-${key}-panel" data-help-page="${key}">${label}</button>`).join('')}</div><section id="${id}-start-panel" role="tabpanel" aria-labelledby="${id}-start" data-help-panel="start">${this.startPage()}</section><section id="${id}-buttons-panel" role="tabpanel" aria-labelledby="${id}-buttons" data-help-panel="buttons"><label class="sa-field"><span>Find a button by name or purpose</span><input class="text_pole" data-help-search placeholder="Try redo, memories, sources, undo…"></label><p class="sa-hint">Expand a button to see what it does, what changes and whether it uses AI.</p><div data-help-directory></div></section><section id="${id}-example-panel" role="tabpanel" aria-labelledby="${id}-example" data-help-panel="example">${this.examplePage()}</section>`;
        const showPage = key => {
            for (const button of root.querySelectorAll('[data-help-page]')) { button.setAttribute('aria-selected', String(button.dataset.helpPage === key)); button.tabIndex = button.dataset.helpPage === key ? 0 : -1; }
            root.querySelectorAll('[data-help-panel]').forEach(panel => panel.hidden = panel.dataset.helpPanel !== key);
        };
        const directory = () => {
            const query = root.querySelector('[data-help-search]').value.trim().toLocaleLowerCase();
            const entries = Object.entries(ACTION_HELP).filter(([, data]) => `${data.title} ${data.description} ${data.changes} ${data.example}`.toLocaleLowerCase().includes(query));
            const unique = [...new Map(entries.map(([key, data]) => [data.title, [key, data]])).values()];
            root.querySelector('[data-help-directory]').innerHTML = `<p class="sa-hint">${unique.length} matching actions</p>` + unique.map(([, data]) => `<details class="sa-guide-action"><summary><b>${h(data.title)}</b><span class="sa-badge">${aiLabel(data.ai)}</span></summary>${helpHtml(data)}</details>`).join('');
        };
        root.querySelector('[data-help-search]').addEventListener('input', directory); directory();
        root.addEventListener('click', e => {
            const tab = e.target.closest('[data-help-page]'); if (tab) showPage(tab.dataset.helpPage);
            const example = e.target.closest('[data-example-step]'); if (example) {
                root.querySelectorAll('[data-example-step]').forEach(button => button.setAttribute('aria-pressed', String(button === example)));
                root.querySelectorAll('[data-example-panel]').forEach(panel => panel.hidden = panel.dataset.examplePanel !== example.dataset.exampleStep);
            }
            const go = e.target.closest('[data-help-go]'); if (go) { route = go.dataset.helpGo; root.closest('dialog')?.querySelector('.popup-button-ok')?.click(); }
        });
        root.querySelector('.sa-guide-tabs').addEventListener('keydown', e => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
            const buttons = [...root.querySelectorAll('[data-help-page]')], current = buttons.indexOf(document.activeElement); if (current < 0) return;
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (current + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
            e.preventDefault(); showPage(buttons[next].dataset.helpPage); buttons[next].focus();
        });
        showPage(page); await this.w.h.show(root, {large:false});
        if (route === 'setup') return this.w.dispatch('firstArchive');
        if (route) this.jump(route);
    }
    startPage() {
        return `<div class="sa-guide-steps"><article><span>01</span><h4>Archive one scene</h4><p>Choose an inclusive message range in Archive, preview it and ask for a summary. Review the result before saving.</p></article><article><span>02</span><h4>Create character memories</h4><p>Open Characters and create memories from the saved summaries. The lists keep dates and links to their evidence.</p></article><article><span>03</span><h4>Continue the story</h4><p>Native World Info loads eligible entries into replies. Search shows the recorded keyword, vector and other activation reasons.</p></article></div><div class="sa-row"><button type="button" class="menu_button sa-primary" data-help-go="setup">🌱 Open guided setup</button><button type="button" class="menu_button" data-help-go="archive-range">Take me to message ranges</button></div><h4>Where does everything live?</h4><div class="sa-guide-map">${Object.entries(TAB_GUIDE).map(([, data]) => `<p><b>${data.icon} ${h(data.label)}</b><span>${h(data.note)}</span></p>`).join('')}</div><p class="sa-note">Essentials keeps everyday sections visible. All tools reveals the advanced sections in place. This display choice does not turn automation on or off. Hover or keyboard-focus a control for help; enable Show help buttons to open explanations by tap.</p>`;
    }
    examplePage() {
        return `<p class="sa-example-notice"><b>Read-only sample.</b> These invented examples make no AI requests and do not write to your chats or lorebooks.</p><div class="sa-example-steps" role="group" aria-label="Example stages">${[['chat', '1 · Chat'], ['archive', '2 · Summary'], ['memory', '3 · Memory'], ['loading', '4 · Loading']].map(([key, label]) => `<button type="button" data-example-step="${key}" aria-pressed="${key === 'chat'}">${label}</button>`).join('')}</div><div class="sa-example-stage" data-example-panel="chat"><span class="sa-eyebrow">TUESDAY, OCTOBER 6, 2026 · MESSAGES 12 TO 13</span><h4>A small scene, before it becomes history.</h4><div class="sa-example-message"><b>Mara · #12</b><p>Keep the blue key. Meet me at Ember Station at eight.</p></div><div class="sa-example-message"><b>Rowan · #13</b><p>I have it. Eight at the station, I’ll be there.</p></div><p>Choose 12 to 13 and Preview range. Both messages are included. Summarize this range sends them to your model.</p></div><div class="sa-example-stage" data-example-panel="archive" hidden><span class="sa-eyebrow">ARCHIVE · A REVIEWED SUMMARY</span><h4>Day 1 · Tuesday, October 6, 2026</h4><p class="sa-example-record">Mara gave Rowan the blue key. Rowan agreed to meet her at Ember Station at 8 PM.</p><p>The source link points back to messages 12 to 13. A ledger marker records that this range was archived.</p><p><b>What to check:</b> They agreed to meet. The messages do not prove the meeting already happened.</p></div><div class="sa-example-stage" data-example-panel="memory" hidden><span class="sa-eyebrow">CHARACTERS · ROWAN</span><h4>A memory belongs to someone.</h4><p class="sa-example-record">[Tuesday, October 6, 2026 · Day 1]<br>Received Mara’s blue key and agreed to meet her at Ember Station at 8 PM.</p><p>Create next batch reads saved archive units. This memory keeps a source link to the summary.</p><p><b>What to check:</b> Rowan knows about the arrangement. Another character does not automatically learn it.</p></div><div class="sa-example-stage" data-example-panel="loading" hidden><span class="sa-eyebrow">ILLUSTRATED LOADING EXAMPLES, NOT A LIVE SCAN</span><h4>Two independent ways a record can be found.</h4><article class="sa-example-channel"><b>🔑 Native keyword</b><p>If this entry’s keyword is “blue key”, a matching message can activate it under your World Info rules.</p></article><article class="sa-example-channel"><b>🧭 Native vector</b><p>A configured semantic search might find the handover when the conversation refers to the station key, if its similarity settings accept that result.</p></article><p>Each mechanism follows its own settings. A word in an entry’s body does not make its vector result a keyword match. Search → Memory budget and loading reasons shows the evidence available for a real reply.</p></div>`;
    }
}
