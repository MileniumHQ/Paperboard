# PaperDocs style guide

The contract for every page under `src/docs/`. Where this file and the repo's
`AGENTS.md` disagree, `AGENTS.md` wins.

## The four sections

Each section answers one kind of question. A page belongs to exactly one.

| Section | Path | Reader | Question it answers |
| --- | --- | --- | --- |
| Paperboard | `src/docs/paperboard/` | Someone running Paperboard | How do I install, connect, and look after it? |
| Guides | `src/docs/guides/` | A developer making a panel | How do I build a good panel, start to finish? |
| PaperAPI | `src/docs/paperapi/` | A developer mid-build | What exactly does this API take and return? |
| PaperUI | `src/docs/paperui/` | A developer mid-build | What exactly does this component or token do? |

Guides teach and explain. PaperAPI and PaperUI are reference: complete,
exact, and dull on purpose. A guide links to reference instead of repeating
it; a reference page never stops to teach. When a page starts doing both,
split it.

## Who reads these pages

Two readers, and every page serves both:

- A developer with the repo open in one tab and the docs in the other. They
  want the exact prop, the exact command, and a sample they can paste.
- A coding agent that reads the page once, as text, and then writes a panel
  without opening Paperboard's source. Anything the agent would have to guess
  is a hole in the page.

So every page is self-contained:

- Import paths are written out in full (`@mileniumhq/paperapi`), every time a
  sample starts a file.
- Types are spelled out where they are used. A signature that returns
  `SecretResult` also shows what `SecretResult` is.
- Commands are complete and runnable from a stated directory.
- Limits, errors, and defaults are stated, not implied.
- No "see the source", "check the code", or "see the example panel" as the
  only answer. Link to a source file as extra reading, never as the
  explanation.

## Accuracy

The old docs were wrong in places. Treat nothing as true because a doc said
it.

- Every fact comes from the source or from running the thing. Read the
  implementation, not only its types: a parameter can exist and be ignored.
- Unknown behavior is not documented behavior. If you cannot verify it,
  leave it out. Silence is more honest than a wrong claim.
- Document current behavior only. No changelogs, no "previously", no
  "coming soon", no roadmap.
- No unenforced promises. A prop that nothing reads is not a feature.
- Security claims (encrypted, isolated, private) are stated only when the
  code does exactly that, and say what it protects against.

## Voice

- Second person, present tense, active voice. "Pass a variant", never "a
  variant can be passed".
- Imperative for instructions, declarative for facts.
- Statements, not questions. Never open a page or a section with a question.
- One idea per sentence. If a sentence needs a second comma to survive,
  split it.
- Headings in sentence case: `Color variants`, not `Color Variants`.
- Fixed terms: "panel", "prop" (never "property" or "attribute"),
  "variant", "Paperboard" (never "the platform"), "Paperboard server daemon"
  in prose (`papercrane` only as the binary or code name), "Panel Library"
  for the in-app library.
- Paperboard section only: write for someone who is not a programmer. Name
  the button they press, not the function it calls.

## Hard bans

No exceptions, no "this once".

Punctuation, banned everywhere including code samples:

- Em dashes and en dashes (`—`, `–`). Use a period, a comma, a colon, or
  parentheses.
- The ellipsis character (`…`).

Punctuation, banned in prose:

- Exclamation marks.
- Trailing `...`.

Words and phrases, banned in prose (case-insensitive):

- Intensifiers: `very`, `really`, `extremely`, `highly`, `incredibly`,
  `significantly`, `dramatically`, `vastly`.
- Praise and marketing: `powerful`, `robust`, `seamless`, `elegant`,
  `beautiful`, `blazing`, `cutting-edge`, `modern`, `lightning-fast`,
  `game-changer`, `supercharge`, `unlock`, `elevate`, `empower`,
  `streamline`, `holistic`, `vibrant`.
- Filler and hedging: `simply`, `just`, `easily`, `effortless`,
  `comprehensive`, `various`, `myriad`, `plethora`, `and more`, `etc.`,
  `arguably`, `notably`, `importantly`, `crucial`, `pivotal`, `vital`.
- AI tells: `delve`, `leverage`, `utilize`, `realm`, `landscape`,
  `tapestry`, `testament`, `foster`, `showcase`, `boast`, `journey`,
  `embark`, `navigating`, `in today's`.
- Dodges: `in order to` (write `to`), `it's worth noting`, `note that`,
  `please`, `as mentioned`, `as you can see`, `let's`, `whether you're ...
  or ...`, `in this section`, `this page covers`, `allows you to`,
  `enables you to`.

Never state that something is good. Show what it does and what changes when
you use it; the reader judges. A caveat is not a paragraph starting with
`Note:`. It is a fact, stated in the section about the thing it qualifies.

## Page shapes

Every page:

