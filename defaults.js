// Default text used by the extension. All of it is editable in the settings panel.

export const DEFAULT_PROMPT = `PAUSE THE ROLEPLAY. TIME TO SUMMARIZE.

You are CONTINUING an existing Scene Log. Never reprint it. Output only:
1. The new Day entry (or entries) for events since the last summary.
2. Updated Open Threads, Relationship State, Faction State, Character State and World State, each in full.

If no Scene Log is provided, output the full log from Day 1.

# SCENE ARCHIVIST

You are a continuity archivist for an ongoing story. Your output will be read by a future AI with no prior memory. Write only what it needs to continue without contradiction. Omit out-of-character chatter, but apply explicit user corrections and retcons as canon instructions.

**ADD-ONLY:** Never rewrite, delete, or renumber existing entries. Only append or insert retroactively.

---

# PRE-PROCESSING: MANDATORY, SILENT, BEFORE ANY OUTPUT

Run in this exact order:

1. Scan for all past/off-screen events in dialogue, memory, or narration.
2. Assign each a real calendar date. Unknown → \`Day ?\`.
3. Sort ALL events into true calendar order, including retroactive ones.
   Example: RP starts July 19th. A revealed event from July 15th slots BEFORE Day 1, not beside the day it was mentioned.
4. Existing Day numbers never change. Retroactive entries insert between them.
5. Identify all open threads, faction states, and character state changes globally.

No output until all five steps are complete.

---

# FLAGS

Use inline, first occurrence per Day only. Drop when independently confirmed.

- \`⚡\`: persistent state change (health, allegiance, relationship, residence, finances, identity, operational status)
- \`🔓\`: secret revealed or new information surfaced
- \`🗣️\`: spoken claim, unverified
- \`💭\`: internal belief, unconfirmed
- \`[A knows / B doesn't]\`: only when the asymmetry will affect future action

---

# RULES

## Names
- **Full Form** → Day headers and character blocks only
- **Bullet Form** (short, stable) → everything else
- Fixed once assigned. Unknown identity → neutral descriptor. Never rename after reveal.

## Time
Forbidden in bullets: \`then\`, \`later\`, \`next\`, \`afterward\`, \`subsequently\`.
Time moves only via \`📍\` location headers or new Day entries.

## Bullets
- One bullet = one consequential beat or tightly linked cluster in the same scene
- No cross-scene merging
- Non-bullet lines: \`##\`, \`►\`, \`📍\` only
- Merge only if: same location + same time block + same participants + same informational domain

## Banter
First pass: extract any beat that shifts a relationship, reveals motivation or history, introduces/resolves a thread, or produces a decision → own bullet.
Second pass: remaining exchanges: \`- [~N lines] banter: [topic ≤6 words].\`
No tone or emotion in banter lines. One bullet per topic block.

## Time Skips
\`► Time skip (Day A → Day B) — [one line].\`
Expand to full Day entry only if the skip contains a state change, a consequential decision, or an event referenced later. Otherwise the \`►\` line is the entry.
If a character stated an intention at the end of the prior Day (e.g. "I'll read her files"), and the skip covers that action, note the outcome in the skip summary, it has continuity consequences even if uneventful.

## Retroactive Events
When a past event is revealed:
1. Create a Day entry at its true calendar date, before Day 1 if necessary.
2. Header: \`## ► Day N — [date] 🔙 (revealed via [Bullet Form], Day X)\`
3. Each bullet tagged: \`[via [Bullet Form]'s recollection]\`
4. One summary bullet added on the source Day: \`[Bullet Form] recalled [event].\`
Never embed retroactive events inside narration only.

## Dates
Infer with evidence only. Otherwise: \`## ► Day ? — Unknown Date\`. Never fabricate.

## Empty Sections
If a section has no content, do not write the header. No placeholder text.

---

# OUTPUT STRUCTURE

\`\`\`
=== Scene Log ===

# ► STORY EPOCH: Day 1 = [date]

## ► Day [N] — [date] [🔙 if retroactive]

► Main: [Full Form, Full Form]
► Secondary: [Full Form, role]

📍 [time or "Unknown time"] · [named location or "Unknown location"]

- Never combine "Unknown" with a named place in the same field. If location is known, name it. If time is unknown, write "Unknown time". Never write "Unknown · SHIELD HQ", that is a contradiction.

(repeat for all Days in calendar order)

---

## ► Open Threads

- [Thread label]: status · last development · what's at stake

## ► Relationship State

- [Name] / [Name]: current dynamic · any shift this session

## ► Faction State

- [Faction]: allegiance · current stance toward main characters

## ► Character State

- [Name]: persistent changes only: what they now hold · what they are actively doing · what has been revealed about them
- Facts only. No mood, tone, or evaluation (e.g. NOT "triumphant" or "sleep-deprived"; YES "holds covert recording" or "has not slept since Day 3")

## ► World State

- canon deviation or established world fact relevant to future scenes

=== End Scene Log ===
\`\`\`

**Global sections** (Open Threads onward): appear once at the end, cumulative across all sessions, latest known state only. Rank Open Threads by urgency: most pressing first.

---

# TOKEN BUDGET

Cut in order: filler actions → adjectives → unchanged state entries

Never cut: major events · state changes · reveals · retroactive entries · open threads

---

# CONFLICTS & AUTHORITY

Explicit user corrections and retcons override earlier summaries. Update affected state sections and identify the correction. New events may change an earlier state; record that change. For a genuine unresolved contradiction, preserve both accounts with their sources and add one conflict bullet for review. Never treat an earlier summary as automatically authoritative, and never silently resolve uncertainty.

Precedence: Conflicts → Retroactive Events → Chronology → Naming → Flags → Compression
`;

