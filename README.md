# Scene Archivist 2.1.0

The cleaned 2.1.0 build updates the guide media and keeps developer tools out of the public installation. It includes 2.1.0's precise delivery from long memory lists, verified original-message lookup, optional evidence audits, reference allowances, workflow presets and troubleshooting tools. See the [release notes](https://github.com/AmiBastian/SillyTavern-SceneArchivist/releases/tag/v2.1.0).

<details>
<summary>New controls in 2.1.0</summary>

Choose a workflow from Story. Simple keeps extra recall and audit calls off; Detailed enables those optional checks. Mostly Automatic prepares rolling memories for review.

![Workflow presets with an explanation of the Simple workflow](docs/media/47-workflow-presets.png?v=2.1.0-clean)

Set reference sizes, fitting and memory audits under Tools → Settings. Zero keeps the whole reference selection; a positive allowance can explain overflow or explicitly fit complete entries.

![Reference allowance, fitting policy and optional evidence audit](docs/media/17-reference-context.png?v=2.1.0-clean)

Ask shows the supplied evidence behind an answer and can recover verified original passages when saved notes are insufficient. Memory Trail identifies loaded records and, when excerpt delivery applies, their selected lines.

![Archive answer with its supplied source links](docs/media/49-verified-answer.png?v=2.1.0-clean)

![Current Memory Trail with movement, reset and loaded-record controls](docs/media/50-trail-lines.png?v=2.1.0-clean)

These images use invented records and scripted replies in native SillyTavern 1.19.0. They demonstrate the controls and evidence views, not real-model answer quality.

</details>

**Your story has consequences. Your characters should remember them.**

Scene Archivist is a continuity and memory extension for **SillyTavern**, made by **Mira**. Save scenes, character memories, trackers, and private diaries as editable lorebook entries. Follow a memory back to the original scene, and keep track of who actually learned the secret.

If your characters can hide a body but cannot remember where they had dinner, we have some filing to do.

![Story overview with archive coverage and the Archive thoroughly action](docs/media/31-story.png?v=2.1.0-clean)

