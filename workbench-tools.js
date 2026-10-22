import * as M from './memory-engine.js';
import * as Core from './core.js';
import * as T from './workflow-tools.js';

const h = T.escape;
const button = (action, label, extra = '') => `<button type="button" class="menu_button" data-sa-action="${action}" ${extra}>${label}</button>`;
const card = (name, body) => `<details class="sa-card"><summary>${name}</summary><div class="sa-body">${body}</div></details>`;
const field = (name, label, type = 'text', value = '') => `<label class="sa-field"><span>${label}</span><input class="text_pole" data-sa-field="${name}" type="${type}" value="${h(value)}"></label>`;
const option = (v, label) => `<option value="${h(v)}">${h(label)}</option>`;

export function mountTools(w) {
    w.panes.library.querySelector('#sa-library-query').closest('.sa-row').insertAdjacentHTML('afterend', `<details class="sa-library-filters"><summary>More filters</summary><div class="sa-grid">
        <label class="sa-field"><span>Character</span><select class="text_pole sa-library-filter" id="sa-library-subject"></select></label>
        <label class="sa-field"><span>Source chat</span><select class="text_pole sa-library-filter" id="sa-library-chat"></select></label>
        <label class="sa-field"><span>First unit</span><input class="text_pole sa-library-filter" type="number" min="0" id="sa-library-from"></label>
        <label class="sa-field"><span>Last unit</span><input class="text_pole sa-library-filter" type="number" min="0" id="sa-library-to"></label>
        <label class="sa-field"><span>Event date from</span><input class="text_pole sa-library-filter" type="date" id="sa-library-dateFrom"></label>
        <label class="sa-field"><span>Event date through</span><input class="text_pole sa-library-filter" type="date" id="sa-library-dateTo"></label>
        <label class="sa-field"><span>Protection</span><select class="text_pole sa-library-filter" id="sa-library-protection">${option('', 'Any protection')}${option('detailed','Keep detailed')}${option('exact','Preserve exact wording')}${option('locked','Author locked')}${option('pinned','Budget priority')}</select></label></div></details>`);
    w.panes.library.insertAdjacentHTML('beforeend', card('Selected records', `<div class="sa-row"><select class="text_pole" data-sa-field="protectFlag">${option('detailed','Keep detailed')}${option('exact','Preserve exact wording')}${option('locked','Author locked')}</select><select class="text_pole" data-sa-field="protectValue">${option('true','Apply protection')}${option('false','Clear protection')}</select>${button('protectSelected','Update selected protections')}</div><label class="checkbox_label"><input type="checkbox" data-sa-field="exportSources"><span>Include linked original sources in selection exports</span></label><div class="sa-row">${button('exportMarkdown','Export selected as Markdown')}${button('exportSelection','Export selected as JSON')}${button('repairSelected','Repair selected records and dependents')}</div>`));
    w.panes.characters.insertAdjacentHTML('beforeend', card('What did they know by this date?', `<p class="sa-hint">This uses recorded learning dates and historical states explicitly preserved in Inspect. An event date alone never proves when someone learned about it. Undated knowledge is shown separately.</p><div class="sa-grid"><label class="sa-field"><span>Character</span><select class="text_pole" data-sa-field="knowledgeSubject"></select></label>${field('knowledgeDate','Knowledge as of','date')}</div><div class="sa-row">${button('knowledgeAt','Show dated knowledge')}</div><div id="sa-knowledge-results"></div>`));
    w.panes.characters.insertAdjacentHTML('beforeend', card('Character roster and aliases', `<p class="sa-hint">Choose a canonical name and the names you have confirmed belong to that person. Matching memory lists can be combined, with original records retained as superseded sources. Knowledge records keep their own evidence. Protected lists must be unlocked first.</p><div id="sa-roster-list" class="sa-hint"></div><div class="sa-grid">${field('rosterName','Canonical character name')}${field('rosterAliases','Other confirmed names, separated by semicolons')}<label class="sa-field"><span>Destination for their memory list</span><select class="text_pole" data-sa-field="rosterBook"></select></label></div><label class="checkbox_label"><input type="checkbox" data-sa-field="rosterKeywords"><span>Also add these approved names as native lorebook keywords</span></label><div class="sa-row">${button('rosterApply','Preview identity changes')}</div>`));
    w.panes.settings.insertAdjacentHTML('beforeend', card('Recent activity', `<p class="sa-hint">Jobs and Undo history from this chat, plus the latest confirmed record updates from other chats using this archive.</p><div id="sa-activity-list"></div>`));
    w.panes.settings.insertAdjacentHTML('afterbegin', card('Your first archive', `<p class="sa-hint">Choose an existing connection profile, select or create an archive, preview a message range, and review your first summary.</p><div class="sa-row">${button('firstArchive','Guide me through an archive')}</div>`));
    w.panes.archive.insertAdjacentHTML('beforeend', card('Repair after a correction', `<p class="sa-hint">Choose corrected records in Library to rebuild affected memories and recaps in source order. Each repaired record is reviewed before the next one uses it.</p><div class="sa-row">${button('repairStale','Preview repairs for stale records')}</div>`));
    const settings = w.panes.settings.querySelector('[data-sa-option=reviewMode]').closest('.sa-grid');
    settings.insertAdjacentHTML('beforeend', `<label class="sa-field"><span>Requests allowed per Resume, 0 for no limit</span><input class="text_pole" type="number" min="0" step="1" data-sa-option="requestLimit"></label>`);
    settings.insertAdjacentHTML('afterend', `<label class="checkbox_label"><input type="checkbox" data-sa-option="jobPreview"><span>Preview manual jobs before starting</span></label>`);
}

