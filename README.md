# Scene Archivist 1.1.0

Scene Archivist is a SillyTavern extension by Mira. It saves scene summaries, character memories, trackers, and private diaries as editable lorebook entries. A character can remember how they learned a secret while someone else in the same scene stays unaware.

## Install or update

1. Open **Extensions → Install extension** in SillyTavern.
2. Paste [https://github.com/AmiBastian/SillyTavern-SceneArchivist](https://github.com/AmiBastian/SillyTavern-SceneArchivist). Leave the branch at its default.
3. Reload SillyTavern, open a chat, and choose **Scene Archivist** from the wand menu.
4. Choose or create an archive. In **Archive → Pick your messages**, preview a short range and run it once before trying a long selection.

Use SillyTavern’s extension update control for an existing installation. **Settings → Backups and workflow presets → Export complete story** exports lorebooks, revisions, coverage, settings, and any pending job. Existing jobs keep their original selections and completed steps. The [changelog](CHANGELOG.md) records version changes. [Earlier walkthroughs](https://github.com/AmiBastian/SillyTavern-SceneArchivist/tree/v1.0.8#readme) show the 1.0.8 interface.

## Archive, memories, and trackers

| Action | What it processes |
|---|---|
| **Archive** | Unarchived messages or the selected range. One request generates the summary and lorebook keywords when the input fits. |
| **Create memories** | Character memories from **Chat**, **Archive**, or **Both**. Choose new material, exact messages, a unit range, or the last several units. |
| **Catch up** | Pending summaries, memories, and enabled trackers. Each enabled stage normally uses one request, followed by one combined review. |
| **Catch up this range** | Run those stages for the selected messages. |
| **Update trackers** | Update all enabled trackers together, with a separate result for each. |

Set **Start here / End here** on the chat messages or enter the first and last message numbers. Both endpoints are included. To create memories alongside a range summary, turn on **Also create memories**. Use **Chat** before you have any summaries. With **Both**, original messages supply the events and archive entries supply chronology and background. Author corrections in the scene take precedence.

An exact selection can be reprocessed to fill a gap. The coverage display counts work already processed. Review the text for omissions. Protected memory lists are reported and their inputs remain available for extraction. Routine extraction adds memories while preserving previous lists. **Organize existing memories** is a separate reviewed action.

The extension checks prompt size and the response allowance when the connection exposes a context limit. If a stage exceeds it, choose a larger context or explicitly split the failed stage. Custom proxies can have additional limits. Older auxiliary workflows retain their advanced request limits.

### Models and background lore

- **Archive model** selects a SillyTavern connection profile for summaries. **Memory and tracker model** selects the profile for memories, trackers, and diaries. Choose **Current SillyTavern model** to use the live connection. After a profile failure, use **Retry failed stage** or explicitly choose **Use current model**.
- **Create memories for my persona** is unchecked by default. Enable it to include your played character’s in-story knowledge.
- **Read selected lorebooks for archive and memories** is unchecked by default. Choose whole books or individual entries as background for the current chat.
- **Include SillyTavern chat context** is unchecked by default. This uses SillyTavern’s assembled prompt preview. Extensions that inject only during live generation can supply different context.
- **Optional automation** includes rolling chat memories with a recent-message buffer and a one-request mode for runs whose stages use the same connection profile. The default keeps archive, memories, and trackers independently retryable.

## Review, history, and recovery

Review prepared entries together and approve the ones you want. **Review later** retains the draft. If a later stage fails, **Review ready results** lets you save the prepared entries, then retry just the failed stage. Unchecked proposals stay in the draft.

A change to source messages is shown beside the affected proposal. Previously saved memories remain available after ordinary chat edits. **Library → History** includes retired records. **Inspect** shows original sources, earlier versions, and entry protection. **Undo** compares saved entries before applying a reversal and preserves newer changes.

Source links and record protections are retained in exports. When restoring an export into different lorebooks, its historical draft remains available in the backup for inspection. Start a fresh run in the restored destination.

## Shared archives and branches

To intentionally share one timeline, turn on **Share this archive across chats** in the original chat and select that archive in the other chat. Under **Shared archive filing**, choose **Start a new unit**, **Continue an existing unit**, or **File an earlier event**. Each contribution keeps its own source range. **Redo summaries** is available for replacing existing summaries from the ledger.

A native story branch gets private books with verified earlier history, or empty books if you select that preference. Records that mix verified earlier events with later or unavailable sources stay in the parent. The branch view shows the parent and fork point when available. Keep one writer active at a time when using a shared archive.

## Character diaries

Open **Characters → Character diaries**. Choose a character, optionally enter a date or exact message range, and select **Write diary**. The diary uses original chat messages, the character card, and attached background lore. **Update diary** appends from new messages to the latest diary for that character. The previous diary provides voice and continuity. Diary entries are saved separately from the character’s active memories.

**Condense diary** shortens the saved text. The original stays in revision history.

## Condense and retrieve

- In **Library**, select archive records or memory lists, then use **Condense**. Shorten individual records to preserve their unit boundaries, or create a linked recap to group several records.
- The **Token target** is flexible. Set it to **0** for the shortest faithful version. Shortened entries must preserve their headings, dates, times, and exact quotations. Check the diff for other story details before approval.
- **Search** finds records by content and provenance. SillyTavern’s native lorebook rules govern activation. Scene Archivist’s loading report explains eligible entries and the configured memory budget.

## Development

Run the scripted regression suite with Node 22 or later.

```sh
node --test tests/workflow.test.js
```
