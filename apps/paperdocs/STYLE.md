# Writing rules: PaperUI and PaperAPI docs

This file is the contract for prose in `src/docs/paperui/` and
`src/docs/paperapi/`. It does not apply to `src/docs/paperboard/`, which
writes for end users, not developers. Where this file and `AGENTS.md`
disagree, `AGENTS.md` wins.

## Who you are writing for

A developer with the repo open in one tab and the docs in the other. They
want the exact prop, the exact behavior, and a sample they can paste. They
are not browsing. Answer them; do not entertain them.

## Voice

- Second person, present tense, active voice. "Pass a variant", never
  "a variant can be passed" and never "the user should pass".
- Imperative for instructions, declarative for facts.
- Statements, not questions. Never open a page or section with a question.
- One idea per sentence. If a sentence needs a second comma to survive,
  split it.
- Headings in sentence case. `Color variants`, not `Color Variants`.
- Terminology is fixed: "prop", never "property" or "attribute";
  "variant", never "style option"; "Paperboard", never "the platform".

## Hard bans

No exceptions, no "this once".

Punctuation, banned everywhere including code samples:

- Em dashes and en dashes (`—`, `–`). Use a period, a comma, a colon, or
  parentheses.
- The horizontal ellipsis character (`…`).

Punctuation, banned in prose:

- Exclamation marks.
- Trailing `...` in prose sentences.

Words and phrases, banned in prose (case-insensitive):

- Intensifiers: `very`, `really`, `extremely`, `highly`, `incredibly`,
  `significantly`, `dramatically`, `vastly`.
- Praise and marketing: `powerful`, `robust`, `seamless`, `seamlessly`,
  `elegant`, `beautiful`, `blazing`, `cutting-edge`, `modern`,
  `lightning-fast`, `game-changer`, `supercharge`, `unlock`, `elevate`,
  `empower`, `streamline`, `holistic`, `vibrant`.
- Filler and hedging: `simply`, `just`, `easily`, `effortless`,
  `comprehensive`, `various`, `myriad`, `plethora`, `and more`, `etc.`,
  `arguably`, `notably`, `importantly`, `crucial`, `pivotal`, `vital`.
- AI tells: `delve`, `leverage`, `utilize`, `realm`, `landscape`,
  `tapestry`, `testament`, `foster`, `showcase`, `boast`, `journey`,
  `embark`, `navigating`, `in today's`.
- Dodges and filler openings: `in order to` (write `to`), `it's worth
  noting`, `note that`, `please`, `as mentioned`, `as you can see`,
  `let's`, `whether you're ... or ...`, `in this section`, `this page
  covers`.
- Indirection: `allows you to`, `enables you to`. Write what the reader
  does: `set the prop`, `call the method`.

A caveat is not a paragraph starting with `Note:`. A caveat belongs in the
section about the thing it qualifies, stated as a fact.

## Praise is not documentation

Never state that a component is good. Show what it does and what changes
when you use it. "Providing tactile feedback and semantic color variants"
is banned twice over: it praises and it says nothing. The reader decides
whether it is good from the facts.

## Page structure

- One page covers one component, one API surface, or one concept. The file
  name matches the page key in `src/docs/index.json`.
- First element: `<PaperText preset="header">` with the exact export name
  (`PaperButton`), never "The PaperButton component".
- Directly under it: one paragraph, two to four sentences. What it does,
  and when to reach for it. No history, no praise, no roadmap.
- Every section heading carries an `id` in kebab-case. The table of
  contents is built from `id` attributes; a heading without an `id` is
  invisible to it.
- Section order: overview, props and variants, then behavior (events,
  accessibility, limits), then recipes. The most common case comes first.
- The last section is a real fact. A page never trails off.

## Code samples

- Every sample compiles against the current package. No pseudocode, no
  `...`, no placeholder props, no invented component names.
- A sample and the live demo under it must match. When they drift, both
  are wrong.
- Inline identifiers (props, values, file names, events) go in
  `<PaperCode>`. Multi-line samples go in
  `<PaperCode block language="tsx">`.
- Show the full import block once, in the first sample. Later samples omit
  it unless the page covers a second entry point.
- Sample text is generic. A button says `Button`, a checkbox says
  `Checkbox`, a setting says `Enabled`. The demo shows the component, not
  an imaginary product: no `Game server manager`, no `Bot dashboard`, no
  role-played panel content. The component name itself is the neutral
  label; when a variant needs differentiating text, use the variant name
  (`Variant`, `Compact`, `Disabled`).
- Every live demo sits inside a card (`PaperContainer` or `PaperCard`)
  that sets it off from the prose. A demo rendered directly on the page
  background is a defect.

## API facts

- Every documented prop states: name, type, default, and what changes when
  it is set. "No default" is itself a documented default; say it.
- Unknown behavior is not documented behavior. If you do not know the
  default, read the source. Never guess, never generalize from a similar
  component.
- Document current behavior only. No changelogs, no "previously", no
  "will soon", no deprecation notices without an enforcement date.
- No unenforced promises. If a prop exists but nothing dispatches it, it
  is not a feature and does not appear as one.
- Behavior you cannot verify in the running product is marked as
  unverified or left out. Silence is more honest than a wrong claim.

## Self-check

Run both from the repo root before you call a page done. Both must return
nothing:

```bash
grep -rnE "—|–|…" \
  apps/paperdocs/src/docs/paperui \
  apps/paperdocs/src/docs/paperapi
```

```bash
grep -rniE "\b(very|really|extremely|highly|incredibly|significantly|dramatically|vastly|powerful|robust|seamless(ly)?|elegant(ly)?|beautiful(ly)?|blazing|cutting-edge|modern|supercharge|unlock|elevate|empower|streamline|holistic|vibrant|simply|just|easily|effortless(ly)?|comprehensive|various|myriad|plethora|and more|arguably|notably|importantly|crucial|pivotal|vital|delve|leverag(e|ing)|utilize|realm|tapestry|testament|foster|showcase|boast|journey|embark|in today's|in order to|it's worth noting|note that|please|as mentioned|as you can see|let's|allows you to|enables you to)\b" \
  apps/paperdocs/src/docs/paperui \
  apps/paperdocs/src/docs/paperapi
```

The word grep hits prose and code alike. A hit inside a code sample is
still a hit: rename the sample string so it passes. The only characters
that may look like violations are `!` in real code (`!==`, `!disabled`);
those are fine in code and banned in prose.