function fill(select, rows, first = '') {
    if (!select) return; const value = select.value;
    select.innerHTML = first + rows.map(([v, label]) => option(v, label)).join('');
    if ([...select.options].some(o => o.value === value)) select.value = value;
}
export function renderTools(w) {
    if (!w.root) return;
    const subjects = M.unique(w.entries.flatMap(e => [M.record(e)?.subject, ...(M.record(e)?.aliases || [])])).sort((a,b)=>a.localeCompare(b));
    const chats = [...new Map(w.entries.filter(T.sourceChat).map(e => [T.sourceChat(e), T.sourceLabel(e)])).entries()];
    fill(w.root.querySelector('#sa-library-subject'), subjects.map(n=>[n,n]), option('','All characters'));
    fill(w.root.querySelector('#sa-library-chat'), chats, option('','All source chats')+option('unknown','Legacy / unknown chat'));
    fill(w.root.querySelector('[data-sa-field=knowledgeSubject]'), subjects.map(n=>[n,n]), option('','Choose a character'));
    fill(w.root.querySelector('[data-sa-field=rosterBook]'), Object.keys(w.books).map(n=>[n,n]));
    const roster = w.root.querySelector('#sa-roster-list');
    if (roster) roster.textContent = subjects.length ? subjects.join(' · ') : 'No named character records yet.';
    const activity = w.root.querySelector('#sa-activity-list'); if (!activity) return;
    const journals = (w.h.meta().journals || []).filter(j=>j.archive===w.h.settings().lorebook);
    const rows = journals.map(j=>({id:j.id,label:j.label,at:j.updated||j.at,chat:j.chatId,status:j.status,count:j.changes.length}));
    const known = new Set(rows.map(j=>j.id));
    for (const e of w.entries) {
        const r=M.record(e); if(!r?.lastJobId||known.has(r.lastJobId))continue;
        const found=rows.find(j=>j.id===r.lastJobId);
        if(found)found.count++;else rows.push({id:r.lastJobId,label:'Record update',at:r.updated,chat:r.updatedIn||T.sourceLabel(e),status:'confirmed record changes',count:1});
    }
    const job=w.liveState().job;
    for(const j of [...(w.liveState().history||[]),...(job?[{...job,steps:job.steps.length}]:[])]) if(!rows.some(r=>r.id===j.id))rows.push({id:j.id,label:j.kind,at:j.ended||j.created,chat:w.identity(),status:j.status,count:0});
    activity.innerHTML=rows.sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,100).map(j=>`<div class="sa-result"><b>${h(j.label)}</b> · ${h(j.status)}<p class="sa-hint">${h(j.at||'')} · ${h(j.chat||'Unknown chat')} · ${j.count} recorded entry changes</p></div>`).join('')||'<p class="sa-hint">New jobs and confirmed writes will appear here.</p>';
}