export const DEFAULT_LEGEND = `## ► Legend

- \`⚡\`: a persistent state change (health, allegiance, relationship, residence, finances, identity, operational status)
- \`🔓\`: a secret revealed or new information surfaced
- \`🗣️\`: a spoken claim, unverified
- \`💭\`: an internal belief, unconfirmed
- \`[A knows / B doesn't]\`: an information asymmetry between characters that bears on future action
- \`🔙\`: a retroactive entry, an event that happened before the point it was revealed, placed at its true calendar date
- \`📍\`: the time and location of a scene within a Day
- \`[via ...]\`: the source of secondhand information (a character's recollection, a file, a briefing)
- \`[~N lines] banter: ...\`: a compressed exchange with no lasting consequence`;

export const DEFAULT_OPENING = `<Scene_Log>

Running record of the roleplay so far. The Legend explains the flags. Older Days and retroactive (🔙) entries appear only when relevant to the current scene; the sections after the Days always apply.`;

export const DEFAULT_MEMORY_PROMPT = `You extract CHARACTER MEMORIES from a roleplay's Scene Log. A memory is something a specific character knows, believes or remembers because they were present, were told, or worked it out. Another AI will later play these characters and must not let them know things they have no way of knowing.

For each character who has at least one meaningful memory in the excerpt, write natural third-person memories of consequential experiences. Keep related details together when they belong to the same scene. Use the sentences needed to preserve what happened and how the character learned it: witnessed, was told by someone, concluded, or believes (unconfirmed).

Rules:
- Only include what that character could know. Never copy another character's private knowledge, secrets or thoughts into their memories.
- Do not write memories for {{user}}, who is played by the human.
- Skip trivia and banter. Keep promises, debts, grudges, secrets held, relationship shifts and anything that should change how the character acts later.
- Keep what a character is hiding, and from whom, as its own memory.
- Read the entire excerpt. Keep every consequential memory, including promises, deadlines, changes and important causes. Merge genuinely repeated meaning; never omit events just to meet a count.
- Start every memory with its Day tag, for example "[Day 4] ".
- Use each character's most common short name as "name". Put other names people call them in "aliases".

Return only JSON in this shape. The names and text below are placeholders that only show the format, so never copy them into your answer:
{"characters":[{"name":"<character name>","aliases":["<other name>"],"memories":["[Day 4] <what they know and how>"]}]}

If nobody has a meaningful memory in the excerpt, return {"characters":[]}.`;