- Uses real HTML structure, because search engines and the Markdown export
  read it: `<PaperText preset="header" as="h1">` once, section headings
  `preset="subheader" as="h2"`, sub-sections `preset="title" as="h3"`, and
  paragraphs `preset="body" as="p"`. The build fails on a page without
  exactly one `h1` or without a lead paragraph.
- Starts with that `h1`: the export name on reference pages
  (`PaperButton`, `secretsApi`), the page name elsewhere.
- Follows it with the lead: one paragraph, two to four sentences, saying
  what this is and when to reach for it. The first sentence is under 160
  characters and stands alone: the build uses it as the page's search
  description and the summary agents read first.
- Gives every section heading a kebab-case `id`. The table of contents and
  the agent text export are built from those ids.
- Ends on a fact, a next step, or a link to the next page. Never a summary
  of what the reader just read.

Reference page (PaperAPI, PaperUI), in this order:

1. Lead.
2. Usage: the smallest complete sample, with its imports.
3. API: every prop, method, or field in a table with name, type, default,
   and what changes. "No default" is a default; say it.
4. Behavior: events, errors and when they throw, limits, accessibility.
5. Examples: the common real cases, most common first.

Guide page:

1. Lead: what you will have at the end.
2. Before you start: what must already be true, linked.
3. Steps or sections, each one a thing the reader does, with the result
   they should see.
4. Next: the page that naturally follows.

A tutorial (`guides/first-panel`) is run start to finish by someone with
nothing but the prerequisites. Every step is tested by following it.

## Code samples

- Every sample compiles against the current packages. No pseudocode, no
  `...`, no invented names.
- Inline identifiers (props, values, paths, events) go in `<PaperCode>`.
  Multi-line samples go in `<PaperCode block language="tsx">` (or `sh`,
  `json`).
- Samples follow `AGENTS.md`: PaperUI components and props, no inline
  styles, no raw `var(--paper-...)` (use `getVarCss()`), errors shown to the
  user, no placeholder fallbacks. A sample is copied more often than the
  prose is read, so it carries the rules.
- PaperUI demo text is generic: a button says `Button`, a setting says
  `Enabled`. When variants need telling apart, use the variant name.
  Guides may use a realistic example panel, and keep the same one across
  the guide.
- A live demo sits inside a card (`<PaperCard data-docs-demo>`) that sets it
  off from the prose. A demo straight on the page background is a defect.
  `data-docs-demo` keeps the demo's rendered markup out of the Markdown
  export, so every demo is followed by its sample: the sample is what agents
  see. The sample matches the demo exactly.
- Tables, lists (`PaperTextList`), links (`PaperLink`), and code export
  cleanly. Content drawn on a canvas or only shown on hover does not export;
  say it in text too.

## Links

- Link to another docs page with its full path from the site root:
  `/docs/paperapi/secrets/`. Use `PaperLink`.
- Link the first mention of an API or component on a page to its
  reference page.

## Adding a page

1. Add the page to `src/docs/<section>/pages.json` under its subsection,
   with `name` and `index`. The key is the URL slug.
2. Create `src/docs/<section>/<subsection>/<key>.tsx` (or the file named by
   `file`) with a default-exported component.
3. Run the self-check below, build (`bun run build` in `apps/paperdocs`),
   and read both the page and its Markdown export
   (`dist/docs/<section>/<key>.md`).

## What the build publishes for agents

- `/docs/<section>/<key>.md`: each page as Markdown, linked from the page's
  `<link rel="alternate" type="text/markdown">`.
- `/llms.txt`: every page with its description, grouped by section.
- `/llms-full.txt`: every page in one file.

The page description (meta tags, `llms.txt`, search results) is the first
sentence of the lead. A first sentence over 200 characters fails the build.

`src/docs/sections.json` holds the four sections. A new section also needs
an import in `src/docs/docsIndex.ts`.

## Self-check

Run both from the repo root before calling a page done. Both print nothing
when the docs pass:

```bash
grep -rnE "—|–|…" apps/paperdocs/src/docs --include=*.tsx
```

```bash
grep -rniE "\b(very|really|extremely|highly|incredibly|significantly|dramatically|vastly|powerful|robust|seamless(ly)?|elegant(ly)?|beautiful(ly)?|blazing|cutting-edge|modern|lightning-fast|game-changer|supercharge|unlock|elevate|empower|streamline|holistic|vibrant|simply|just|easily|effortless(ly)?|comprehensive|various|myriad|plethora|and more|etc\.|arguably|notably|importantly|crucial|pivotal|vital|delve|leverag(e|ing)|utilize|realm|landscape|tapestry|testament|foster|showcase|boast|journey|embark|navigating|in today's|in order to|it's worth noting|note that|please|as mentioned|as you can see|let's|in this section|this page covers|allows you to|enables you to)\b" apps/paperdocs/src/docs --include=*.tsx
```

The word check hits code too. A hit inside a sample is still a hit: rename
the sample string. `!` in real code (`!==`, `!ok`) is fine.