[Install](#install-and-make-your-first-archive) · [Archive thoroughly](#archive-thoroughly) · [Characters](#characters) · [Diaries](#character-diaries) · [Library](#library-and-history) · [Condense](#condense-by-tokens) · [Prompt and recall](#prompt-and-recall) · [Settings](#settings-and-connections) · [Sharing and branches](#sharing-and-branches) · [Recovery](#backups-and-job-recovery) · [Commands](#slash-commands)

The guide media has been updated for this cleaned 2.1.0 build, including desktop and mobile Memory Trail. The examples use an invented story about a flooded railway station. Screenshots and walkthroughs were captured in **SillyTavern 1.19.0** with scripted model replies and sample lorebooks. Your theme and model output will look different. See the [changelog](CHANGELOG.md) for version history.

<details>
<summary>Workspace walkthrough</summary>

![Story, the Library timeline, Little Things, and the reply-side Memory Trail](docs/media/workspace-walkthrough.gif?v=2.1.0-clean)

</details>

## Install and make your first archive

1. In SillyTavern, open **Extensions → Install extension**.
2. Paste [https://github.com/AmiBastian/SillyTavern-SceneArchivist](https://github.com/AmiBastian/SillyTavern-SceneArchivist) and leave the branch field at its default.
3. Reload SillyTavern and open a chat. Open the wand menu and choose **Scene Archivist**.
4. Select a lorebook in **Archive → Your archive**, or use **Start here** to create one and preview a short message range.
5. Pick **Summarize this range** for a summary, or **Archive this range thoroughly** to also create memories and update enabled trackers. Read the review, then save the entries you approve.

For an existing installation, use SillyTavern’s extension update control. Before updating an active story, **Tools → Maintain → Backups and restore → Back up this story** saves its books, coverage, revisions, and unfinished job.

**Story**, **Archive**, **Characters**, and **Library** are the everyday workspace. Open **Tools** for Maintain, Prompt and Settings. **Advanced controls** reveals additional sections in place. Your range picks and unfinished jobs stay available. **Help & examples** has a quick start, a worked example, and a searchable button guide. Hover or focus an action for its explanation, or turn on **Show help buttons** to open it separately.

<details>
<summary>Help and mobile view</summary>

![Built-in help and worked example navigation](docs/media/25-help.png?v=2.1.0-clean)

![Archive tab on a narrow screen](docs/media/26-mobile.png?v=2.1.0-clean)

![Message menu and range markers on a phone-sized screen](docs/media/36-mobile-message-menu.png?v=2.1.0-clean)

</details>

## Archive thoroughly

| Action | What it does |
| --- | --- |
| **Summarize new messages** | Summarizes uncovered messages and creates lorebook keywords in the same request when the input fits. |
| **Archive thoroughly** | Runs archive, memories, and any enabled trackers, followed by one review. |
| **Summarize this range** | Summarizes an inclusive selection. Turn on **Also create memories** to include memory extraction in that job. |
| **Archive this range thoroughly** | Runs the enabled stages for the selected scene. |
| **Preview selected messages** | Shows message excerpts so you can check your selection before sending anything to a model. |

Use the small book icon beside a chat message’s edit controls. Choose **Start range here** on the first message and **End range here** on the last. You can also enter both numbers in **Archive → Pick your messages**. Both endpoints are included, and your picks follow the messages when their numbers change. If an endpoint was deleted, choose it again.

The same menu can **Skip when archiving**, **Remember this**, or open a reply’s memory trail. **Suggest scene breaks** gives you possible end points to pick from. Use the newest-message buffer to keep an unfinished scene out of automatic suggestions. **Estimate this run** previews requests and approximate tokens without contacting the model.

![Scene Archivist message menu with range, memory and reply actions](docs/media/32-message-menu.png?v=2.1.0-clean)

Day, Chapter, Episode, Session, Act, Part, Week, Scene, and custom units are available under **Settings → Prompts**.

![Archive layout with Ledger and Tidy side by side](docs/media/01-archive-overview.png?v=2.1.0-clean)

![Inclusive range preview and combined range actions](docs/media/02-message-range.png?v=2.1.0-clean)

Archive thoroughly normally uses one request per stage, up to three when everything fits. **Settings → Optional automation** can combine stages into one request when they use the same profile. If the context is too small, the job shows the problem and offers an explicit split or retry. Review the prepared entries together and approve the ones you want. **Review later** retains the draft.

![Archive, memories, and trackers prepared for one review](docs/media/03-combined-review.png?v=2.1.0-clean)

The **Ledger** shows which ranges are covered. Use **Redo summaries** to replace linked summaries from their original messages, or **Mark unprocessed** to make a range available again. **Hide this range** and **Show this range** control the chat’s visibility separately. **Tidy the shelves** reorders saved entries without an AI rewrite.

![Archive ledger showing the saved range](docs/media/04-ledger.png?v=2.1.0-clean)

![Walkthrough of selecting a range and approving an Archive thoroughly run](docs/media/range-walkthrough.gif?v=2.1.0-clean)

[Watch the range walkthrough in MP4](docs/media/range-walkthrough.mp4?v=2.1.0-clean)

## Characters

### Create and browse memories

| Read from | What the model reads |
| --- | --- |
| **Chat** | Original messages. You can use it before you create an archive summary. |
| **Archive** | Saved scene summaries. |
| **Both** | Original messages as event evidence, with archive units for chronology and background. |

When you create **Chat** memories before choosing an archive, Scene Archivist creates an archive lorebook to link the story. By default, memories go into a separate lorebook and the archive starts empty.

**Scope** can target new material, exact chat messages, an archive unit range, or the last several units. Use an exact selection to fill a gap even if coverage says the surrounding range was processed. **Create memories for my persona** is available in Settings and starts unchecked.

![Memory extraction from an exact chat range](docs/media/05-memory-source-range.png?v=2.1.0-clean)

Select a character in the **Character memory browser** to read or search their lists. **AI update…** lets you propose corrections with chat evidence. **Organize saved memories** is a separate reviewed rewrite. Routine generation adds to existing lists and removes exact repeats. Protected lists are reported and the associated sources remain available for extraction.

![Character memory browser with a saved list](docs/media/06-memory-browser.png?v=2.1.0-clean)

**Character timeline** groups dated memories and opens their evidence. **Export character memories** downloads plain Markdown. **Remember this** on a chat message saves one detail for a chosen character, with optional keywords and a link to that message. The AI polish button is optional.

![Reviewing one memory clipped from a chat message](docs/media/33-remember-message.png?v=2.1.0-clean)

### Trackers, facts, and knowledge

Under **Characters → Trackers**, select a tracker and enable **Keep this one updated**. Use the built-in templates for relationships, promises, secrets, items, or whereabouts, or add your own. **Update all enabled** uses one tracker request when the input fits. Archive thoroughly includes enabled trackers in its final review.

![Relationship tracker and its update controls](docs/media/08-trackers.png?v=2.1.0-clean)

Use **Facts, knowledge and unfinished business** to write or extract who knows, suspects, or is unaware of a fact. **Knowledge as of a date** shows a character’s earlier learning state when one was recorded. The **Character roster** lets you review aliases, merge matching lists, and set destinations. Pin an unresolved thread to give it priority within the memory budget. The recap can know where the body is buried. The cast can keep their secrets.

![Controls for recording secrets, facts, and unresolved promises](docs/media/07-knowledge.png?v=2.1.0-clean)

## Character diaries

1. In **Characters** with **Tools → Advanced controls** enabled, open **Character diaries** and select a character. Optionally enter a story date, an inclusive message range, or a style note.
2. Choose **Write a diary**. The model reads original chat messages, the character card, and attached background lore. Review the first-person text before saving.
3. After the story continues, choose **Update diary from new chat**. The previous diary provides voice and continuity, and later messages supply the new events. An exact range lets you revisit an earlier scene.
4. Use **Condense diary** when the saved text grows too large. The previous version remains in Library history.

Diaries are saved to the archive separately from active character memories. You can find them with the **diary** type filter in Library.

![Write, update, and condense controls for the character diary](docs/media/09-diary-controls.png?v=2.1.0-clean)

![Review a first-person diary before saving](docs/media/10-diary-review.png?v=2.1.0-clean)

<details>
<summary>Updating and finding a saved diary</summary>

![Reviewed diary update based on later chat messages](docs/media/11-diary-update.png?v=2.1.0-clean)

![Saved diary in the Library](docs/media/13-saved-diary.png?v=2.1.0-clean)

</details>

![Walkthrough of writing and updating a diary](docs/media/diary-walkthrough.gif?v=2.1.0-clean)

[Watch the diary walkthrough in MP4](docs/media/diary-walkthrough.mp4?v=2.1.0-clean)

## Library and history

Open **Library → Timeline** to read a saved scene alongside its linked character memories and Little Things. **Jump to** opens the original message when it is available in the current chat. Use **All records** to search by text, date, character, location, or type. **Inspect** shows the text, original message ranges, linked sources, earlier revisions, and protection controls. Turn on **History** to include retired records. Use **Save a note** to keep an author note without making a model request.

- **Author locked**, **Preserve exact wording**, and **Keep detailed** protect deliberate wording from automated rewrites.
- **Prioritize in memory budget** gives an eligible record preference when Scene Archivist trims loaded entries.
- **Exclude this record from injection** keeps it in the book for reference without including it in prompts.
- A source edit is shown beside a proposal when relevant. Existing saved memories remain available after ordinary chat edits, and you can approve prepared work without rebuilding an existing list first.

![Library timeline with a selected scene and links to its evidence](docs/media/37-timeline.png?v=2.1.0-clean)

![All records search and inspection](docs/media/12-library.png?v=2.1.0-clean)

<details>
<summary>Trace a record to its original messages</summary>

Use **Sources** on a Library result. Each source range lists the chat it came from and links to the messages that are still available. A linked recap can lead back to its full original units.

![Original messages linked to the selected archive entry](docs/media/27-original-sources.png?v=2.1.0-clean)

</details>

### Little Things

Run **Archive thoroughly** to have the AI find the borrowed coat, the way someone takes their coffee, or the promise that never made it into the main plot. Reviewed archive and condense runs suggest details in the same model response. Uncheck any suggestions you want to skip, then choose **Save selected**. **Review later** keeps the whole draft.

Find approved details under **Library → Little Things**. To keep something the AI missed, choose **Add a detail** there or choose **Little Thing** in **Remember this** on a chat message. Give it a specific cue someone might actually say. Fill in **Who knows** for private details. Little Things live in the selected archive’s story metadata and travel with full story backups. Each detail adds zero lorebook entries. A branch with verified history keeps only Little Things with matching source messages.

A normal reply can load up to four matching details inside the existing memory budget on SillyTavern versions with the World Info scan hook. Relevant cues and open promises can carry over for a few replies within a scene. **Load next reply** queues a detail for the next eligible speaker. To turn off automatic selection, open **Tools → Prompt** and switch off scene recall.

![Little Things with cues, a source link, and the option to queue a detail](docs/media/38-little-things.png?v=2.1.0-clean)

## Condense by tokens

| What you want shorter | What to choose |
| --- | --- |
| A Day, Chapter, or other archive unit | Select it in **Library**, then choose **Maintain → Condense story records → Shorten individual entries**. |
| A stretch of older units | Select the units in **Library** and choose **Create recap**. The recap keeps links to the full original entries. |
| A character’s memory list | Use **Condense character memories**. Select or protect lists in Library as needed. |
| A saved diary | Choose the character and use **Condense diary**. |

Set a flexible **Token target**, or use **0** for the shortest faithful version. You can keep the same number of entries or memory bullets and still save tokens by tightening their wording. The result checks preserve required headings, dates, times, and exact quotations. Review the diff for decisions, relationship shifts, promises, clues, and other details that matter to your story.

Optional recap automation can suggest or create a recap after newer units, fictional time, or archive token pressure. Choose the automation setting before relying on it. Protected records keep their detailed text.

![Token target and archive condensation modes](docs/media/14-condense-controls.png?v=2.1.0-clean)

![Diary condensation review showing estimated tokens before and after](docs/media/28-diary-condense.png?v=2.1.0-clean)

## Prompt and recall

- Under **Library → All records → Search, evidence and continuity**, **Ask the archive** answers a question with source links. It can select complete dated bullets from long character lists; **Evidence used** shows the supplied text, and source buttons open the saved parent record. Saved list line numbers describe that record, not verified original chat boundaries. **Check this claim** checks one statement, and the recent or whole-archive checks look for conflicts across records.
- If saved evidence is missing or insufficient, Ask can make one follow-up pass with related search wording and hash-verified original passages from the current chat. Original-source buttons jump to the cited messages. Edited, foreign, incomplete or corrected source ranges are excluded; source limits and skipped receipts are reported. Each pass can retry malformed JSON once. No other chat is opened.
- **Previously on…** creates a short return recap for the reader. **Recall** can ask a helper model to pick relevant details before a normal reply.
- In **Story**, open the last reply’s **Memory Trail**. It fits beside the desktop chat when there is enough space, uses SillyTavern’s popup for wider chats, and opens as a bottom sheet on small screens. It follows Moving UI’s chat position. The chat message menu opens the trail for that reply or swipe. The header stays visible as you scroll through World Info matches and Little Things. Open **Prompt delivery** for cache details or **Tools → Prompt** for budget settings.
- On desktop, drag the trail’s title to move it. Focus the title and use arrow keys for keyboard movement. **Reset trail position** or Enter returns it to its default placement. The popup view has a **Move trail** control. The trail follows your ST theme’s colors, transparency and blur, including live theme changes and Fast UI.

For a past scene, put an explicit marker such as `Flashback: February 14, 2027` on its own line in the chat. Scene recall uses the date to leave out managed memories that contain later or undated evidence. A new scene marker or a changed place ends recent cue carryover.

In groups, Scene Archivist loads only the speaking card’s memories by default. Use **Remember this** to choose the exact card when two cards share a name. You can change group memory scope in Prompt. Saving a group memory for a uniquely identified card also gives its lorebook entry a SillyTavern character filter. Existing entries get that filter when edited or regenerated in the group. Filters set by hand in World Info are preserved.

**Cache-friendly delivery** is optional. It puts fixed lore earlier and changing matches near the reply. The memory trail reports an approximate shared prompt prefix between requests. Provider caching depends on the connection. **On-demand memory tools** are experimental and opt-in. They require a tool-capable Chat Completion connection with Function Calling enabled and may add another request. In a solo chat, personal memories and knowledge are restricted to the responding character card. Naming another character or changing the search wording cannot widen that access. Shared facts, threads and saved story units remain available.

Ask and the recall tool keep a selected bullet's date heading, nested notes and continuations together. A document with unfamiliar headings or global prose stays whole. If complete evidence exceeds the allowance, it is omitted or the tool reports that it cannot fit. Recall tools apply speaker and active flashback restrictions to the parent record before selecting excerpts; Ask remains an author-facing search across the story. Normal World Info injection and optional AI Recall still use whole records.

The recall-memory tool accepts up to three alternate search queries for indirect callbacks. All searches retain the same speaker and flashback limits. Raw original passages are available only to author-facing Ask, because a character's saved source range can contain private information they did not learn. Original-source lookup also respects an active Scene Recall flashback cutoff. Legacy records without matching receipts remain searchable as saved text.

**Precise delivery** is an optional control in Tools → Prompt. It sends complete matching bullets from character lists that SillyTavern already activated. Dates and continuations stay together. Protected lists, explicit full-detail requests and semantic-only matches remain whole. The shared memory allowance still applies; Memory Trail records the selected line ranges. Stored lists stay intact. A bullet can depend on wider context, so protect a list or leave this option off when its full context is essential.

AI Recall can select individual excerpts and propose related search wording in its existing pre-reply request. It uses the chosen helper route and configured recall count. Native vector activations reach the shared allocator independently of keyword matches; this does not create a separate semantic index of every bullet.

## Workflow choices and evidence review

In Story, **Choose a workflow** offers Simple, Detailed and Mostly Automatic presets. The dialog explains calls and review behavior before applying. Prompts, routes, references and persona policy stay configured; settings follow the current workflow scope.

- **Simple:** reviewed archive and memories, with local precise delivery and no extra recall or audit requests.
- **Detailed:** AI Recall and evidence-audit advice for extracted memories and shorter proposals. Each audit adds a request. Flagged automatic condensation returns to review.
- **Mostly Automatic:** rolling chat memories after 30 eligible messages with a four-message buffer, and recap suggestions. This requires a chat-based memory source and retains review before saving.

Context settings show approximate reference sizes and offer a separate reference allowance. The default reads the entire selected set; a positive allowance reports overflow. **Relevant complete entries** explicitly permits fitting whole entries and reports omissions. No external lore is rewritten. **Estimate this run** includes reference sizes and enabled memory audits.

Structured memory responses can cite selected message indices or archive source ids for each memory. Inspect → Sources and dependencies and the Sources view retain these links and learning notes. Citations are model supplied and checked against the actual selection; they do not prove every claim is supported. Legacy strings remain supported. Exact current text can reuse its binding; changed or ambiguous text does not inherit an old citation.

Evidence audits report unsupported details, omissions, dates and knowledge boundaries as review advice. If an audit fails, retry just the audit or use **Skip audit and review** to inspect the retained proposal. Source changes invalidate the retained request. The existing Undo journal, revisions and verified writes protect consequential edits.

**Why was this forgotten?** compares saved text with the last retained delivery trace. **Export reviewed diagnostics** previews a report that excludes story text, names, credentials, URLs and raw errors. **Test helper grounding** is an explicit connection check with invented evidence and at most five real requests; passing it is not a general memory-quality score. Its preview explains possible provider charges.

Library results use pages of 100 so older results remain reachable. Search data and token counts are cached with content and metadata checks; tokenizer work is coalesced and limited to six concurrent calls.

![Search and continuity controls](docs/media/15-search.png?v=2.1.0-clean)

![Memory budget and activation source filters](docs/media/16-loading-budget.png?v=2.1.0-clean)

![Memory Trail with cues and evidence alongside SillyTavern chat](docs/media/35-reply-trace.png?v=2.1.0-clean)

![Memory Trail as a bottom sheet on a phone-sized screen](docs/media/39-mobile-trail.png?v=2.1.0-clean)

![Walkthrough of finding a record and its evidence](docs/media/evidence-walkthrough.gif?v=2.1.0-clean)

[Watch the evidence walkthrough in MP4](docs/media/evidence-walkthrough.mp4?v=2.1.0-clean)

## Settings and connections

| Setting | What it controls |
| --- | --- |
| **Archive model** | Connection profile for summary and keyword generation. |
| **Memory and tracker model** | Connection profile for memory, tracker, and diary jobs. |
| **Create memories for my persona** | Includes your played character as a memory subject. Starts off. |
| **Read selected lorebooks for archive and memories** | Includes chosen lorebooks or individual entries as background. Starts off. |
| **Include SillyTavern chat context** | Uses the assembled prompt preview. Starts off. Extensions that inject only during live generation can supply different material. |
| **Prepare rolling memories from chat** | Prepares a review after a chosen number of new messages, with a buffer for the most recent ones. Starts off. |

**Check setup** checks the archive attachment, delivery, budget and optional integrations. Its model test buttons each send one short request on the named connection. **Manage workflow profiles** saves prompts, budgets and delivery for this chat, character or group. Chat profiles take precedence over character and group profiles. Connection profiles are configured separately.

![Scene Archivist setup checks](docs/media/34-check-setup.png?v=2.1.0-clean)

**Current SillyTavern model** uses your live connection. A failed profile can be retried directly, or you can explicitly select **Use current model**. Context checks use the capacity exposed by the configured connection. Custom proxies can apply additional limits.

Helper requests also keep the selected profile after a failure. To change connections, select **Current SillyTavern model** or another available profile in Settings before retrying. The helper connection test names the route it used, and diagnostics include the latest route and request status.

Helper tools such as memory organization and archive search use the helper model’s context with room reserved for the reply. In **Story memory settings**, leave the helper input and count limits at **0** to fit the connection automatically. Set a positive limit to cap a request. If a connection exposes no context size, the automatic helper input estimate is 18,000 tokens.

If an archive or memory stage exceeds its model context, the error lists its largest input parts. Check the figures for reference lorebooks, selected messages, the scene log, instructions, and included SillyTavern chat context. Use the suggested setting to reduce extra context or choose **Split this stage**.

![Optional persona, reference lore, and prompt-preview settings](docs/media/17-reference-context.png?v=2.1.0-clean)

![Archive and memory connection profile selectors](docs/media/18-connections.png?v=2.1.0-clean)

<details>
<summary>Automation, prompts, and lorebook delivery</summary>

**Optional automation** also contains the single-request mode. **Prompts** is where you choose story units and edit prompt presets. **Prompt → Delivery** controls how eligible entries are placed in the prompt. If you use an outlet, add its macro to the relevant preset or prompt.

![Single-request mode and rolling memory controls](docs/media/19-automation.png?v=2.1.0-clean)

![Lorebook delivery controls](docs/media/21-delivery.png?v=2.1.0-clean)

![Archive prompt and story unit settings](docs/media/22-prompts.png?v=2.1.0-clean)

</details>

## Sharing and branches

Open **Maintain → Archive sharing** and enable **Share this archive across chats** in the original chat, then select that book in the other chat. This is for chats that intentionally share one timeline. **Where to file new summaries** can start a new unit, continue an existing unit, or file an earlier event. Each contribution keeps its own source range. Use one writer at a time when updating a shared archive.

Open **Tools → Maintain → Branches** to choose verified earlier history or empty private books. To create the branch, open the original message’s three-dot menu in SillyTavern and choose **Create Branch**. The branch view shows the parent and fork point when available. Later records stay in the parent when the extension cannot verify them as part of the branch.

Renaming a chat in SillyTavern keeps its archive and progress. A native branch or a separate copy of the original chat file gets private books, even when the copied file has the same internal identifier. Use SillyTavern’s **Branch** action to keep lineage easy to follow.

![Archive sharing controls](docs/media/24-sharing.png?v=2.1.0-clean)

![Story branch settings and lineage controls](docs/media/23-branches.png?v=2.1.0-clean)

## Backups and job recovery

**Back up this story** includes books, original source links, revisions, settings, and the unfinished job. **Restore a story backup** previews the import and creates separate books. The historical draft remains available in the backup. Start a fresh run in the restored destination. Workflow presets transfer settings separately from story content. **Copy from another lorebook** lets you review and copy one entry as a clip. Check setup flags possible overlapping memory extensions or books.

If a later stage fails, choose **Review ready results** to save completed work, then **Retry failed stage**. A canceled review can be reopened through the saved job. **Discard unfinished job** clears its pending proposals. **Undo** checks what was written and preserves newer edits it cannot safely reverse.

![Job recovery controls after a failed tracker stage](docs/media/29-job-recovery.png?v=2.1.0-clean)

<details>
<summary>Review prepared work and keep a backup</summary>

![Review of completed stages while a later stage awaits retry](docs/media/30-review-ready.png?v=2.1.0-clean)

![Story backup and restore controls](docs/media/20-backups.png?v=2.1.0-clean)

</details>

## Slash commands

| Command | Action |
| --- | --- |
| `/archivist` | Summarize new material into the selected archive. |
| `/archivist-memories` | Create character memories using the configured source and scope. |
| `/archivist-condense` | Condense character memory lists. |
| `/archivist-recap` | Show a “Previously on…” recap. |

## Troubleshooting

| What you see | What to check |
| --- | --- |
| The model seems unaware of a saved summary | Check **Attach to chat**, delivery position, and any outlet macro. Open **Prompt** or the reply’s memory trail to inspect loading and budget. |
| Memories skip part of the story | Set **Read from** to **Chat** or **Both** and select the exact missing messages. For archive-only work, use a unit range or **Last X units**. |
| A request exceeds the context | Choose a larger context on the selected connection, shorten the selection, or explicitly split the failed stage. |
| A generated entry will not condense | Check its protection flags and the review’s token estimate. A shorter version must preserve the required chronology and quotations. |
| A diary does not update | Check that the character has a saved diary and that later messages exist. An exact range can cover an earlier scene. |
| You need to report a problem | Include the Scene Archivist and SillyTavern versions, steps to reproduce, and the exact error. Keep private story text and credentials out of the report. |

## Credits

For [1.1.0](CHANGELOG.md#110--november-5-2026), thanks to **Mimo433** for sharing a patch for the memory approval deadlock. Scene Archivist’s fix was developed independently. Thanks to everyone who tested ranges, retries and actual long chats and reported where the interface got in the way.

## License

Scene Archivist is available under the [GNU General Public License v3.0](LICENSE).