export async function previewJob(w, kind, steps, options) {
    let limit=Number(w.options().requestLimit)||0;
    if(options.automatic||!w.options().jobPreview)return limit;
    const summary=T.summarizeJob(kind,steps,w.entries,w.h.settings().lorebook,limit),root=document.createElement('div');root.className='sa-review';
    const books=M.unique([summary.archive,...(kind.includes('memor')?[w.h.memoryBook(),...Object.keys(w.h.settings().storyBooks?.[summary.archive]||{})]:[])]);
    root.innerHTML=`<h3>Preview ${h(kind)} job</h3><p>${summary.batches} initial processing batches, about ${summary.input} source-text tokens.</p><p class="sa-note">Prompts, existing records, retries${summary.dynamic?', and follow-up stages':''} add to input and request counts. This is an estimate, not a provider charge quote.</p><p>Possible destinations: ${h(books.join('; '))}</p>${field('previewLimit','Requests allowed per Resume, 0 for no limit','number',limit)}<p class="sa-hint">A request limit pauses the job before its next model call. Prepared usable results are kept. Resume grants the same allowance again.</p>`;
    if(!(await w.h.confirm(root,{okButton:'Start job',cancelButton:'Back'})))return null;
    limit=Number(root.querySelector('[data-sa-field=previewLimit]').value);
    if(!Number.isInteger(limit)||limit<0||limit>100000)throw new Error('Choose a whole request limit from 0 to 100000.');
    return limit;
}

async function protect(w) {
    const selected=w.selectedEntries();if(!selected.length)throw new Error('Select records in Library first.');
    const flag=w.value('protectFlag'),enabled=w.value('protectValue')==='true';
    if(!['detailed','exact','locked'].includes(flag))throw new Error('Choose a protection.');
    await w.withLock(async()=>{
        await w.loadBooks();const books=M.copy(w.books),bases=w.bases(),changes=[];
        for(const source of selected){const e=w.entryIn(books,M.record(source).id).entry;
            if(M.record(e).protection?.[flag]===enabled)continue;
            M.revise(e,e.content,'Bulk protection update',{protection:{...M.record(e).protection,[flag]:enabled}});
            changes.push({title:M.title(e),content:`${enabled?'Apply':'Clear'} ${flag}`,before:`${M.record(source).protection?.[flag]?'Enabled':'Disabled'}`});
        }
        if(!changes.length)return w.h.notify('These records already have that protection setting.','info');
        if(!(await w.h.confirmText(`${enabled?'Apply':'Clear'} ${flag} for ${changes.length} selected records?`)))return;
        await w.write(books,bases,'Selected record protections');
    });
}

async function repair(w, selectedOnly) {
    await w.refresh();const roots=selectedOnly?[...w.selected]:w.entries.filter(e=>M.record(e)?.status==='stale').map(e=>M.record(e).id);
    if(!roots.length)throw new Error('Select corrected records in Library, or choose a story with stale records.');
    const ordered=T.repairOrder(w.entries,roots);if(!ordered.length)return w.h.notify('No dependent records need repair.','info');
    const protectedEntries=ordered.filter(e=>['detailed','exact','locked'].some(flag=>M.record(e).protection?.[flag]));
    if(protectedEntries.length)throw new Error('Review protected records before repairing: '+protectedEntries.map(M.title).join('; '));
    const root=document.createElement('div');root.className='sa-review';root.innerHTML='<h3>Review repair order</h3><p>Each result is reviewed and saved before its dependents are generated.</p>';
    for(const e of ordered){const p=document.createElement('p');p.textContent=M.title(e);root.append(p);}
    if(!(await w.h.confirm(root,{okButton:'Prepare repair job',cancelButton:'Back'})))return;
    const steps=ordered.map(e=>({kind:'rebuild',repair:true,target:M.record(e).id,targetHash:M.hash(e.content),targetType:M.record(e).type,ids:[],hashes:{}}));
    return w.createJob('repair',steps);
}

