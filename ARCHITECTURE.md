# Releasy - Architecture Reference

Working map of `index.html` for AI agents and developers, so that a change does not require
reading all ~7200 lines. **The whole application is one file**: markup, CSS, Vue templates and all
logic live in `index.html`. There is no build step and no module system - everything is in one
`<script>` in a single function-less top-level scope.

Keep this file in sync whenever the structure changes (see [Maintaining this document](#maintaining-this-document)).

## Contents

- [How to navigate index.html](#how-to-navigate-indexhtml)
- [Startup sequence](#startup-sequence)
- [Configuration](#configuration)
- [Data model](#data-model)
- [The store](#the-store)
- [Vue apps and mount points](#vue-apps-and-mount-points)
- [Components](#components)
- [Flows: what calls what](#flows-what-calls-what)
- [Azure DevOps API surface](#azure-devops-api-surface)
- [Invariants and conventions](#invariants-and-conventions)
- [Gotchas](#gotchas)
- [Where to change what](#where-to-change-what)
- [Maintaining this document](#maintaining-this-document)

## How to navigate index.html

Line numbers drift, so **navigate by section markers**, which are stable and greppable:
`rg -n "// ===== " index.html`.

Rough layout (line numbers as of app version 1.0.42, for orientation only):

| Range | Content |
| --- | --- |
| 1-11 | `<head>`, CDN dependencies |
| 12-2190 | `<style>` - all CSS, themed via CSS custom properties on `[data-theme]` |
| 2192-2938 | `<body>` markup - one `<div id="...App">` per Vue root, each with an **in-DOM template** |
| 2940-3101 | `<script type="text/x-template">` blocks - templates for reusable components |
| 3103-7212 | The single `<script>` with all logic |

Order of `// ===== ... =====` sections inside the script:

1. `Configuration`, `API Configuration`, `Error Messages`, `Logging Utility` - constants, `Logger`
2. `Build Changes Pipeline Mapping`, `Assignees Configuration`, `Title Prefixes ...`,
   `Available patch versions Configuration` - business configuration
3. `DOM Cache Helper`, `DevOps API Helper`, `PAT Encryption/Decryption`, `Helper Functions`
4. `Data Parsing & Grouping`, `Last Reload Time Management`, `Permission Management`,
   `Task Mode Management`, `Child Tasks Management`
5. `Priority & Severity Handling`, `Work Item Rendering`, `Sorting Functions`
6. `PAT Modal Management`, `Azure DevOps API Integration`, `Token Permissions Check`
7. `Modal Functions` ... `Work Item Created Success modal` - modal open/close/submit functions
8. `PDF Export`, `Theme Management`
9. `Status Change Feature`, `Value picker`, and the per-field `... Change Functions`
10. `Work Item Detail (Lazy Load)`, `Work Item Link Functions`
11. `VUE LAYER` -> `Store`, `Derived state`, `Persistence`, `Components`, then one section per
    mounted app, ending with the modal stack and `End of Script`

Everything above `VUE LAYER` is plain functions (many on `window.*`); everything below is the
reactive layer. Plain functions mutate `store` and never touch the DOM to express state.

## Startup sequence

1. The script runs top to bottom: configuration constants -> helpers -> API -> `window.*` modal
   functions -> `VUE LAYER` (store, derived state, persistence watchers, components, `mountApp`
   calls, `MODAL_STACK`). Definition order matters in a few places, e.g. `darkModeQuery` is read
   while the store is being created, so it must be defined before `Store`.
2. `mountApp(options, selector)` wraps `createApp(...).mount(selector)` and attaches an
   `errorHandler` - the production Vue build strips warnings, so without it a throwing render
   silently renders nothing.
3. `DOMContentLoaded` (registered just above `VUE LAYER`) runs:
   `initializePermissionBadge()` -> `activateProduct(store.activeProduct)` -> `checkAndOpenWorkItemFromUrl()`.
   Only the active tab's data (and, if Task Mode is already on, its tasks) is fetched; the other
   4 products load lazily the first time the user switches to them (see
   [Load / reload](#flows-what-calls-what)).
4. `popstate` opens or closes the detail modal from the `?workitem=<id>` query parameter.

## Configuration

All plain data constants live together at the top of the script, from `Configuration` through
`Theme Configuration`, before the `Helper Functions` section starts. This is deliberate: anything
that looks like "settings" for a non-developer to tweak (assignees, allowed statuses, patch
versions, ...) sits in one place instead of being scattered next to the feature that happens to use
it first.

| Constant | Purpose |
| --- | --- |
| `config` | `organization: 'smartermdm'`, `project: 'Board'` |
| `API_BASE_URL` | `https://dev.azure.com/{org}/{project}/_apis` - used by the `devOps*` helpers |
| `APP_RELEASE` | `version` + `updatedAt` shown in the footer; bump on every release |
| `IS_PRODUCTION` | false only on `localhost` / `127.0.0.1`; sets `Logger.level` |
| `releaseNames` | The 5 products: `{ product, release, epicID }`. Drives both the WIQL loop and the parent Epic link when creating work items |
| `buildChangesPipelineMap` | product -> Jenkins pipeline name; a product missing here has no Build Changes button |
| `assignees` | Assignee list (`{ email, name }`) for the "Change Assigned To" picker, create forms, **and** `store.availableAssignees` (see below) |
| `titlePrefixes`, `titlePrefixesTask` | Allowed title prefixes per product / for tasks |
| `availablePatchVersions` | Options in the "Change Patch Version" picker (`999` = next release bucket) |
| `statusOptions` | Allowed `System.State` values per work item type; also the source for `store.availableStatuses` |
| `RATING_LEVELS` | Shared 1-4 scale for priority and severity |
| `THEMES`, `darkModeQuery`, `LOGO_URLS` | Theme buttons, the system dark-mode media query and the logo served per resolved theme |

## Data model

`store.releaseResults` - one entry per **loaded** product (products not yet visited are simply
absent), filled per-product by `loadProductData()`:

```js
[{ product: 'Xeelo', release: 'Labe',
   releases: { Labe: { '07': { '015': [workItem, ...] } } } }]
```

The nesting `release -> major -> patch` is built by `groupWorkItems()`, which parses
`Custom.PlatformRelease` with `parseReleaseVersion()` (`/([A-Za-z]+)-(\d{2})\.(\d{3})/`, e.g.
`Labe-07.015`). **Items without a parseable `Custom.PlatformRelease` are silently dropped.**

`store.childTasks` - `{ [parentId]: Task[] }` across **all** products fetched so far (not just the
active one), filled only in Task Mode by `fetchChildTasksForWorkItems()` and merged in by
`loadChildTasksIntoStore()` - never replaced wholesale, so loading one product's tasks cannot wipe
out another's.

Work items are raw Azure DevOps objects (`{ id, fields, relations }`). Fields the app reads:

- `System.Id`, `System.WorkItemType`, `System.Title`, `System.State`, `System.AssignedTo`,
  `System.Tags`, `System.CreatedDate`, `System.ChangedDate`, `System.Description`
- `Custom.PlatformRelease` (hierarchy key), `Custom.Epictitle`, `Custom.Shirtsize`
- `Microsoft.VSTS.Common.Priority` (number), `Microsoft.VSTS.Common.Severity` (**label**, e.g.
  `"3 - Medium"`), `Microsoft.VSTS.Common.ClosedDate`, `Microsoft.VSTS.TCM.ReproSteps` (Bug
  description)

T-shirt size is read through `getTshirtFieldKey()` / `getTshirtSizeFromFields()` because the field
name is not identical across projects.

## The store

`const store = reactive({...})` in `VUE LAYER > Store` holds **raw state only**; everything
derived is a computed assigned onto the store afterwards (`reactive()` unwraps them, so both
templates and plain JS read `store.x`).

Raw state: `theme`, `systemPrefersDark`, `releaseResults`, `loadingProducts`, `childTasks`,
`taskLoadedProducts`, `taskMode`, `taskModeBusy`, `permission`, `activeProduct`, `search`,
`expanded`, `hidden`, `filters`, `filterModalOpen`, `unhideModalOpen`, `notifications`,
`closeDetailAfterCreate`, `lastReloadAt`, `clockTick`, plus **one slice per modal**: `picker`,
`pat`, `help`, `created`, `buildChanges`, `createWorkItem`, `createTask`, `detail`.

`loadingProducts` (products currently being fetched) and `taskLoadedProducts` (products whose
tasks have been fetched at least once) exist purely to drive the lazy-loading functions in
[Load / reload](#flows-what-calls-what); there is no more single `loading` boolean, since loading
is per-product now.

Store methods: `isExpanded`, `toggleExpanded`, `expandAllMajors`, `collapseAll`, `toggleHidden`,
`unhide`, `openUnhideModal`, `openFilterModal`, `setFilters`, `clearFilters`, `applyFieldUpdate`,
`moveWorkItemPatch`, `insertWorkItem`, `addWorkItem`, `addChildTask`, `forEachWorkItem`.

Derived (`VUE LAYER > Derived state`):

| Computed | Meaning |
| --- | --- |
| `products` | Product tabs, from `releaseNames` **configuration** - static, so all 5 tabs are always visible/clickable regardless of what has been fetched |
| `isActiveProductLoading` | `true` while `activeProduct` has no entry in `releaseResults` yet, or is in `loadingProducts`; drives the grid's loading spinner |
| `allMajorIds` | All `release-major` ids **for `activeProduct` only** (for Expand All) |
| `canWrite` | `permission === 'write'` - **the single gate for every edit affordance** |
| `resolvedTheme` | `theme`, with `auto` resolved through `systemPrefersDark` |
| `hiddenCount`, `activeFilterCount` | Badge counters |
| `lastReloadText` | Relative label; depends on `clockTick` |
| `availableAssignees`, `availableStatuses` | Filter options, from the `assignees` / `statusOptions` **configuration** - not from loaded items, so an option is offered even if no currently loaded item uses it |
| `searchTerms` | `search` split on whitespace |
| `tree` | **The rendered hierarchy.** One pass over `releaseResults` for `activeProduct`: skips hidden majors/patches, sorts, applies `itemPasses()`, keeps a parent whose child task matches, prunes empty branches |
| `visibleResultCount` | Result counter in the toolbar |
| `visibleParentIds` | Parent ids to fetch child tasks for, **scoped to `activeProduct`** |

`itemPasses(item)` = assignee filter + status filter + all search terms found in
`buildWorkItemSearchText()`. `visibleChildTasksFor(parentId)` returns sorted, non-`Removed`,
filtered child tasks (empty unless Task Mode). Note `availableStatuses` includes `Removed` (it is
in `statusOptions` for every type), even though `loadProductData()`'s WIQL query never loads
`Removed` items - so that option in the Filter modal currently can never hide anything.

Persistence (`VUE LAYER > Persistence`) - one `watch` per key:
`expanded_sections`, `hidden_versions`, `workItemFilters`, `taskMode`, `lastActiveTab`,
`last_reload_time`, `themePreference`. Other keys written outside the watches: `devops_pat`
(encrypted), `tokenHasWriteCapability`, `tokenPermission`, `current_user_email`.

Also there: a `watchEffect` that mirrors `resolvedTheme` onto `<html data-theme>`, a
`darkModeQuery` listener, `watch(() => store.activeProduct, activateProduct)` (fires
`ensureProductLoaded`/`ensureTasksLoaded` for a tab the moment it becomes active - see
[Load / reload](#flows-what-calls-what)), and a 60s interval bumping `clockTick` so every relative
timestamp refreshes. `activeProduct` itself is initialized from `lastActiveTab` only if that saved
value is still one of the configured products, else it falls back to the first product - so a
stale/removed product name in `localStorage` can never leave the app on a non-existent tab.

## Vue apps and mount points

Each root is its own app (no single root component). Templates for these are the markup **inside
the root element** in `<body>`; only the components below use `x-template`.

| Root | Renders | Notable methods / state |
| --- | --- | --- |
| `#content` | The grid, via `<patch-section>`; loading spinner and empty state | `store.tree` |
| `#toolbarApp` | Reload, Unhide, Filter, Task Mode, Expand/Collapse, search box, permission badge, last reload | Debounced (200 ms) write into `store.search`; `reload()` -> `resetAndReloadActiveProduct()` |
| `#themeApp` | Three theme buttons from `THEMES` | Sets `store.theme` |
| `#appHeader` | Logo bound to `LOGO_URLS[resolvedTheme]` | |
| `#helpIconApp` | Help icon | `openHelpModal` |
| `#appVersionFooter` | Version + "updated x ago" | `APP_RELEASE` |
| `#notificationApp` | `store.notifications` in a `<transition-group>` | Fed by `showNotification()` |
| `#filterApp` | Filter modal (assignee + status checkboxes) | `store.setFilters()`, no reload |
| `#hiddenVersionsApp` | Unhide modal | `store.unhide()`, no reload |
| `#valuePickerApp` | **All six "change X" modals** | `PICKER_KINDS[kind]` |
| `#workItemDetailApp` | Work item detail | Meta badges, `<html-editor>`, tasks, comments; title splits into a prefix `<select>` + text (options from `d.titlePrefixOptions`), see [Detail modal](#flows-what-calls-what) |
| `#patApp` | PAT modal | `savePAT`, autofocus on open |
| `#helpApp` | Help modal, `v-html` of the fetched guide | `showHelpSection('help-pat')` after render |
| `#workItemCreatedApp` | Success modal after create | Close just hides it - the new item was already inserted into the store when it was created |
| `#buildChangesApp` | Build Changes list | |
| `#createWorkItemApp` | Create Feature/Bug form | `<html-editor>`, `RATING_LEVELS` |
| `#createTaskApp` | Create child Task form | `<html-editor>` |

## Components

Defined in `VUE LAYER > Components`, templates from `<script type="text/x-template">`:

| Component | Template id | Props | Notes |
| --- | --- | --- | --- |
| `HtmlEditor` | `tpl-html-editor` | `editorId`, `toolbarId`, `html`, `editable`, `minHeight` | Toolbar from `MD_TOOLBAR_BUTTONS`; **uncontrolled** - `html` is pushed in on change, content is read back with `readEditorHtml(editorId)`; emits `rendered` |
| `ProgressBar` | `tpl-progress-bar` | `items` | Segments per state in `PROGRESS_ORDER`, colors from `STATE_COLORS` |
| `PriorityCell` | `tpl-priority-cell` | `item` | Priority / severity (Bug) / t-shirt (Feature) badges, each opening its picker |
| `WorkItemRow` | `tpl-work-item-row` | `item`, `isChild`, `parentId` | Icon by type, clickable state/assignee badges, opens detail |
| `PatchSection` | `tpl-patch-section` | `node` | A patch: header, progress bar, PDF, Build Changes, create; `rows` interleaves parents with their child tasks as siblings |
| grid root | `tpl-releasy-grid` | - | Product tabs + releases + majors, mounted on `#content` |

## Flows: what calls what

**Load / reload - data is lazy, per product.** Only `activeProduct` is ever fetched automatically;
the other 4 products load the first time the user switches to their tab. The functions:

- `loadProductData(product)` - the only function that actually talks to Azure DevOps for the main
  hierarchy. `getPAT()` -> once (`window.tokenPermissionsChecked`) `checkTokenPermissions(pat)` ->
  looks up `releaseConfig` for `product` -> WIQL via `handleUnauthorized(fetchWIQL)` ->
  `fetchWorkItems(ids)` -> `groupWorkItems()` -> replaces just that product's entry in
  `store.releaseResults` (`[...filter(r => r.product !== product), entry]`) ->
  `saveLastReloadTime()`. Tracks itself in `store.loadingProducts` for the duration (drives
  `isActiveProductLoading`); on failure, logs + `showNotification()` and leaves the product
  absent so the next visit/reload retries.
- `ensureProductLoaded(product)` - no-op if `product` is already in `releaseResults` or
  `loadingProducts`, else `loadProductData(product)`. **Lazy** fetch.
- `ensureTasksLoaded(product)` - no-op unless `taskMode && canWrite`, and unless `product` is
  already in `taskLoadedProducts`, else `loadChildTasksIntoStore(product)`. **Lazy** fetch.
- `activateProduct(product)` - `ensureProductLoaded(product)` then `ensureTasksLoaded(product)`.
  Called by `DOMContentLoaded` (for the initial `activeProduct`) and by
  `watch(() => store.activeProduct, activateProduct)` (on every tab click).
- `reloadActiveProduct()` - **force** refresh of just `activeProduct`: `loadProductData()`, then
  (if Task Mode and `canWrite`) `loadChildTasksIntoStore()`. No write flow triggers this anymore -
  creating an item inserts it locally (`addWorkItem()`/`addChildTask()`) and a patch-version change
  relocates it locally (`moveWorkItemPatch()`); it now exists solely as the building block for
  `resetAndReloadActiveProduct()`.
- `resetAndReloadActiveProduct()` - clears `releaseResults`, `childTasks` and
  `taskLoadedProducts` entirely, then `reloadActiveProduct()`. Used by the toolbar's `reload()`
  and by `savePAT()` (a new PAT can mean different access, so the whole cache is invalidated).
  Other tabs simply go back to loading lazily on their next visit.

A 401 clears `devops_pat` and re-prompts once through `handleUnauthorized()`.

**Search / filter / expand / hide** - state only, no network, no re-render call: the toolbar or
modal writes into `store.search` / `store.filters` / `store.expanded` / `store.hidden`, and
`store.tree` recomputes.

**Task Mode** - `toggleTaskMode()` flips `store.taskMode`, and if turning on calls
`ensureTasksLoaded(activeProduct)` (lazy - a no-op if that product's tasks are already cached).
`loadChildTasksIntoStore(product)` fetches `store.visibleParentIds` (scoped to `activeProduct`) in
batches of 200 (`fetchChildTasksForWorkItems`) and **merges** the result into `store.childTasks`
(never replaces it), then marks `product` in `taskLoadedProducts`. Switching to another tab while
Task Mode is on lazily loads that tab's tasks via the `activateProduct` watcher above, without
discarding tasks already cached for other tabs.

**Detail modal** - `openWorkItemDetailModal(id, returnToParentId)` resets `store.detail`, pushes
`?workitem=<id>`, starts `loadWorkItemDetailComments()` (parallel), awaits the work item with
`$expand=Relations`, then starts `loadWorkItemDetailTasks()`. Every callback re-checks
`d.id === workItemId` before writing, so a fast second open cannot be overwritten by a slow first
response. `closeWorkItemDetailModal(forceFullClose)` re-opens `returnTo` unless forced.

The title field is split the same way the create forms split it, for every work item type: on
open, `d.titlePrefixOptions` is set to `titlePrefixesTask` for a Task, or to
`titlePrefixes[resolveProductForWorkItem(fields, fields['Custom.PlatformRelease'])] || []` for a
Feature/Bug; then `splitTitleIntoPrefixAndSuffix(d.title, d.titlePrefixOptions, '')` fills
`store.detail.titlePrefix` (the matched prefix, or `''` if none of `titlePrefixOptions` matches -
left blank rather than guessed) and rewrites `d.title` down to just the free-text part. Everywhere
that needs the item's actual title (the `System.Title` PATCH, `copyWorkItemFromDetail()`'s
prefill, the picker headings for state/assignee/priority/severity/t-shirt/patch) reads
`detailFullTitle()`, which rejoins `titlePrefix` + `title`.

**Change a single field** - `open*ChangeModal(...)` -> `openValuePicker(kind, context)` (no-op
unless `store.canWrite`) -> the `#valuePickerApp` option click -> `PICKER_KINDS[kind].apply()` ->
`changeWorkItem*()` -> `updateWorkItemField()` -> `PATCH /wit/workitems/{id}` ->
`store.applyFieldUpdate()` (updates grid + detail in memory) -> `showNotification()` ->
`closeValuePicker()`. No re-fetch: the PATCH response already confirms the new value, so the app
never re-reads it back from Azure DevOps.

`changeWorkItemPatchVersion()` is the one field change that also relocates the item, since
`Custom.PlatformRelease` decides which major/patch bucket it renders under. It calls
`store.moveWorkItemPatch(workItemId, newPatchVersion)` instead of `applyFieldUpdate()`: this
removes the item from wherever it currently sits in `store.releaseResults` (deleting any
major/patch/release keys it leaves empty), updates its `Custom.PlatformRelease` field, and
re-inserts it into the `releaseResults` entry whose `release` matches the new version's release
name - creating the destination major/patch bucket if needed. If that destination product has not
been loaded yet (lazy loading), the item is simply dropped; it appears correctly the first time
that tab is visited. No network reload either way.

**Create work item** - `openCreateWorkItemModal(product, release, major, patch, prefill)` fills
`store.createWorkItem` -> `createWorkItem()` validates, resolves `epicID` from `releaseNames`,
builds JSON-patch operations (title with prefix, priority, tags, `Custom.PlatformRelease`, parent
Epic link, description into `ReproSteps` for Bug, severity for Bug / t-shirt for Feature) ->
`createWorkItemViaApi()` returns the full created item -> `store.addWorkItem()` places it straight
into `store.releaseResults` (via `insertWorkItem()`, same bucket logic as `moveWorkItemPatch()`) ->
`openWorkItemCreatedModal()`. No reload: the create response already has every field Azure DevOps
assigned it. `copyWorkItemFromDetail()` prefills the same form and sets
`store.closeDetailAfterCreate`.

**Create child task** - `openCreateTaskModal(parentId, parentTitle, prefill)` ->
`createChildTask()` -> operations + `Hierarchy-Reverse` relation to the parent ->
`createWorkItemViaApi('Task', ...)` -> `store.addChildTask(parentId, createdTask)` appends it to
`store.childTasks[parentId]`, and if the detail modal for that parent is open, it is also appended
to `store.detail.tasks` directly (no re-fetch) -> success modal.

**PDF export** - `exportPatchToPDF(product, release, major, patch, patchId)` finds the patch node in
`store.tree` (so it exports exactly what is visible), re-fetches those ids with `$expand=fields`,
and renders with jsPDF + AutoTable.

**Build Changes** - the `PatchSection` button (only when the product has a pipeline) calls
`openBuildChangesModal(product, release, major, patch, pipeline)`, which derives the branch as
`rel-2025-<major>.<patch>`, fetches the Jenkins proxy and fills `store.buildChanges.changes`.

**Help** - `openHelpModal()` sets `store.help.open`, and on first open `fetchHelpGuide()` loads
`guide.html` locally (only on `127.0.0.1`) or from the Integray provisioning endpoint. Result goes
into `store.help.html` and is injected with `v-html`; `showHelpSection()` then scopes its DOM work
to `#helpModalBody`.

**PAT** - `getPAT()` returns the decrypted token or opens the modal and **returns a promise that
resolves when the user saves** (`patModalResolve`; `closePATModal()` resolves `null` so callers do
not hang). `savePAT()` encrypts with AES-GCM (`encryptPAT`), stores the self-declared capability,
then `checkTokenPermissions()` + `resetAndReloadActiveProduct()` (a new PAT can mean different
access entirely, so the whole cache is invalidated, same as Reload).

**Modals: ESC and scroll lock** - `MODAL_STACK` (end of file) lists every modal as
`{ isOpen, close }`, **topmost first**. One `keydown` listener closes the first open entry; one
`watchEffect` calls `lockBodyScroll()` / `unlockBodyScroll()` if anything is open. A new modal must
be registered here.

## Azure DevOps API surface

`devOpsApiRequest()` (+ `devOpsGet/Post/Patch/Delete`) prefixes `API_BASE_URL` and adds
`Authorization: Basic btoa(':' + pat)`. Several older call sites still build the full URL and call
`fetch` directly (create, field update, child tasks, comments, attachments).

| Purpose | Call |
| --- | --- |
| Hierarchy query | `POST /wit/wiql?api-version=6.0` - Feature/Bug, `Custom.PlatformRelease CONTAINS '<release>-'`, not `Removed`, `Closed` only within `@startOfDay('-180d')` |
| Work item batch | `GET /wit/workitems?ids=...&$expand=fields&api-version=6.0` (PDF export uses 7.1) |
| Detail | `GET /wit/workitems/{id}?$expand=Relations&api-version=7.1` |
| Child tasks | `GET /wit/workitems?ids=...&$expand=relations&api-version=6.0`, batched by 200 |
| Comments | `GET /wit/workItems/{id}/comments` (paged, see `fetchWorkItemCommentsAll`) |
| Field update | `PATCH /wit/workitems/{id}?api-version=7.1`, `application/json-patch+json` |
| Create | `POST /wit/workitems/${type}?api-version=6.0` |
| Attachments | `POST /wit/attachments?fileName=...&api-version=6.0` on paste/upload; images in descriptions and comments are re-fetched authenticated and swapped for blob URLs (`replaceImagesWithAuthenticatedBlobs`) |
| Token check | `GET https://dev.azure.com/{org}/_apis/connectionData` |

Two calls do **not** go to Azure DevOps, both to `provisioning.integray.app`:

- **Build Changes**: `GET .../jenkins/build-changes?pipeline=<buildChangesPipelineMap[product]>&branch=rel-2025-<major>.<patch>`,
  and the response's `[0].changes` is what the modal lists. Note the hardcoded `rel-2025-` branch
  prefix and that `pipeline` is a **Jenkins** job name.
- **Assets**: `guide.html` and both logos (`LOGO_URLS`).

## Invariants and conventions

Rules that keep the Vue migration intact - break them and the app regresses to its old failure
modes:

1. **The store is the only source of truth.** Never derive state by reading the DOM
   (`textContent`, computed styles, `data-*`), and never express state by writing to the DOM
   (`style.display`, `classList` toggles, `innerHTML`). Add raw state or a computed instead.
2. **Rendering belongs to templates.** No `document.createElement`, no HTML string building, no
   `onclick=` attributes. Bind `@click` where the item is already in scope.
3. **`v-html` only for trusted HTML** - the fetched help guide, Azure DevOps descriptions and
   comments. Everything else must go through normal interpolation, which Vue escapes.
4. **Guard every write with `store.canWrite`** in both the template (`v-if`/`v-show`) and the
   handler (early `return`).
5. **After a successful write, update the store in memory** - `applyFieldUpdate()` for a plain
   field, `moveWorkItemPatch()` when the change relocates the item in the hierarchy,
   `addWorkItem()`/`addChildTask()` for a newly created item - rather than reloading. A full reload
   (`resetAndReloadActiveProduct()`) is reserved for cases the app cannot reconcile locally at all,
   currently only a new PAT (different access entirely).
6. **Register new modals in `MODAL_STACK`** and drive visibility from a `store.<modal>.open` flag
   (`:class="{ show: ... }"`); do not call `lockBodyScroll()` per modal.
7. **Reusable components use `<script type="text/x-template">`.** In-DOM templates lowercase
   attribute names, which breaks camelCase props - that is why the grid components are not inline.
8. **The description editors are uncontrolled.** Push content in via the `html` prop, read it back
   with `readEditorHtml(id)` on submit, and call `$refs.editor.render()` when a modal opens (an
   unsaved edit means the prop may not change).
9. **`initializeHtmlEditor()` must not clone its toolbar.** It marks bound editors with
   `dataset.boundEditor`; cloning detaches Vue's bindings (this previously broke `v-show` on the
   toolbar in read-only mode).
10. **Log through `Logger`**, not `console`, and keep the `mountApp` error handler on new apps.
11. **Root elements that could flash raw markup carry `v-cloak`.**
12. Async work that lands in a modal must **re-check the id/open flag** before writing to the
    store.

## Gotchas

- **`tokenHasWriteCapability` is self-declared.** The user picks Read-Only / Read-Write in the PAT
  modal; `checkTokenPermissions()` only validates that the token can reach Azure DevOps and stores
  the user's email. Azure DevOps still rejects unauthorized writes.
- **Severity is stored as a label** (`"3 - Medium"`), priority as a number. `extractNumber()`
  normalizes for display.
- **Patch `999`** is the "next release" bucket and is highlighted differently in the patch picker.
- **Legacy `patchs` key**: older builds wrote `expanded_sections.patchs` / `hidden_versions.patchs`.
  `readExpandedSections()` / `readHiddenVersions()` merge it forward - keep that shim.
- **`closeDetailAfterCreate`** is set when a create form was prefilled from the detail modal, so a
  successful create also closes the item that was copied.
- **`guide.html` is only loaded from disk on `127.0.0.1`**; elsewhere it comes from the
  provisioning endpoint. Opening the file over `file://` blocks the local `fetch`.
- **Dead code**, defined but never called: `calculateProgress()`, `DOMCache`, `devOpsPatch()`,
  `devOpsDelete()`. Do not assume they are wired.
- Many comments describe the **removed** imperative helpers (`filterWorkItems()`,
  `updateHierarchyVisibility()`, `updateEditVisibility()`, ...) as migration notes. They are history,
  not code that exists.
- `alert()` is still used for create failures, while everything else uses `showNotification()`.

## Where to change what

| Task | Where |
| --- | --- |
| Add a product / release | `releaseNames` (+ `epicID`), `titlePrefixes`, `availablePatchVersions`, optionally `buildChangesPipelineMap` |
| Add a patch version to a picker | `availablePatchVersions` |
| Add / remove an assignee | `assignees` |
| Change allowed statuses | `statusOptions` |
| Change which items load | the WIQL query in `loadProductData()` (types, `Closed` window) |
| Add a column or badge to a row | `tpl-work-item-row` (+ `WorkItemRow` computed) |
| Add a field to the detail modal | `#workItemDetailApp` markup + its computed |
| Add a new "change X" modal | a new entry in `PICKER_KINDS` (`build` + `apply`) - no new markup |
| Add a new modal | markup root in `<body>`, store slice, `mountApp`, `MODAL_STACK` entry |
| Change a filter rule | `itemPasses()` / `store.tree` |
| Change the PDF layout | `exportPatchToPDF()` |
| Change theming | CSS custom properties under `[data-theme]`, `THEMES`, `LOGO_URLS` |
| Release a version | `APP_RELEASE.version` + `updatedAt` |

## Maintaining this document

Update this file in the same change that touches the code when you:

- add, rename or remove a Vue root, component, template id or store slice,
- add a store computed or a persisted `localStorage` key,
- change a call chain described in [Flows](#flows-what-calls-what),
- change an Azure DevOps endpoint, api-version or field name,
- add or relax an invariant.

Do not add line numbers to descriptions - reference section markers and function names, which
survive edits.
