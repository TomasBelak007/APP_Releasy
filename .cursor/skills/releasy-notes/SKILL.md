---
name: releasy-notes
description: >-
  Generate a short, business-facing "Xeelo – Release Notes" Word document (.docx) for a named
  Azure DevOps patch release (e.g. Labe-07.013), pulling tickets live via releasy-ai scripts —
  no markdown export from the user. Use when the user asks for release notes, a release email,
  or a release summary for business stakeholders/customers. Supports combining two products in
  one document (typically Xeelo + XeeloAdmin). Plain language: no ticket IDs, no
  Priority/Severity/T-Shirt values, just Version / Release date / New Features / Bug Fixes /
  Summary. This is DIFFERENT from the longer, detailed release-notes format that lists per-ticket
  [ID] tags and Priority/T-Shirt/Severity summary tables for a dev/support audience — if the
  user's prior release docs in this project use that table format, or they ask for something
  matching that style, use that format instead, not this skill. When in doubt about which style,
  check the most recent similarly-named file in the project folder and match its structure.
---

# releasy-notes

Turns the tickets in a named patch into a short, plain-English release notes document that a
business stakeholder or customer could read without any Xeelo/DevOps background. It has three
jobs: load the live ticket list for the release, turn each ticket into one clear paragraph of
business prose, and produce a .docx that matches an established visual template exactly.

Tickets come from the sibling [releasy-ai](../releasy-ai/SKILL.md) scripts (same PAT in
`releasy-ai/.env`). Do not ask the user for a Markdown export.

## 1. Input

