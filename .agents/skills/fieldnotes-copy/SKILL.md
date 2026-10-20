---
name: fieldnotes-copy
description: Rules for user-visible prose in Field Notes (website copy, README prose and docs pages), plus the copy review gate. Use when writing, editing or reviewing headings, buttons, links, captions, facts, docs pages or READMEs, and before a PR that changes such text. Catches generic LLM-sounding copy ("X, not Y" slogans, "everything you need", "blazing fast", hype) and rewrites it in a plain maintainer's voice.
---

# Field Notes copy

Ported from RollKeeper's `rollkeeper-copy` skill; see [../THIRD_PARTY.md](../THIRD_PARTY.md).

Field Notes is an infinite-canvas SDK one person builds with care. Its text should read like a
careful maintainer wrote it for a developer deciding whether to put a board in their app: short,
specific, checkable. It says what the software does and what the reader can do next. It doesn't
advertise, and each line should only make sense for Field Notes.

Scope: website copy (`website/src`, `website/content`), README prose (root and package READMEs)
and docs pages. Code identifiers, code samples, quoted third-party text and CHANGELOG entries are
not copy.

## The four questions

Ask these of every string. One "no" means rewrite.

1. **Is it specific to this page?** It names the real thing here: `addHtmlElement`, the pencil
   tool, pen pressure, a board saved as JSON. Vague nouns such as "content", "tools", "features",
   "solutions" or "your experience" fail.
2. **Would a maintainer write it in a README or PR?** "Saves the board as JSON" yes. "Unlock
   seamless collaboration" no.
3. **Does the reader lose information if it is deleted?** If not, delete it.
4. **Could only Field Notes say it?** A heading or sentence should mention something particular to
   this page or this library. Plain action labels such as Copy or Close are exempt.

Judge a string by what it names. A tight five-word slogan can still fail all four questions.

## Global bans

- Em dashes in prose. Use a full stop, a comma, a colon or parentheses.
- "Not X, but Y" and its variants (see the tells table).
- Rhythm triplets used for rhythm.
- Puffery.
- Rhetorical-question headings.
- Exclamation marks.
- Emoji.

## Voice: one person, on purpose

The site should read as one person's careful work.

- The origin story and roadmap notes are first person singular ("I"), signed "Irakli" (first name
  only).
- Everywhere else, speak plainly about the software. No "we", "our team" or company voice.
- Show the answer to "what if the one maintainer stops?" instead of arguing it: the MIT licence,
  the dated changelog, test and release history, the "Not built yet" list.

## Facts

- Every fact is true for the installable npm release. Don't mention an API that isn't published
  yet; one listed only under `## [Unreleased]` in CHANGELOG.md is not published.
- Every capability mention links to its docs page.
- Every number carries a unit and a source. "Tiny" and "fast" are not numbers. Performance
  numbers appear only with a link to the bench.

## LLM tells to remove

These patterns make copy read as machine-written. Rewrite each one from scratch: swapping a word or
two leaves the pattern in place.

