# Scene Archivist 2.1.4

Your character can remember a grudge from childhood but somehow the brass key you gave them four messages ago is gone. Of course it is.

Scene Archivist is a **SillyTavern** extension by **Mira**. It saves scenes, character memories, clues, and diaries in editable lorebooks. You can check a summary against the original chat, decide who knows the secret, and see which records reached a reply.

[Install](#install) · [Your first archive](#your-first-archive) · [Find a feature](#where-everything-lives) · [Troubleshooting](#troubleshooting) · [Changelog](CHANGELOG.md)

## Install

1. In SillyTavern, open **Extensions → Install extension**.
2. Paste the [Scene Archivist installation URL](https://github.com/AmiBastian/SillyTavern-SceneArchivist). Leave the branch field at its default.
3. Reload SillyTavern, open the chat you want to archive, and choose **Scene Archivist** from the wand menu by the message box.

![The wand menu with Scene Archivist listed](docs/media/54-wand-menu.png?v=2.1.4-guide)

If you already have it installed, use SillyTavern’s extension update control. **Tools → Maintain → Backups and restore → Back up this story** saves a copy of your books, progress, revisions, and unfinished work before an update.

## Your first archive

Start with one short scene you remember well. The walkthrough uses four messages from **The Bell Below**, an invented story about a flooded railway station. You can follow the same steps in your own chat.

[Watch the first archive from setup to Memory Trail (MP4)](docs/media/first-archive-walkthrough.mp4?v=2.1.4-guide)

The screenshots and walkthroughs use Scene Archivist 2.1.4 in SillyTavern 1.19.0, with sample lorebooks and scripted model replies. Your theme and model output will look different.

### 1. Make an archive for this chat

Open **Start here**. Use **Current model** if your normal chat connection is working, or pick your archive connection profile. Leave **Create a new archive** selected and give it a name. This makes a SillyTavern lorebook and attaches it to this chat.

![Guided setup with Current model, an archive name, and a four-message range](docs/media/55-guided-setup.png?v=2.1.4-guide)

### 2. Pick the messages

Enter the first and last message numbers, then click **Set up and preview range**. Both ends count. In our example, **0–3** means four messages. Read the preview before you send anything to the model.

For another scene later, use the book icon beside a message and choose **Start range here** or **End range here**. You can also enter both numbers under **Archive → Pick your messages**.

![The four original chat messages selected for the first archive](docs/media/56-first-range.png?v=2.1.4-guide)

### 3. Summarize, read it, then save

Click **Summarize this range**. In review, check what happened, who was there, and whether the important details made it in. Seraphina *promised* to meet Mira by six. If the summary says they already met, fix that bit before it becomes tomorrow’s plot hole.

Click **Save selected** when the proposal is ready. **Review later** keeps the draft. Your new entry appears in **Library**, and **Archive → Ledger** shows which messages you filed.

![The first archive review with the original story details and the save button](docs/media/57-first-review.png?v=2.1.4-guide)

### 4. Check what reached the next reply

Send a normal chat message about something you archived. Our example asks about the brass key. In **Story → Memory Trail**, choose **Open trail beside chat**. Look under **Lorebook records** for the saved scene and the reason it loaded. **View sources** leads back to the saved record and its linked chat messages.

**Preview next reply** estimates what your current draft could load. **Memory Trail** shows what reached a reply after you sent it. If the key still goes missing, this is where the receipts are.

![The Memory Trail beside the chat, with a saved scene and its loading reason](docs/media/35-reply-trace.png?v=2.1.4-guide)

## Where everything lives

| I want to… | Go here |
| --- | --- |
| Catch up after a long scene or find a promise I left hanging | **Story** |
| Archive specific messages or check what I’ve already filed | **Archive** |
| Make memories, track relationships, or write a diary | **Characters** |
| Find, correct, or ask about something the story already saved | **Library** |
| Shorten entries, create recaps, repair links, or make a backup | **Tools → Maintain** |
| See what gets sent to chat or move it to another prompt position | **Tools → Prompt** |
| Change the model, writing prompts, or automation | **Tools → Settings** |

Open **Help & examples** for the searchable button guide. **Advanced controls** is in **Tools**. On a phone, scroll the Memory Trail’s bottom sheet to see the records. Use **Show help buttons** in Tools for tips you can tap.

<details>
<summary>Help and phone screens</summary>

![The built-in button guide and worked example](docs/media/25-help.png?v=2.1.4-guide)
![Archive on a narrow screen](docs/media/26-mobile.png?v=2.1.4-guide)
![The book menu on a phone-sized screen](docs/media/36-mobile-message-menu.png?v=2.1.4-guide)
![The Memory Trail bottom sheet with Preview next reply](docs/media/39-mobile-trail.png?v=2.1.4-guide)

</details>

## Archive more than one scene

**Summarize new messages** works through uncovered messages. **Summarize this range** uses the exact selection. Tick **Also create memories** to include character memories with that range. **Archive thoroughly** prepares the scene summaries, character memories, and any enabled trackers for review. To use it on a selection, click **Archive this range thoroughly**.

**Estimate this run** tells you how many requests are planned before you send them. With one request per enabled stage, Archive thoroughly usually uses up to three when the inputs fit. **Optional automation** can combine stages on the same profile in one request. If the context is too small, the job can offer a split or a retry.

Click the waiting count in **Story** to jump to the first eligible unarchived message, including a gap between saved ranges. The **Ledger** has **Redo summaries** and **Mark unprocessed**. Hiding a range is a separate chat visibility control. **Tidy the shelves** reorders entries without asking a model.

<details>
<summary>Range picks, combined review, and the Ledger</summary>

![Story with open threads, archive coverage, and the jump to an unarchived message](docs/media/31-story.png?v=2.1.4-guide)
![The chat-message book menu with start and end actions](docs/media/32-message-menu.png?v=2.1.4-guide)
![Archive with range, Ledger, and Tidy controls](docs/media/01-archive-overview.png?v=2.1.4-guide)
![The selected range and combined archive actions](docs/media/02-message-range.png?v=2.1.4-guide)
![A combined review of summaries, memories, and a tracker](docs/media/03-combined-review.png?v=2.1.4-guide)
![Ledger after saving the first four messages](docs/media/58-first-ledger.png?v=2.1.4-guide)
![Archive Ledger after an Archive thoroughly run](docs/media/04-ledger.png?v=2.1.4-guide)

[Watch Archive thoroughly (MP4)](docs/media/range-walkthrough.mp4?v=2.1.4-guide)

![Five steps for choosing a range, reviewing the results, and checking the Ledger](docs/media/range-walkthrough.gif?v=2.1.4-guide)

</details>

## Give characters their own memories

A **scene summary** records what happened. A **character memory** records what one character learned, witnessed, suspected, or was told. If only Mira saw the note, Seraphina has to find out the old-fashioned way.

Under **Characters → Create character memories**, choose what the model should read.

| Read from | Use it when… |
| --- | --- |
| **Chat** | The details are in the original messages, including a scene you haven’t summarized yet. |
| **Archive** | You want to work from saved scenes or specific story units. |
| **Both** | You want the original dialogue with summaries for chronology and context. |

Use an exact message range to fill a gap. **Create memories for my persona** is opt-in. To save one moment while chatting, use **Remember this** from the book menu and select the character. **Character memory browser** lets you read and search their lists, open their timeline, export Markdown, or propose an **AI update** with evidence.

<details>
<summary>Memory extraction, the browser, and Remember this</summary>

![Creating memories from an exact range of chat messages](docs/media/05-memory-source-range.png?v=2.1.4-guide)
![Seraphina’s saved character memories](docs/media/06-memory-browser.png?v=2.1.4-guide)
![Reviewing one character memory from a chat message](docs/media/33-remember-message.png?v=2.1.4-guide)

</details>

### Trackers, secrets, and unfinished business

Under **Characters → Trackers**, choose a template and enable **Keep this one updated**. **Update all enabled** can update the selected trackers in one request when the inputs fit. In **Facts, knowledge and unfinished business**, you can file a promise, deadline, or secret and record who knows it. Use **Knowledge as of a date** to see an earlier recorded learning state.

In **Story → Open threads**, open a source or use **Resolve** on an individual promise or Little Thing. The evidence stays available after resolution. Use **Inspect summary** to edit the saved Open Threads summary as a whole. Pinning an individual thread gives eligible recall priority.

<details>
<summary>Tracker and knowledge controls</summary>

![A relationship tracker and its update options](docs/media/08-trackers.png?v=2.1.4-guide)
![Controls for saving a fact, a secret, or an open promise](docs/media/07-knowledge.png?v=2.1.4-guide)

</details>

### Character diaries

1. Open **Tools → Advanced controls**, then **Characters → Character diaries**.
2. Pick a character. Add a date, exact message range, or style note if you want. **Write a diary** uses chat, the character card, and selected background. Review the first-person entry before saving.
3. When the story moves on, use **Update diary from new chat**. **Condense diary** makes it shorter with the previous version available in History.
4. Find the saved diary in **Library → All records** with the **diary** type filter. Diaries are kept separately from character memories used for recall.

<details>
<summary>Diary walkthrough and review screens</summary>

[Watch the diary walkthrough (MP4)](docs/media/diary-walkthrough.mp4?v=2.1.4-guide)

![Writing, updating, and finding a diary](docs/media/diary-walkthrough.gif?v=2.1.4-guide)
![Diary controls for the character, date, and style](docs/media/09-diary-controls.png?v=2.1.4-guide)
![A first-person diary draft in review](docs/media/10-diary-review.png?v=2.1.4-guide)
![A diary update using later chat](docs/media/11-diary-update.png?v=2.1.4-guide)
![A saved diary in Library](docs/media/13-saved-diary.png?v=2.1.4-guide)
![Diary condensation review with before and after token estimates](docs/media/28-diary-condense.png?v=2.1.4-guide)

</details>

## Find the receipts

- **Library → Timeline** puts a saved scene, its linked memories, and Little Things together. Jump to the original message if it’s available in this chat.
- **Library → All records** searches by text, dates, characters, locations, and types. Use **Sources** for evidence, **Inspect** for the saved text and revisions, or **History** for retired records.
- Under **All records → Search, evidence and continuity**, try **Ask the archive** with a specific question such as “Where did Seraphina put the brass key?” **Evidence used** shows what the model read. If the saved records fall short, Ask can follow up with verified original passages from this chat. **Check this claim** is handy when the model says it’s absolutely sure and you are absolutely suspicious.

**Author locked**, **Preserve exact wording**, and **Keep detailed** protect deliberate wording. **Prioritize in memory budget** gives eligible entries preference. **Exclude this record from injection** leaves a record available for reference. **Save a note** keeps an author note without a model request.

<details>
<summary>Search, evidence, and source links</summary>

[Watch the evidence walkthrough (MP4)](docs/media/evidence-walkthrough.mp4?v=2.1.4-guide)

![How to find a memory and follow it to its evidence](docs/media/evidence-walkthrough.gif?v=2.1.4-guide)
![Timeline with a scene, its memories, and source links](docs/media/37-timeline.png?v=2.1.4-guide)
![All records with search and inspection](docs/media/12-library.png?v=2.1.4-guide)
![Search, archive questions, and continuity checks](docs/media/15-search.png?v=2.1.4-guide)
![An archive answer with its supplied evidence](docs/media/49-verified-answer.png?v=2.1.4-guide)
![The source view with original chat messages](docs/media/27-original-sources.png?v=2.1.4-guide)

</details>

### Little Things

Save the borrowed coat, the coffee order, or the weird detail you absolutely intend to bring up forty messages from now. Go to **Library → Little Things → Add a detail**, or choose **Little Thing** in a message’s **Remember this** menu. Give it a cue someone might say, such as “blue velvet,” and fill in **Who knows** if it’s private.

Reviewed archive and condensation runs can offer suggestions. Approve the ones you want. Little Things live in the archive’s story data and travel with its backup. Scene Recall can send up to four matching details within the reply’s memory budget. **Load next reply** queues a detail for the next eligible reply.

<details>
<summary>Little Things in the Library</summary>

![A small detail with a cue, an audience, and a source link](docs/media/38-little-things.png?v=2.1.4-guide)

</details>

## Shorten something or make a recap

| What you want | What to do |
| --- | --- |
| A shorter version of a saved scene | Select it in Library, then use **Tools → Maintain → Condense story records** and choose **Shorten individual entries**. |
| One recap of scenes that belong together | Select the scenes and choose **Create recap**. The recap gets its own entry with links to the full originals. |
| A shorter character memory list | Use **Tools → Maintain → Character memories → Condense character memories**. **Organize saved memories** is a separate reviewed rewrite. |
| A shorter diary | Use **Characters → Character diaries → Condense diary**. |

The **Token target** is flexible. Use **0** to let the model aim for the shortest faithful wording. The review checks dates, times, quotations, and required structure. Read the comparison for subtler things such as motives, promises, and who did what. If a required detail drops out, Scene Archivist retries with specific feedback. If the retry fails, edit **Archive condense prompt** and choose **Resume**. Your sources are still there.

**Archive condense prompt** applies to individual entries and recaps. Character memories have separate **Shorten character memories prompt** and **Organize existing memories prompt** controls under **Maintain → Character memories**.

### Let the AI suggest recap groups

1. Select entries in **Library**, or enter an inclusive unit range in **Maintain → Condense story records → Recap suggestions**.
2. Optionally add a **Focus** such as “which scenes set up the station escape?” Click **Suggest recap groups**. The model reads the full eligible entries.
3. Click **Review group** to read the source text, change the title, include or remove entries, and check existing recap coverage.
4. Click **Create recap**, then review the proposal and save it. Your source entries stay in Library.

Suggestions survive a reload. If the source text changes or goes missing, an affected recap is marked **Needs review** and excluded from recall and Ask. **Maintain → Repair linked records → Preview repairs** prepares a replacement once the sources are ready. Earlier versions are available in revisions.

<details>
<summary>Condense prompt and recap review</summary>

![Separate controls for shortening entries and creating recaps](docs/media/14-condense-controls.png?v=2.1.4-guide)
![Reviewing which full entries belong in the suggested recap](docs/media/51-recap-suggestions.png?v=2.1.4-guide)

</details>

## Preview the next reply or play a flashback

Open **Preview next reply** from **Story** or **Memory Trail**. With a draft in the chat box, you can see likely matches, the token budget, and reasons other records might stay out. **Load once** and **Skip once** affect the next normal reply. Use the same preview to clear a choice before sending. In a group, pick a speaking card to preview its perspective. The actual reply still uses the speaker SillyTavern chooses, its World Info rules, and the memory budget.

With Scene Recall on, **Start flashback** appears beside the chat box. Pick a story date and look for the date badge. **Change date** moves the cutoff. **Back to present** clears it. You can also use a `Flashback: February 14, 2027` marker on its own line, or an `End flashback`, `Back to present`, `New scene`, or `Scene break` marker to clear it.

The preview reads the draft and recent chat locally. AI Recall, vectors, timed effects, and live World Info can change what loads. When a reply forgets something, open that reply’s **Memory Trail → Find a missing detail** to see if the record or matching lines reached the prompt. **Load next reply** asks for the full text within your budget. A smaller linked recap can still fit when full detail cannot.

On desktop, drag the trail by its title to move it or use **Reset trail position**. On a phone, the same controls for inspecting records live in the bottom sheet.

<details>
<summary>Flashback and next-reply controls in action</summary>

![A flashback date and return controls beside the chat draft](docs/media/52-flashback-controls.png?v=2.1.4-guide)
![The next-reply estimate with Load once, Skip once, and a future record outside the flashback](docs/media/53-next-reply-preview.png?v=2.1.4-guide)
![The desktop Memory Trail with activation reasons and its move and reset controls](docs/media/50-trail-lines.png?v=2.1.4-guide)
![From Story to a dated flashback, the next-reply preview, and the resulting trail](docs/media/workspace-walkthrough.gif?v=2.1.4-guide)

</details>

## Optional settings

- **Story → Choose a workflow** offers **Simple**, **Detailed**, or **Mostly Automatic**. Simple uses local recall options with fewer extra calls. Detailed enables AI Recall and evidence audit advice. Mostly Automatic prepares rolling chat memories for your review. Check what each preset changes before applying.
- **Tools → Settings → Connections & preferences** chooses the archive and helper models. **Current SillyTavern model** follows your active connection. A failed profile stays selected for a retry until you pick a different one. **Check setup** tests attachment, delivery, and budget. The model test buttons each send one short request.
- **Context for archive and memories** can include selected lorebook entries or SillyTavern’s assembled chat context. Use the reference allowance to report overflow or explicitly fit whole entries. A positive helper input or count limit caps requests. **0** uses the selected connection’s available capacity. If a helper connection exposes no context size, the input estimate falls back to 18,000 tokens.
- **Tools → Prompt** sets delivery position and the total injected memory budget. If you choose **Outlet**, add `{{outlet::scene_log}}` to the active preset, or use the name you configured. Depth delivery avoids needing an outlet. **Send relevant complete bullets from activated character lists** can narrow long lists while keeping dates and continuations. Full-detail and protected lists stay whole.
- **Tools → Prompt** also has optional cache-friendly delivery and on-demand memory tools. The tools require a compatible Chat Completion connection with Function Calling. Personal records follow the speaking card’s knowledge scope, including group scope when enabled, and flashback restrictions. **Ask the archive** is for you to research the story.

<details>
<summary>Workflow presets, connections, context, and delivery</summary>

![Workflow presets with a description of Simple](docs/media/47-workflow-presets.png?v=2.1.4-guide)
![Check setup with archive and connection status](docs/media/34-check-setup.png?v=2.1.4-guide)
![Archive and helper connection profiles](docs/media/18-connections.png?v=2.1.4-guide)
![Reference lorebook selection, fitting, and context controls](docs/media/17-reference-context.png?v=2.1.4-guide)
![Automation including rolling memories and combining requests](docs/media/19-automation.png?v=2.1.4-guide)
![Memory budget and activation filters](docs/media/16-loading-budget.png?v=2.1.4-guide)
![World Info delivery position and archive options](docs/media/21-delivery.png?v=2.1.4-guide)
![Archive writing prompt and story unit settings](docs/media/22-prompts.png?v=2.1.4-guide)

</details>

## Sharing, backups, and recovery

**Tools → Maintain → Archive sharing** is for chats that intentionally share one timeline. Enable **Share this archive across chats** in the original chat, then select the same book in the other chat. Pick where to file new summaries. Use one writer at a time when updating a shared archive.

For an alternate timeline, set the policy under **Maintain → Branches**, then use SillyTavern’s **Create Branch** from the original message menu. Earlier verified history or empty private books can follow the branch. A normal chat rename keeps its linked archive and progress.

**Maintain → Backups and restore → Back up this story** saves the books, source links, settings, revisions, and unfinished work. **Restore a story backup** previews the import and creates separate books. Start a fresh run in the restored destination. **Undo** verifies its writes before restoring them.

When a stage fails, **Review ready results** lets you save completed work, and **Retry failed stage** resumes just the failed stage. **Resume or review** brings back a held result. A World Info edit can put a proposal on hold so you can compare the old entry, current entry, and proposed changes. **Discard unfinished job** clears pending proposals. Already saved work stays in the archive.

<details>
<summary>Sharing, branch settings, and an interrupted run</summary>

![Shared archive setup](docs/media/24-sharing.png?v=2.1.4-guide)
![Branch policy and lineage controls](docs/media/23-branches.png?v=2.1.4-guide)
![Backup and restore controls](docs/media/20-backups.png?v=2.1.4-guide)
![A failed tracker stage with retry and review actions](docs/media/29-job-recovery.png?v=2.1.4-guide)
![Reviewing completed results while the failed stage waits for a retry](docs/media/30-review-ready.png?v=2.1.4-guide)

</details>

## Troubleshooting

| What you see | Where to start |
| --- | --- |
| A saved summary never reaches a reply | Run **Story → Check setup**. Check the archive is attached, the entry’s delivery or outlet is configured, and the reply’s Memory Trail shows why it loaded or stayed out. |
| Memories missed a conversation | Use **Chat** or **Both** and select the exact message range. Use an inclusive unit range for archive-only work. |
| The request is too large | Read the token breakdown, reduce reference lore, shorten your selection, or **Split this stage** if offered. Check the capacity of the selected profile. |
| Condense says a detail was dropped | Look for the named date, time, or quotation. Adjust the relevant prompt and **Resume**. Your saved source remains available. |
| A diary has nothing to update | Choose the character with a saved diary and select later messages, or give it an exact range. |
| You need to report a bug | Include the Scene Archivist and SillyTavern versions, the exact error, and the steps to reach it. **Export reviewed diagnostics** previews a report you can check for private information before sharing. |

## Slash commands

| Command | Action |
| --- | --- |
| `/archivist` | Summarize new material into the selected archive. |
| `/archivist-memories` | Create memories using the configured source and scope. |
| `/archivist-condense` | Condense character memory lists. |
| `/archivist-recap` | Show a “Previously on…” recap. |

## Credits

Scene Archivist is made by **Mira**. Thanks to **Mimo433** for sharing a patch for the memory approval deadlock. Scene Archivist’s 1.1.0 fix was developed independently. Thanks to everyone who tried this on a long chat and came back with receipts. [1.1.0 changelog](CHANGELOG.md#110--november-5-2026)

## License

[GNU General Public License v3.0](LICENSE).
