# Releasy - agent instructions

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) before changing `index.html`. It maps the whole file
(sections, store, components, call chains, API surface), so you do not have to scan ~7200 lines.

## Project shape

- **The application is one file**: `index.html` (markup + CSS + Vue templates + all logic). This is
  a hard requirement - no build step, no bundler, no npm, no extra JS/CSS files. Dependencies come
  from CDN (Vue 3 global build with the runtime compiler).
- `guide.html` is the user guide, loaded at runtime. `README.md` is user-facing documentation.
- Navigate the code with the `// ===== Section =====` markers: `rg -n "// ===== " index.html`.

## Non-negotiable rules

1. The reactive `store` is the only source of truth. Never read state from the DOM and never express
   state by mutating the DOM (`style.display`, `classList`, `innerHTML`). Add raw state or a
   computed.
2. Render from templates only - no `document.createElement`, no HTML string concatenation, no
   inline `onclick`.
3. `v-html` is reserved for trusted HTML (help guide, Azure DevOps descriptions and comments).
4. Gate every write behind `store.canWrite`, both in the template and in the handler.
5. After a successful write call `store.applyFieldUpdate()` instead of reloading, unless the item
   moves in the hierarchy.
6. New modal = store slice with an `open` flag + `mountApp` + an entry in `MODAL_STACK`. Never call
   `lockBodyScroll()` per modal.
7. Reusable components use `<script type="text/x-template">` (in-DOM templates break camelCase
   props).
8. Description editors are uncontrolled: push via the `html` prop, read back with
   `readEditorHtml(id)`.
9. Use `Logger`, not `console`, and keep the `mountApp` error handler on new apps.
10. On every change to `index.html`, update `APP_RELEASE.updatedAt` (ISO 8601 UTC, e.g.
    `new Date().toISOString()`) to the time of the change. Only bump `APP_RELEASE.version` when the
    user explicitly asks for a version bump.

Full reasoning and the remaining conventions are in `ARCHITECTURE.md`.

## Verifying a change

There are no automated tests. After editing:

1. Syntax-check the script block, e.g. extract it and run `node --check`.
2. Serve the folder (`python3 -m http.server 8000`) and exercise the affected flow in the browser -
   `file://` blocks the local `guide.html` fetch.
3. Check the console: it must stay clean (the production Vue build hides warnings, so a broken
   render shows up as missing UI, not as an error).

## Testing against the real Azure DevOps instance

A write-scoped PAT is kept in `dev.env` (git-ignored - never commit it, never print its value to
the user or in a commit/PR) for testing against the real `smartermdm/Board` project when browser
smoke-testing alone cannot confirm something (API response shape, format quirks, etc.).

- **Never write to, edit, or delete an existing work item** - not a field, not a comment, not an
  attachment. Read-only requests (`GET`) against existing items are fine.
- If a test needs to create/update/delete something, **create your own throwaway work item first**,
  run the test against that, then delete it (`DELETE .../_apis/wit/workitems/{id}`) before ending
  the task. Never leave test items behind in the user's backlog.
- When in doubt whether an action would touch existing data, don't - ask the user or fall back to
  a browser/API check that only reads.

## Documentation duties

- Structural changes (Vue root, component, store slice, persisted key, call chain, API endpoint,
  invariant) must be reflected in `ARCHITECTURE.md` in the same change.
- User-visible features, dependencies or localStorage keys also belong in `README.md`, which is
  written in Czech.
- `.cursor/skills/releasy-ai/` lets an AI agent create/read/update Azure DevOps work items and
  comments directly via the REST API, bypassing this front-end - it has its own PAT
  (`.cursor/skills/releasy-ai/.env`, git-ignored), separate from `dev.env` above. Whenever a
  constant it depends on changes in `index.html` - `statusOptions`, `releaseNames`,
  `titlePrefixes`/`titlePrefixesTask`, `availablePatchVersions`, `assignees`, `RATING_LEVELS` - or
  the work item field mapping/API endpoint versions used by `createWorkItem()`/
  `createChildTask()`/comments change, review that skill. Most of those constants are read live
  via `scripts/releasy-config.mjs` so no action is usually needed there, but the field-mapping/
  endpoint logic in its other scripts and the tables in `reference.md` are hardcoded and must be
  updated by hand if that logic itself changes.
- `.cursor/skills/releasy-notes/` writes a business-facing Xeelo release-notes `.docx` for a
  named patch (optionally merging a second product such as XeeloAdmin) into `release-notes/`
  at the repo root. It does not talk to Azure DevOps itself: it calls `releasy-ai` scripts
  (`list-tickets.mjs --descriptions`, `releasy-config.mjs`) and reuses that skill's PAT. A
  change to how Bugs/Features store descriptions should be reflected in both
  `list-tickets.mjs` and `releasy-notes/SKILL.md`.
- `.cursor/skills/releasy-release/` creates the patch **release-container** Feature
  (`Release: Labe-07.014 (25/08/2026)`) plus its 6 standard ship-checklist Tasks, copied from
  Labe-07.013. It calls `releasy-ai/scripts/create-release.mjs` and the same PAT. A change to
  how Features/Tasks are created (`createWorkItem()` / `createChildTask()`, epic parent,
  PlatformRelease, Tags) must be reflected in that script and in `releasy-release/SKILL.md`.