| Tell                           | Looks like                                                                                                                                                | Do instead                                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Contrast slogan                | "A canvas for your app, not a whiteboard product"; "Less X, more Y"; "Not just X, it's Y"; "It's not about X, it's about Y"                               | State what the thing does: "Freehand pens, shapes, sticky notes and live HTML elements on one zoomable board". The "not Y" half carries nothing |
| Everything-promise             | "Everything you need", "all in one place", "right at your fingertips", "comprehensive", "batteries included"                                              | Name the two or three real things                                                                                                               |
| Puffery                        | seamless(ly), effortless(ly), powerful, robust, intuitive, elevate, enhance, unleash, unlock, empower, streamline, supercharge, next-level, game-changing | Delete the word, or replace it with the concrete effect                                                                                         |
| Developer-site filler          | "developer-first", "DX", "blazing fast", "lightweight", "get started in seconds"                                                                          | The measured fact with its unit and source, or the actual steps                                                                                 |
| Claim the code can't back      | "zero-config" unless literally true, "framework-agnostic" without naming frameworks, "production ready", "fastest"                                        | Say exactly what holds: "Vanilla TypeScript. React bindings are a separate package"                                                             |
| Rhetorical question as heading | "Ready to draw?", "Why Field Notes?"                                                                                                                      | A heading that names the section ("Why this exists"), or a verb-first action                                                                    |
| Rhythm triplets                | "Draw, share and sync"; three adjectives in a row                                                                                                         | Keep only items that are real and different; two is fine                                                                                        |
| Hype punctuation               | "!", "…" for drama, emoji, "✨"                                                                                                                           | Full stop or nothing. Ellipsis only for work in progress ("Copying…")                                                                           |
| Success theatre                | "successfully", "Awesome!", "You're all set!"                                                                                                             | Past-tense fact: "Copied"                                                                                                                       |
| Apology and hedging            | "Oops!", "Sorry", "Something went wrong", "It seems", "may have"                                                                                          | Say what happened and what to do                                                                                                                |
| Self-reference                 | "we've got you covered", "our team", "Field Notes empowers you to…"                                                                                       | Say what the package does: "`@fieldnotes/core` saves a board as JSON"                                                                           |
| Filler openers                 | "Welcome to", "Get started by", "Simply", "Just", "Easily"                                                                                                | Start with the action or the noun                                                                                                               |
| Title Case and shouting        | "Saving And Loading", "NOT BUILT YET", tracked uppercase eyebrow labels                                                                                   | Sentence case: "Saving and loading"                                                                                                             |

## Patterns by element

- **Headings:** nouns or plain statements in sentence case that name the section: "Live HTML on
  the board", "How it compares", "Not built yet". No eyebrow label above them.
- **Buttons and links:** verb first, names the outcome or the destination: "Copy", "Try it in the
  playground", "Open the tabletop scene". Never "Click here", "Learn more" or "Read more".
- **Feedback:** mirror the button's verb in the past tense: "Copy" then "Copied".
- **Docs pages:** the title names the task ("Saving and loading"); the description says in one
  sentence what the reader has at the end. Steps start with a verb. Prose doesn't restate the code
  beside it.
- **Code identifiers:** in code format and spelled as exported: `@fieldnotes/core`,
  `addHtmlElement`, `data-fn-drag`.
- **Comparisons:** name tldraw and Excalidraw plainly. Every claim about them has a source and a
  "checked on" date. Plain-text cells, no ✓/✕ glyphs. A claim nobody can source stays out.
- **Not built yet:** a flat list of missing features, no apology and no promised dates.
- **Errors and empty states** (404, a search with no results): what happened, then what to do.
- **aria-labels and icon buttons:** action plus target: "Copy install command", "Zoom in". Not
  "Button", not "Icon".
- **Alt text:** what the picture shows: "A ruled board with a checklist and a sticky note".
- **Numbers:** digits, with units: "4px", "360px wide", "zoom 100%".

## Field Notes vocabulary

- Use the library's own words: board, viewport (the API object), element, tool, layer, sticky
  note, arrow, HTML element, stroke, pen pressure, undo step.
- Spell other projects the way they do: tldraw, Excalidraw, React, TypeScript, WebSocket, Redis.
- Don't invent cute synonyms ("canvas magic", "smart board") or borrow words the library doesn't
  use ("workspace", "collaboration suite").

## Reviewing copy (the review gate)

A PR that changes website copy, README prose or docs pages gets a copy review before it opens. The
caller lists the files to review. It is a review: report findings, don't silently rewrite.

1. Read each listed file in full, so every string is judged where it appears and in what the
   reader is doing at that moment.
2. Judge it with the four questions, the global bans, the voice rule, the facts rules, the tells
   table and the element patterns. Skip code, quoted third-party text and user-authored content.
3. Report one line per string that needs work, most visible first:
   `file:line — quote — rule — rewrite`.
4. Verdict: **pass** (nothing to change), or **changes needed** with the findings.

Scope rules for the gate:

- Strings this branch introduces: fix them before the PR.
- Existing strings the branch only moved or reformatted: leave them.
- Rewording an existing string, or copy the owner approved in a spec, is a visible change: list it
  separately for the owner's approval.