export const DEFAULT_CONDENSE_PROMPT = `You tidy one character's memory list from a roleplay. Merge duplicates and near-duplicates, and fold a sequence of small related memories into one clear memory, so the list is shorter without losing anything that affects how the character behaves later.

Rules:
- Never invent facts, and never add anything that is not already in the list.
- Keep who knows what and how: witnessed, was told by someone, concluded, believes (unconfirmed).
- Keep every Day tag exactly as written, calendar date included. When memories from several Days are merged, use a range such as "[Days 4-9, <first date> to <last date>]".
- Keep promises, debts, grudges, secrets held and relationship shifts. Drop only what is repeated or trivial.
- Keep memories readable and concrete. Several related sentences are allowed; do not turn them into cryptic shorthand or jargon.

Return only JSON in this shape. The text below is a placeholder that only shows the format, so never copy it into your answer:
{"memories":["[Day 4, <date>] <memory>","[Days 5-9, <first date> to <last date>] <merged memory>"]}`;

export const DEFAULT_PROMPT_KEY_EVENTS = `PAUSE THE ROLEPLAY. SUMMARIZE WHAT HAPPENED.

You are CONTINUING an existing story log. Never reprint it. Output only:
1. One entry for each story day covered by the transcript, in order.
2. An updated "## ► Open Threads" section, in full.

If no log is provided, start at Day 1 and begin with a line "# ► STORY EPOCH: Day 1 = [date]".

Write for a future reader with no memory of the story. Keep only what they need to continue without contradicting it: decisions, reveals, changes in relationships or circumstances, promises, injuries, who knows what, and where everyone stands at the end of the day.

Format for each day:

## ► Day [N] — [Weekday, Month D, YYYY]

📍 [time] · [place]

- [one consequential event per bullet, past tense, full names on first mention]

Rules:
- Continue the Day numbers from the last Day in the log. If a date is unknown write "## ► Day [N] — Unknown Date". Never invent a date.
- Skip filler, greetings and banter with no consequence. Keep dialogue only when the exact words matter, and quote it briefly.
- Do not describe thoughts or moods. State facts, and mark anything unconfirmed as "(unconfirmed)".
- Omit anything out of character (OOC).

Open Threads format:

## ► Open Threads

- [Thread]: status · latest development · what is at stake`;

export const BUILTIN_PROMPTS = [
    { id: 'scenelog', name: 'Scene Log: Days (with states)', builtin: true, unit: 'Day' },
    { id: 'episodes', name: 'Scene Log: Episodes (with states)', builtin: true, unit: 'Episode' },
    { id: 'chapters', name: 'Scene Log: Chapters (with states)', builtin: true, unit: 'Chapter' },
    { id: 'sessions', name: 'Scene Log: Sessions (with states)', builtin: true, unit: 'Session' },
    { id: 'keyevents', name: 'Key events (light)', builtin: true },
];

export const DEFAULT_AVOID = ''; // your user and character names are excluded automatically; add more here, comma separated

export const DEFAULT_ASK_PROMPT = `ASK THE ARCHIVE. You answer questions about a roleplay using only the Scene Log you are given. Name the Day (or Episode, Chapter and so on) each fact comes from. If the log does not say, answer "The log does not say" and mention the nearest thing it does say. Keep it short and plain.`;

export const DEFAULT_RECAP_PROMPT = `PREVIOUSLY ON. Write a short "previously on" recap of the most recent events in the Scene Log excerpt, in 120 to 180 words of flowing prose, present tense, like the opening of a TV episode. Lead with what matters most for the next scene and end on the biggest unresolved thread. No headings and no bullet points.`;

// Trackers are extra always-on notes that are rewritten after each archive. The request wrapper adds the rules.
export const TRACKER_TEMPLATES = [
    { id: 'relationships', name: 'Relationships', prompt: 'Track the relationships that matter. One bullet per pair or group: "Name and Name: where they stand, trust, tension, last notable moment (with its Day)". Skip pairs that have not interacted.' },
    { id: 'promises', name: 'Promises and deadlines', prompt: 'Track promises made, plans, appointments and deadlines that are still open. One bullet each: what, who, when (calendar date if known) and its status.' },
    { id: 'secrets', name: 'Secrets and who knows', prompt: 'Track secrets and information gaps. One bullet each: the secret, who knows it, who does not, and what happens if it comes out.' },
    { id: 'items', name: 'Items and condition', prompt: 'Track important items, money and vehicles, plus each main character\'s injuries and physical condition. Group bullets by character or item and note the Day it last changed.' },
    { id: 'whereabouts', name: 'Where everyone is', prompt: 'For each main character, one bullet: current location, what they are doing, and where they are headed next.' },
];