The user names a release (e.g. `Labe-07.013`) and optionally a second product (e.g. "and Xeelo
Admin" / `XeeloAdmin`, optionally with its own version like `Odra-01.008`).

1. Run `node ../releasy-ai/scripts/releasy-config.mjs` (from this folder) for live products,
   `releaseNames`, and `availablePatchVersions`. Never hardcode series/patches.
2. Parse the primary version as `<Release>-<major>.<patch>` (`Labe` + `07` + `013`). Map
   `Release` to a product via `releaseNames` (Xeelo → Labe, XeeloAdmin → Odra, …). If more than
   one product shares that release name, or the user already named a product, use that — never
   guess between two active series.
3. **Second product:** "Xeelo Admin" is `XeeloAdmin` in config. If they did not give its version,
   list that product's live patches and ask which one. If they did (`Odra-01.008`), use it.
4. For each product, run (read-only, no confirmation):

   ```
   node ../releasy-ai/scripts/list-tickets.mjs --product <Product> --release <Release> \
     --major <NN> --patch <NNN> --descriptions --no-tasks
   ```

   Then **drop every item whose `state` is `Removed`**. Keep `Closed` (and every other state) —
   those are the shipped items. Do **not** pass `--open` (that also drops `Closed`).
5. Merge the remaining items from every product into one Feature list and one Bug list. Classify
   by `type` (`Feature` vs `Bug`) — don't second-guess even if a Feature ticket is really a bug
   report; file it under whichever section the type says, and let the prose reflect the nuance.
6. One ticket is special: the **release container**, titled `Release: <Version>
   (<DD/MM/YYYY>)` with no product prefix (Labe-07.013 is `Release: Labe-07.013 (18/08/2026)`;
   created by the sibling [releasy-release](../releasy-release/SKILL.md) skill). Older tickets
   may still have a product prefix (`Xeelo - Release: …`) — accept either.
   - Pull **Version** from the named release (`Labe-07.013`). With two products, the Version
     line is `Labe-07.013 / Odra-01.008` (Xeelo first).
   - Pull **Release date** from the date in parentheses, reformatted `DD/MM/YYYY` → `D Month
     YYYY` (`18/08/2026` → `18 August 2026`). If no container ticket exists, ask the user.
   - Exclude this ticket from New Features / Bug Fixes.

## 2. Turning tickets into business prose — the part that needs judgment

This is the heart of the skill, and it's not mechanical — read each ticket's raw `description`,
understand what actually changed for a user, and rewrite it as a short story a non-technical
reader would follow. Descriptions may be HTML or Markdown; strip markup, then rewrite. A few
concrete rules:

- **One paragraph per item.** Format: a short, punchy title as its own sentence, then 1–4
  sentences explaining what changed and why it matters. Title and explanation sit in the *same*
  paragraph, not separately bolded — e.g. `"Bookmarks in Left Menu. Users can now bookmark
  frequently accessed items and reach them directly from the left navigation menu."` Look at
  [references/example.md](references/example.md) for more worked examples pulled from a real
  release.
- **Strip everything internal.** No ticket IDs, no `[10044]`-style tags, no Priority/Severity/
  T-Shirt values, no module numbers, no raw field dumps like "Requestor: X / Severity: 3".
- **Translate and clean up.** Source descriptions are frequently informal, in Czech or Slovak,
  written like a bug report (steps to reproduce, expected vs. actual behavior) or terse Jira
  shorthand. Rewrite fully into clean, professional English — never paste raw ticket text.
- **Keep names only when they add real context**, e.g. "blocking deployments for customers in
  Poland" reads naturally; "Requestor: Radek Frízel" as a field dump does not.
- **Purely internal/technical items** (a dependency bump, a tsconfig change) still get a
  paragraph, but frame it in terms of what it protects or maintains for the business (e.g.
  "keeps the platform on a supported, secure footing") rather than describing the technical
  change itself.
- Order items within each section however reads best — usually most business-impactful first.

## 3. Writing the Summary

The Summary section is 1–2 short paragraphs, not a recap of every item. Call out the single
biggest theme or the 1–2 most significant changes in the release, then briefly roll the rest up
into that narrative. Write it like the opening of an executive briefing — someone who reads only
this section should understand what the release is *about* and why it matters, not just what
changed. If XeeloAdmin items were included, the summary may mention admin-side changes as part
of that narrative; do not add a separate product heading.

## 4. Building the document

Once you have the version, release date, and your lists of Feature/Bug/Summary paragraphs, hand
them to the bundled script rather than hand-building the .docx — it reproduces the reference
template's exact fonts, sizes, colors, and spacing, and avoids a nasty OOXML pitfall (see below).

Install deps once if needed: `pip install -r requirements.txt` (from this folder).

1. Write a `content.json` file (temp file is fine; do not commit it):
```json
{
  "version": "Labe-07.013",
  "release_date": "18 August 2026",
  "features": [
    "Smoother Time Picker Navigation. Moving the cursor between hours, minutes, and seconds no longer clears the value that was just entered..."
  ],
  "bugs": [
    "Bookmarks Always Open the Latest Version. Bookmarks that pointed to an older or archived version of a request no longer show outdated data..."
  ],
  "summary": [
    "Release Labe-07.013 focuses on making everyday data entry faster and integrations more powerful...",
    "On the integration side, several GraphQL enhancements make it easier to build automated processes..."
  ]
}
```

2. Run: `python scripts/build_release_email.py content.json <output>.docx`
3. **Output path**: always `release-notes/Xeelo_<primaryVersion>.docx` at the repo root (e.g.
   `release-notes/Xeelo_Labe-07.013.docx`), even when a second product is included. Create
   `release-notes/` if it does not exist. Don't add suffixes like `_Email` or `_ReleaseNotes`
   unless files already in that folder use one (check `release-notes/` first, not the repo root).
4. **Always sanity-check the render** before delivering: `soffice --headless --convert-to pdf
   <output>.docx`, then convert page 1 to a PNG (`pdftoppm -png -r 100 -f 1 -l 1 <file>.pdf page`)
   and look at it. This catches gross layout mistakes; it doesn't fully replicate Word's own
   validation, so don't skip step 5 either. If `soffice` / `pdftoppm` are missing, say so and
   still deliver the .docx.
5. If you ever need to add anything beyond plain paragraphs (a table, for instance — this format
   normally doesn't need one, but a future variant might), be careful with raw OOXML: any element
   you insert by hand into `w:tblPr` or `w:tcPr` (borders, shading, `vAlign`, etc.) must go in
   the *exact* schema order or Word will silently treat the file as needing repair and strip the
   formatting on open — this has bitten a previous generation of this document. `w:tblPr`
   children must appear in this order: `tblStyle, tblpPr, tblOverlap, bidiVisual,
   tblStyleRowBandSize, tblStyleColBandSize, tblW, jc, tblCellSpacing, tblInd, tblBorders, shd,
   tblLayout, tblCellMar, tblLook, tblCaption, tblDescription`. `w:tcPr` children: `cnfStyle,
   tcW, gridSpan, hMerge, vMerge, tcBorders, shd, noWrap, tcMar, textDirection, tcFitText,
   vAlign, hideMark, headers, ...`. Insert new elements before the first existing sibling that
   comes later in this list (never just `.append()`), and re-verify with the PDF-render check
   above — LibreOffice won't complain about bad ordering the way Word does, so a clean
   LibreOffice render doesn't guarantee a clean Word open.

## 5. Exact visual spec (already implemented in the script — reference only)

| Element | Font | Size | Color | Bold | Spacing before/after |
|---|---|---|---|---|---|
| Title "Xeelo – Release Notes" | Calibri | 18pt | `#1F3864` | yes | 0 / 8pt |
| "Version: " label / value | Calibri | 11pt | `#222222` | label yes, value no | 0 / 4pt |
| "Release date: " label / value | Calibri | 11pt | `#222222` | label yes, value no | 0 / 4pt |
| Section headings (New Features / Bug Fixes / Summary) | Calibri | 13pt | `#1F3864` | yes | 16pt / 6pt |
| Item paragraphs | Calibri | 11pt | `#222222` | no | 0 / 8pt |

Left-aligned throughout (not centered). Letter page, portrait, margins top/bottom 1080 twips,
left/right 1260 twips. No header/footer, no page numbers, no tables, no images, no
cover/copyright line. The document title stays **Xeelo – Release Notes** even when XeeloAdmin
tickets are included.

## 6. Related but different: the detailed release-notes format

Some projects also keep a longer, ticket-level release notes format for a dev/support audience:
centered title, per-item `[ID]` tags, and summary tables of ID/Title/Priority/T-Shirt/Severity,
under headings "New Features & Improvements" → table, "Bug Fixes" → table, "Feature Details",
"Bug Fix Details". If the user's request or their existing project files point to that style
instead, don't use this skill's template — match the existing detailed-format file instead.