async function knowledge(w) {
    await w.refresh();
    const subject=w.value('knowledgeSubject');if(!subject)throw new Error('Choose a character.');
    const result=T.knowledgeAt(w.entries,subject,w.value('knowledgeDate')),box=w.root.querySelector('#sa-knowledge-results');
    box.innerHTML=`<h4>Recorded knowledge by ${h(result.cutoff)}</h4>`+result.known.map(({entry,version})=>`<article class="sa-result"><b>${h(version.knowledge||'memory')}</b> · ${version.knowledge==='unaware'?'state dated':'learned'} ${h(version.learned)}<div class="sa-prose">${h(version.content)}</div>${button('inspect','Inspect current record',`data-id="${h(M.record(entry).id)}"`)}</article>`).join('')+(result.known.length?'':'<p>No dated learning record proves knowledge by this date.</p>')+`<details><summary>${result.unknown.length} records with unknown or unverified learning dates</summary><p class="sa-hint">These are not included in the dated knowledge above.</p>${result.unknown.map(e=>`<p>${h(M.title(e))} ${button('inspect','Set learning date in Inspect',`data-id="${h(M.record(e).id)}"`)}</p>`).join('')}</details>`;
}

async function roster(w) {
    const name=w.value('rosterName').trim(),aliases=M.unique([name,...w.value('rosterAliases').split(/\s*;\s*/)]),destination=w.value('rosterBook');
    if(!name||!destination)throw new Error('Choose a canonical name and existing memory destination.');
    await w.withLock(async()=>{
        await w.loadBooks();const books=M.copy(w.books),bases=w.bases(),matches=w.entries.filter(e=>['memory','knowledge'].includes(M.record(e)?.type)&&[M.record(e).subject,...(M.record(e).aliases||[])].some(s=>aliases.some(n=>n.toLocaleLowerCase()===String(s||'').toLocaleLowerCase())));
        if(!matches.length)throw new Error('No character records match those names.');
        if(matches.some(e=>M.record(e).protection?.locked||M.record(e).protection?.exact||M.record(e).protection?.detailed))throw new Error('Unlock matching protected records before combining identities.');
        const memories=matches.filter(e=>M.record(e).type==='memory'&&M.record(e).status==='current');
        const main=memories.find(e=>M.record(e).subject.toLocaleLowerCase()===name.toLocaleLowerCase())||memories[0];
        const changes=[];
        for(const source of matches){const e=w.entryIn(books,M.record(source).id).entry,r=M.record(e),patch={subject:name,aliases:M.unique([...aliases,...(r.aliases||[])])};
            if(r.type==='memory'&&r.status==='current'&&main&&r.id!==M.record(main).id){patch.status='superseded';patch.aliasOf=M.record(main).id;}
            let content=e.content;
            if(main&&r.id===M.record(main).id){
                if(memories.length>1)Object.assign(patch,{learnedAt:'',howLearned:'',knowledgeHistory:[]});
                const items=M.tidyMemory(memories.flatMap(x=>Core.parseMemoryDoc(x.content)),{removeExact:true});
                content=Core.memoryDocText(name,items,{},w.h.settings().unit);
                patch.derivedFrom=M.unique(memories.flatMap(x=>M.record(x).derivedFrom||[])).filter(id=>id!==r.id);
                patch.derivedHashes=Object.fromEntries(patch.derivedFrom.map(id=>[id,M.hash(w.find(id)?.content||'')]));
            }
            M.revise(e,content,'Approved character identity change',patch);
            if(w.checked('rosterKeywords'))e.key=M.unique([...(e.key||[]),...aliases]);
            changes.push({title:`${M.title(source)} (${source.world})`,before:source.content,content:e.content});
        }
        if(!(await w.review(changes,'Review character identity changes','Original record identities and source evidence are retained. Combined secondary lists become superseded. Keyword changes occur only if you chose that option.')))return;
        // Keep edits made in review in the corresponding stable record identities.
        matches.forEach((source,i)=>{const e=w.entryIn(books,M.record(source).id).entry;if(e.content!==changes[i].content)M.revise(e,changes[i].content,'Identity review correction');});
        if(main&&main.world!==destination){
            const location=w.entryIn(books,M.record(main).id),source=location.entry;
            const target=w.h.makeEntry(destination,books[destination]);const key=target.uid;
            Object.assign(target,M.copy(source),{uid:key});delete location.data.entries[source.uid];
        }
        M.invalidate(Object.values(books).flatMap(b=>Object.values(b.entries||{})),matches.map(e=>M.record(e).id),'A character identity or memory list was corrected');
        for(const source of matches){const e=w.entryIn(books,M.record(source).id).entry;if(M.record(e).status==='stale')M.record(e).status=M.record(source).type==='memory'&&main&&M.record(source).id!==M.record(main).id?'superseded':'current';}
        await w.write(books,bases,'Character roster and aliases');
    });
}