export const DEFAULT_SETTINGS = {
    lorebook: '',
    storyBooks: {},
    delivery: 'depth',
    depth: 4,
    role: 0,
    outlet: 'scene_log',
    keepDays: 3,
    sticky: 0,
    unit: 'Day',
    autoArchive: false,
    trackers: TRACKER_TEMPLATES.map(t => ({ ...t, enabled: false })),
    trackerDays: 3,
    trackerAuto: false,
    askPrompt: DEFAULT_ASK_PROMPT,
    recapPrompt: DEFAULT_RECAP_PROMPT,
    scanDepth: 4,
    keyMode: 'ai',
    review: true,
    appendLog: false,
    maxTokens: 0,
    avoid: DEFAULT_AVOID,
    prompt: DEFAULT_PROMPT,
    legend: DEFAULT_LEGEND,
    opening: DEFAULT_OPENING,
    archiveMode: 'isolated',
    chunkTokens: 12000,
    keepVisible: 10,
    hideArchived: false,
    promptLibrary: [],
    promptId: 'scenelog',
    sideProfile: '',
    condenseAbove: 12,
    condensePrompt: DEFAULT_CONDENSE_PROMPT,
    remindEvery: 0,
    memoryPrompt: DEFAULT_MEMORY_PROMPT,
    memoryTarget: 'separate',
    memoryBook: '',
    memoryFrom: '',
    memoryTo: '',
    memoryDays: 4,
    memoryCap: 30,
    memoryAuto: false,
    memoryProgress: {},
    recall: false,
    recallMessages: 4,
    recallMax: 4,
};

// Earlier default texts. Anyone still on one of these gets the current default; edited prompts are never touched.
export const LEGACY_MEMORY_PROMPTS = ["You extract CHARACTER MEMORIES from a roleplay's Scene Log. A memory is something a specific character knows, believes or remembers because they were present, were told, or worked it out. Another AI will later play these characters and must not let them know things they have no way of knowing.\n\nFor each character who has at least one meaningful memory in the excerpt, write memories as short third-person sentences (under 35 words) that say what the character knows and how: witnessed, was told by someone, concluded, or believes (unconfirmed).\n\nRules:\n- Only include what that character could know. Never copy another character's private knowledge, secrets or thoughts into their memories.\n- Do not write memories for {{user}}, who is played by the human.\n- Skip trivia and banter. Keep promises, debts, grudges, secrets held, relationship shifts and anything that should change how the character acts later.\n- At most 8 memories per character. Fewer is better.\n- Start every memory with its Day tag, for example \"[Day 4] \".\n- Use each character's most common short name as \"name\". Put other names people call them in \"aliases\".\n\nReturn only JSON in exactly this shape:\n{\"characters\":[{\"name\":\"Name\",\"aliases\":[\"Other name\"],\"memories\":[\"[Day 4] ...\"]}]}", "You extract CHARACTER MEMORIES from a roleplay's Scene Log. A memory is something a specific character knows, believes or remembers because they were present, were told, or worked it out. Another AI will later play these characters and must not let them know things they have no way of knowing.\n\nFor each character who has at least one meaningful memory in the excerpt, write memories as short third-person sentences (under 35 words) that say what the character knows and how: witnessed, was told by someone, concluded, or believes (unconfirmed).\n\nRules:\n- Only include what that character could know. Never copy another character's private knowledge, secrets or thoughts into their memories.\n- Do not write memories for {{user}}, who is played by the human.\n- Skip trivia and banter. Keep promises, debts, grudges, secrets held, relationship shifts and anything that should change how the character acts later.\n- At most 8 memories per character. Fewer is better.\n- Start every memory with its Day tag, for example \"[Day 4] \".\n- Use each character's most common short name as \"name\". Put other names people call them in \"aliases\".\n\nReturn only JSON in this shape. The names and text below are placeholders that only show the format, so never copy them into your answer:\n{\"characters\":[{\"name\":\"<character name>\",\"aliases\":[\"<other name>\"],\"memories\":[\"[Day 4] <what they know and how>\"]}]}\n\nIf nobody has a meaningful memory in the excerpt, return {\"characters\":[]}."];
export const LEGACY_CONDENSE_PROMPTS = ["You tidy one character's memory list from a roleplay. Merge duplicates and near-duplicates, and fold a sequence of small related memories into one clear memory, so the list is shorter without losing anything that affects how the character behaves later.\n\nRules:\n- Never invent facts, and never add anything that is not already in the list.\n- Keep who knows what and how: witnessed, was told by someone, concluded, believes (unconfirmed).\n- Keep every Day tag. When memories from several Days are merged, use a range such as \"[Day 4-9]\".\n- Keep promises, debts, grudges, secrets held and relationship shifts. Drop only what is repeated or trivial.\n- Keep each memory under 40 words.\n\nReturn only JSON in exactly this shape:\n{\"memories\":[\"[Day 4] ...\",\"[Day 5-9] ...\"]}", "You tidy one character's memory list from a roleplay. Merge duplicates and near-duplicates, and fold a sequence of small related memories into one clear memory, so the list is shorter without losing anything that affects how the character behaves later.\n\nRules:\n- Never invent facts, and never add anything that is not already in the list.\n- Keep who knows what and how: witnessed, was told by someone, concluded, believes (unconfirmed).\n- Keep every Day tag. When memories from several Days are merged, use a range such as \"[Day 4-9]\".\n- Keep promises, debts, grudges, secrets held and relationship shifts. Drop only what is repeated or trivial.\n- Keep each memory under 40 words.\n\nReturn only JSON in this shape. The text below is a placeholder that only shows the format, so never copy it into your answer:\n{\"memories\":[\"[Day 4] <memory>\",\"[Day 5-9] <merged memory>\"]}"];

// Exact prior defaults migrate; user-edited prompts are preserved.
LEGACY_MEMORY_PROMPTS.push("You extract CHARACTER MEMORIES from a roleplay's Scene Log. A memory is something a specific character knows, believes or remembers because they were present, were told, or worked it out. Another AI will later play these characters and must not let them know things they have no way of knowing.\n\nFor each character who has at least one meaningful memory in the excerpt, write memories as short third-person sentences (one fact, or two closely linked ones, under 30 words) that say what the character knows and how: witnessed, was told by someone, concluded, or believes (unconfirmed).\n\nRules:\n- Only include what that character could know. Never copy another character's private knowledge, secrets or thoughts into their memories.\n- Do not write memories for {{user}}, who is played by the human.\n- Skip trivia and banter. Keep promises, debts, grudges, secrets held, relationship shifts and anything that should change how the character acts later.\n- Keep what a character is hiding, and from whom, as its own memory.\n- At most 8 memories per character. Fewer is better.\n- Start every memory with its Day tag, for example \"[Day 4] \".\n- Use each character's most common short name as \"name\". Put other names people call them in \"aliases\".\n\nReturn only JSON in this shape. The names and text below are placeholders that only show the format, so never copy them into your answer:\n{\"characters\":[{\"name\":\"<character name>\",\"aliases\":[\"<other name>\"],\"memories\":[\"[Day 4] <what they know and how>\"]}]}\n\nIf nobody has a meaningful memory in the excerpt, return {\"characters\":[]}.");
LEGACY_CONDENSE_PROMPTS.push("You tidy one character's memory list from a roleplay. Merge duplicates and near-duplicates, and fold a sequence of small related memories into one clear memory, so the list is shorter without losing anything that affects how the character behaves later.\n\nRules:\n- Never invent facts, and never add anything that is not already in the list.\n- Keep who knows what and how: witnessed, was told by someone, concluded, believes (unconfirmed).\n- Keep every Day tag exactly as written, calendar date included. When memories from several Days are merged, use a range such as \"[Days 4-9, <first date> to <last date>]\".\n- Keep promises, debts, grudges, secrets held and relationship shifts. Drop only what is repeated or trivial.\n- Keep each memory under 40 words.\n\nReturn only JSON in this shape. The text below is a placeholder that only shows the format, so never copy it into your answer:\n{\"memories\":[\"[Day 4, <date>] <memory>\",\"[Days 5-9, <first date> to <last date>] <merged memory>\"]}");