async function firstArchive(w) {
    const root=document.createElement('div');root.className='sa-review';
    const profiles=w.h.context().extensionSettings?.connectionManager?.profiles||[];
    root.innerHTML=`<h3>Make your first archive</h3><p class="sa-note">Summaries use your current SillyTavern model. Small helper requests can use an existing Connection Manager profile.</p><label class="sa-field"><span>Small-request connection</span><select class="text_pole" data-guide="profile">${option('','Current model')}${profiles.map(p=>option(p.id,p.name)).join('')}</select></label><div class="sa-grid"><label class="sa-field"><span>Use an existing archive</span><select class="text_pole" data-guide="book">${option('','Create a new archive')}${w.h.context().getWorldInfoNames().map(n=>option(n,n)).join('')}</select></label><label class="sa-field"><span>Or new archive name</span><input class="text_pole" data-guide="new" placeholder="My story archive"></label></div><div class="sa-grid">${field('guideFrom','First message','number',0)}${field('guideTo','Last message, inclusive','number',Math.max(0,(w.h.context().chat||[]).length-1))}</div><p class="sa-hint">The range is previewed before a model request. Results are reviewed before saving.</p>`;
    root.querySelector('[data-guide=profile]').value=w.h.settings().sideProfile||'';
    if(!(await w.h.confirm(root,{okButton:'Set up and preview range',cancelButton:'Back'})))return;
    const range=M.messageRange(w.h.context().chat||[],root.querySelector('[data-sa-field=guideFrom]').value,root.querySelector('[data-sa-field=guideTo]').value);
    const chosen=root.querySelector('[data-guide=book]').value,newName=root.querySelector('[data-guide=new]').value.trim(),name=chosen||newName;
    if(!name)throw new Error('Choose an archive name.');
    await w.withLock(async()=>{
        if(!chosen)await w.h.createBook(name);
        w.h.settings().lorebook=name;w.h.settings().sideProfile=root.querySelector('[data-guide=profile]').value;w.h.settings().review=true;
        await w.h.attach(name);w.h.saveSettings();w.h.rebindSettings();await w.loadBooks();
    });
    w.showTab('archive');w.root.querySelector('[data-sa-field=rangeFrom]').value=range.from;w.root.querySelector('[data-sa-field=rangeTo]').value=range.to;w.previewRange();
    w.root.querySelector('[data-sa-field=rangeFrom]').closest('details').open=true;
    w.h.notify('Your range is ready. Choose Summarize this range to start, then review the result.','success');
}

export async function dispatchTool(w,action) {
    const actions={protectSelected:()=>protect(w),repairSelected:()=>repair(w,true),repairStale:()=>repair(w,false),knowledgeAt:()=>knowledge(w),rosterApply:()=>roster(w),firstArchive:()=>firstArchive(w),
        exportMarkdown:()=>{const data=T.selectionExport(w.entries,[...w.selected],w.checked('exportSources'));w.h.download('Scene-Archivist-selection.md',data.markdown,'text/markdown');},
        exportSelection:()=>{const data=T.selectionExport(w.entries,[...w.selected],w.checked('exportSources'));delete data.markdown;w.h.download('Scene-Archivist-selection.json',JSON.stringify(data,null,2),'application/json');}};
    if(!actions[action])return false;await actions[action]();return true;
}
