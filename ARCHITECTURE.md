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

Rough layout (line numbers as of app version 1.0.44, for orientation only):

| Range | Content |
| --- | --- |
| 1-10 | `<head>`, CDN dependencies |
| 11-2031 | `<style>` - all CSS, themed via CSS custom properties on `[data-theme]` |
| 2033-2790 | `<body>` markup - one `<div id="...App">` per Vue root, each with an **in-DOM template** |
| 2790-2984 | `<script type="text/x-template">` blocks - templates for reusable components |
| 2984-7262 | The single `<script>` with all logic |

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
8. `Markdown Export`, `Theme Management`
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

`store.taskDotStatus` - `{ [parentId]: [{ id, title, state }] }` for the coloured dots to the left of
the status badge on Bug/Feature rows. A **missing key** means that parent has not been fetched yet (render nothing);
an **empty array** means it was fetched and has no child tasks (hollow ring). Filled in the
background by `scheduleTaskDotFetch()` / `fetchTaskDotStatusForParents()`, independently of Task
Mode. Never written into `childTasks`.

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
`taskLoadedProducts`, `taskDotStatus`, `loadingTaskDotIds`, `taskDotFetchGen`, `taskMode`,
`taskModeBusy`, `permission`, `activeProduct`, `search`,
`expanded`, `hidden`, `filters`, `filterModalOpen`, `unhideModalOpen`, `notifications`,
`closeDetailAfterCreate`, `lastReloadAt`, `clockTick`, plus **one slice per modal**: `picker`,
`pat`, `help`, `created`, `buildChanges`, `createWorkItem`, `createTask`, `detail`.

`loadingProducts` (products currently being fetched) and `taskLoadedProducts` (products whose
tasks have been fetched at least once) exist purely to drive the lazy-loading functions in
[Load / reload](#flows-what-calls-what); there is no more single `loading` boolean, since loading
is per-product now. `taskDotStatus` / `loadingTaskDotIds` / `taskDotFetchGen` drive the
background task-dot fetch, which is **not** gated on Task Mode.

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
[Load / reload](#flows-what-calls-what)), `watch(() => store.visibleParentIds, scheduleTaskDotFetch)`
(background slim task fetch for the dots), and a 60s interval bumping `clockTick` so every relative
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
| `#workItemDetailApp` | Work item detail | Meta badges, `<html-editor>`/`<markdown-editor>` (picked by `d.descriptionFormat`, with an HTML->Markdown conversion toggle when `store.canWrite`, disabled once already Markdown - `d.descriptionFormatLocked`), tasks, comments; title splits into a prefix `<select>` + text (options from `d.titlePrefixOptions`), see [Detail modal](#flows-what-calls-what) |
| `#patApp` | PAT modal | `savePAT`, autofocus on open |
| `#helpApp` | Help modal, `v-html` of the fetched guide | `showHelpSection('help-pat')` after render |
| `#workItemCreatedApp` | Success modal after create | Close just hides it - the new item was already inserted into the store when it was created |
| `#buildChangesApp` | Build Changes list | |
| `#createWorkItemApp` | Create Feature/Bug form | `<html-editor>`/`<markdown-editor>` (user-picked via `form.descriptionFormat`), `RATING_LEVELS` |
| `#createTaskApp` | Create child Task form | `<html-editor>`/`<markdown-editor>` (user-picked via `form.descriptionFormat`) |

## Components

Defined in `VUE LAYER > Components`, templates from `<script type="text/x-template">`:

| Component | Template id | Props | Notes |
| --- | --- | --- | --- |
| `HtmlEditor` | `tpl-html-editor` | `editorId`, `toolbarId`, `html`, `editable`, `minHeight` | Toolbar from `MD_TOOLBAR_BUTTONS`; **uncontrolled** - `html` is pushed in on change, content is read back with `readEditorHtml(editorId)`; emits `rendered` |
| `MarkdownEditor` | `tpl-markdown-editor` | `editorId`, `toolbarId`, `markdown`, `editable`, `minHeight` | Markdown counterpart of `HtmlEditor`. In the detail modal it is used when `d.descriptionFormat === 'Markdown'`, either detected from the server or chosen via the format toggle's HTML->Markdown conversion (see [Detail modal](#flows-what-calls-what)); in both create forms it is used when the user picks Markdown in the format toggle (`form.descriptionFormat`). Edit/Preview toggle - opens in Preview if there is content, straight into Edit if the field is empty (`render()`); edit mode is a plain `<textarea>` (Markdown source, toolbar from `MARKDOWN_TOOLBAR_BUTTONS`), preview mode renders `marked.parse()` output into a `v-html` div; **uncontrolled** like `HtmlEditor` - content read back with `readMarkdownEditorText(editorId)`; emits `rendered` (with the preview container, so image auth fix-up runs the same way) |
| `ProgressBar` | `tpl-progress-bar` | `items` | Segments per state in `PROGRESS_ORDER`, colors from `STATE_COLORS` |
| `PriorityCell` | `tpl-priority-cell` | `item` | Priority / severity (Bug) / t-shirt (Feature) badges, each opening its picker |
| `WorkItemRow` | `tpl-work-item-row` | `item`, `isChild`, `parentId` | Icon by type, clickable state/assignee badges, opens detail; parent rows show at most 6 task-status dots (`pickVisibleTaskDots` / `allocateTaskDotQuota`: ≥1 per present status, leftover proportional) in a fixed-width slot left of the status badge; hover lists every child task, each row opening that task's detail modal |
| `PatchSection` | `tpl-patch-section` | `node` | A patch: header, progress bar, Markdown export, Build Changes, create; `rows` interleaves parents with their child tasks as siblings |
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
- `resetAndReloadActiveProduct()` - clears `releaseResults`, `childTasks`,
  `taskLoadedProducts`, `taskDotStatus` and `loadingTaskDotIds`, bumps `taskDotFetchGen` so an
  in-flight dot fetch cannot merge stale results, then `reloadActiveProduct()`. Used by the
  toolbar's `reload()` and by `savePAT()` (a new PAT can mean different access, so the whole cache
  is invalidated). Other tabs simply go back to loading lazily on their next visit.

A 401 clears `devops_pat` and re-prompts once through `handleUnauthorized()`.

**Search / filter / expand / hide** - state only, no network, no re-render call: the toolbar or
modal writes into `store.search` / `store.filters` / `store.expanded` / `store.hidden`, and
`store.tree` recomputes.

**Task-status dots** - independent of Task Mode (works in read-only too). `watch` on
`store.visibleParentIds` calls `scheduleTaskDotFetch()`: parents not yet in `taskDotStatus` and
not in `loadingTaskDotIds` are fetched in the background, 200 at a time, without awaiting from
`activateProduct` or touching `isActiveProductLoading` / `taskModeBusy`. Each batch goes through
`fetchTaskDotStatusForParents()` (parents: `$expand=relations` only — Azure DevOps rejects
`fields` together with `$expand`; children:
`fields=System.Id,System.Title,System.State,System.WorkItemType`) and is merged into
`taskDotStatus`, including empty arrays for parents with no tasks. The row renders at most
`TASK_DOT_MAX` (6) dots via `pickVisibleTaskDots()` / `allocateTaskDotQuota()`: every present
status gets at least one dot (when there are ≤ 6 statuses); leftover slots are split
proportionally by remaining task counts (largest remainder), so 10 New / 3 Active / 15 Closed
becomes 2 + 1 + 3. Hover lists every task (title + status badge), scrolled if needed; a click
opens that task via `openWorkItemDetailModal(id)`. The dots slot and status badge have fixed
widths so assignee/status columns stay aligned across rows. `addWorkItem()` seeds an empty array
so a brand-new item does not wait for a fetch; `addChildTask()` / `applyFieldUpdate()` keep the
map in sync.

**Task Mode** - `toggleTaskMode()` flips `store.taskMode`, and if turning on calls
`ensureTasksLoaded(activeProduct)` (lazy - a no-op if that product's tasks are already cached).
`loadChildTasksIntoStore(product)` fetches `store.visibleParentIds` (scoped to `activeProduct`) in
batches of 200 (`fetchChildTasksForWorkItems`) and **merges** the result into `store.childTasks`
(never replaces it), then marks `product` in `taskLoadedProducts`. Switching to another tab while
Task Mode is on lazily loads that tab's tasks via the `activateProduct` watcher above, without
discarding tasks already cached for other tabs. Task Mode still uses the full work-item payload;
it does not read `taskDotStatus`.

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

**Description format** - Azure DevOps lets each large text field (`System.Description`,
`Microsoft.VSTS.TCM.ReproSteps`, ...) independently be `HTML` (default) or `Markdown`, and the
choice is one-way (a field saved as Markdown can never revert to HTML). `openWorkItemDetailModal()`
resolves `d.descriptionFieldPath` (`ReproSteps` for a Bug if it has content, else
`System.Description`) the same way it always has, then reads that field's format off the work
item's `multilineFieldsFormat` map into `d.descriptionFormat`. Azure DevOps returns that map's
values lower-cased (`"markdown"`/`"html"`), so the comparison is case-insensitive; `'Html'` is the
fallback when the map or that entry is absent, which is every item that behaved this way before
Markdown support existed. `d.descriptionFormatLocked` mirrors whether the server already says
Markdown - if so the format toggle disables the `HTML` option outright (matches Azure DevOps' own
one-way rule). The template picks `<html-editor>` or `<markdown-editor>` on `d.descriptionFormat`;
when `store.canWrite`, a toggle next to the label lets the user convert an HTML field to Markdown
before saving. `switchDescriptionFormat()` guards the one-way lock, then delegates to
`switchFormDescriptionFormat(target, format, htmlEditorId, markdownEditorId)` - shared with both
create forms' toggle - which reads back whatever is currently in the mounted editor (both editors
are uncontrolled) and snapshots it into `descriptionHtmlCache`/`descriptionMarkdownCache` (whichever
matches the format being left) before switching. If the format being switched *into* already has a
cached snapshot - typically because the user was just there - that snapshot is restored verbatim;
otherwise `convertDescriptionContent()` runs the lossy conversion (Turndown for Html -> Markdown,
`marked.parse()` for the reverse, only reachable pre-save while the field isn't locked yet). This
makes toggling non-destructive: flipping Html -> Markdown -> Html with no edits returns the exact
original HTML instead of a freshly-regenerated (and likely different) one, and edits made in either
format survive further toggling instead of being silently discarded by a fresh conversion. The
caches are `null` until first populated and reset on every modal open (`openWorkItemDetailModal()`,
`openCreateWorkItemModal()`, `openCreateTaskModal()`). Before the Html -> Markdown conversion, `restoreDevOpsImageUrls()` swaps any `<img>`'s `src` back
from its displayed `blob:` URL to the real attachment URL stashed in `data-devops-url` by
`replaceImagesWithAuthenticatedBlobs()` (see the Attachments row in
[Azure DevOps API surface](#azure-devops-api-surface)) - without it, Turndown would read the
throwaway blob: URL straight off `src` and bake a link into the Markdown that stops working the
moment the tab closes. `updateWorkItemDescription()`
branches on `d.descriptionFormat` - reading back with
`readDetailDescriptionHtml()`/`processImagesForDevOps()` or
`readDetailDescriptionMarkdown()`/`processImagesForDevOpsMarkdown()` - and, only on the Markdown
branch, adds a `/multilineFieldsFormat/<path>` op asserting `'Markdown'` alongside the field op:
this both performs the one-time conversion and re-asserts the format on every subsequent save as
insurance against it ever reverting. Both image processors funnel uploads through the shared
`uploadImageAttachment()`.

**Adding a comment** - existing comments stay read-only (no edit/delete), but `store.canWrite`
users get an "Add a comment" composer above the list (it sits above rather than below because the
list sorts newest-first, same as Azure DevOps' own comment format concept but reusing Releasy's own
`<html-editor>`/`<markdown-editor>` pair and toggle instead of a third editor implementation).
`d.newComment` deliberately reuses `descriptionFormat`/`descriptionHtml`/`descriptionHtmlCache`/
`descriptionMarkdownCache` as its field names (defaulting to `'Markdown'`, no lock - a fresh comment
can freely be either) purely so `switchCommentFormat()` can call the exact same
`switchFormDescriptionFormat()` used by the description toggle and both create forms, against this
nested object instead of `d` itself. `submitNewWorkItemComment()` reads back the mounted editor,
runs it through the same `processImagesForDevOps()`/`processImagesForDevOpsMarkdown()` used for
descriptions (both are already generic, not tied to a specific field), then `POST`s to
`/wit/workItems/{id}/comments?format=markdown|html` (format is a query param here, not a
`/multilineFieldsFormat` op, since Add Comment takes it per-request) and unshifts the response -
mapped through the same `mapCommentForDisplay()` the initial load uses - onto `d.comments`. Clearing
`d.newComment.descriptionHtml` afterwards is enough to blank whichever editor is mounted, since both
already watch their own `html`/`markdown` prop and re-render on change.

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
`store.createWorkItem` (including `descriptionFormat`, reset to `'Markdown'` unless `prefill`
carries `'Html'` - see `copyWorkItemFromDetail()`) -> `createWorkItem()` validates, resolves
`epicID` from
`releaseNames`, reads the description back from whichever editor is mounted
(`readEditorHtml()`/`readMarkdownEditorText()`), builds JSON-patch operations (title with prefix,
priority, tags, `Custom.PlatformRelease`, parent Epic link, description into `ReproSteps` for Bug,
severity for Bug / t-shirt for Feature, plus `/multilineFieldsFormat/<field>` when Markdown was
picked) -> `createWorkItemViaApi()` returns the full created item -> `store.addWorkItem()` places
it straight into `store.releaseResults` (via `insertWorkItem()`, same bucket logic as
`moveWorkItemPatch()`) -> `openWorkItemCreatedModal()`. No reload: the create response already has
every field Azure DevOps assigned it. `copyWorkItemFromDetail()` prefills the same form (reading
back from the detail item's own format/editor) and sets `store.closeDetailAfterCreate`.

**Create child task** - `openCreateTaskModal(parentId, parentTitle, prefill)` fills
`store.createTask` (same `descriptionFormat` toggle as the work item form) -> `createChildTask()`
-> operations + `Hierarchy-Reverse` relation to the parent (+ `/multilineFieldsFormat/...` when
Markdown was picked) -> `createWorkItemViaApi('Task', ...)` -> `store.addChildTask(parentId,
createdTask)` appends it to `store.childTasks[parentId]`, and if the detail modal for that parent
is open, it is also appended to `store.detail.tasks` directly (no re-fetch) -> success modal.

**Markdown export** - `exportPatchToMarkdown(product, release, major, patch, patchId)` finds the
patch node in `store.tree` (so it exports exactly what is visible), re-fetches those ids with
`$expand=fields`, and builds a `.md` file (heading per work item, priority/t-shirt/severity line,
description) downloaded as a `Blob`.

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
| Work item batch | `GET /wit/workitems?ids=...&$expand=fields&api-version=6.0` (Markdown export uses 7.1) |
| Detail | `GET /wit/workitems/{id}?$expand=Relations&api-version=7.1` - no `fields=` projection, so the response's `multilineFieldsFormat` map (read into `d.descriptionFormat`) is populated |
| Child tasks (Task Mode) | `GET /wit/workitems?ids=...&$expand=relations&api-version=6.0`, batched by 200, then a second batch of the child ids with all fields |
| Task-status dots | `GET /wit/workitems?ids=...&$expand=relations&api-version=6.0` for parents (no `fields` — Azure DevOps returns `ConflictingParametersException` if `$expand` is combined with `fields`), then `GET /wit/workitems?ids=...&fields=System.Id,System.Title,System.State,System.WorkItemType&api-version=6.0` for children (`fetchTaskDotStatusForParents`) |
| Comments | `GET /wit/workItems/{id}/comments?api-version=7.1-preview.4&$expand=renderedText` (paged, see `fetchWorkItemCommentsAll`) - `$expand` gets each comment's server-rendered HTML alongside its raw `text`, needed because each comment independently carries its own `format` (`"markdown"`/`"html"`, same lower-cased convention as `multilineFieldsFormat`); `mapCommentForDisplay()` picks `renderedText` for Markdown comments (falling back to `marked.parse()` if ever absent) and `text` for HTML ones. Existing comments are still read-only (never editable/deletable); `POST /wit/workItems/{id}/comments?format=markdown\|html&api-version=7.1-preview.4` (`submitNewWorkItemComment()`) adds a brand-new one from the detail modal's composer, format chosen per-comment via the same query param (not a field-level op like descriptions) |
| Field update | `PATCH /wit/workitems/{id}?api-version=7.1`, `application/json-patch+json` |
| Create | `POST /wit/workitems/${type}?api-version=7.1` (must be 7.1+ - the `/multilineFieldsFormat/<field>` op used for Markdown descriptions on create is silently ignored on older versions) |
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
8. **The description editors are uncontrolled.** Push content in via the `html`/`markdown` prop,
   read it back with `readEditorHtml(id)`/`readMarkdownEditorText(id)` on submit, and call
   `$refs.editor.render()` when a modal opens (an unsaved edit means the prop may not change). Both
   `HtmlEditor` and `MarkdownEditor` share the `ref="editor"` name behind a `v-if`/`v-else` (the
   detail modal and both create forms), so callers do not need to know which one is currently
   mounted.
9. **`initializeHtmlEditor()` must not clone its toolbar.** It marks bound editors with
   `dataset.boundEditor`; cloning detaches Vue's bindings (this previously broke `v-show` on the
   toolbar in read-only mode).
10. **Log through `Logger`**, not `console`, and keep the `mountApp` error handler on new apps.
11. **Root elements that could flash raw markup carry `v-cloak`.**
12. Async work that lands in a modal must **re-check the id/open flag** before writing to the
    store.

## Gotchas

- **Task-dot cache is per parent id, not per product.** A missing `taskDotStatus[id]` means "not
  loaded"; `[]` means "loaded, no tasks". Do not treat a missing key as "no tasks" or the hollow
  ring will flash during the background fetch. Do not merge this slim payload into `childTasks`.
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
- Many comments describe the **removed** imperative helpers (`filterWorkItems()`,
  `updateHierarchyVisibility()`, `updateEditVisibility()`, ...) as migration notes. They are history,
  not code that exists.
- `changeWorkItemAssignedTo()` and `changeWorkItemPatchVersion()` go through `updateWorkItemField()`
  like every other field change, via its `storeValue` (store write differs from the PATCH body
  value) and `applyToStore: false` (Patch Version relocates the item with `moveWorkItemPatch()`
  instead) options - do not re-inline their own `fetch()` calls.
- **A field's Markdown/HTML format is one-way and per-field.** Once `System.Description` or
  `Microsoft.VSTS.TCM.ReproSteps` is saved as Markdown in Azure DevOps, it can never go back to
  HTML - in the DevOps UI or via the API. The detail modal's format toggle enforces this:
  `d.descriptionFormatLocked` disables the `HTML` option once the server already reports Markdown,
  so only `Html -> Markdown` is ever offered. Unlike Azure DevOps' own format toggle (a flag flip
  with no content rewrite), Releasy's toggle actually converts the content -
  `convertDescriptionContent()` runs it through Turndown (`TurndownService`, CDN, global
  `TurndownService`) - so the HTML markup does not leak as literal text into the Markdown source.
- **`multilineFieldsFormat` values come back lower-cased** (`"markdown"`, `"html"`), not
  capitalized - compare case-insensitively. A strict `=== 'Markdown'` check will always be false and
  silently fall back to the `Html` branch even for a field genuinely saved as Markdown.
- **Create forms (Feature/Bug/Task) let the user pick the format up front**, via the HTML/Markdown
  toggle next to the Description field (`form.descriptionFormat`, defaults to `Markdown`) - safe to
  set explicitly here (unlike the detail modal) because a brand-new field has no existing content
  that could be lost or silently reformatted. `createWorkItem()`/`createChildTask()` add the
  `/multilineFieldsFormat/<field>` op alongside the field op only when Markdown was chosen.
  Copying a work item from the detail modal (`copyWorkItemFromDetail()`) carries over the source
  item's format and content unchanged. Switching the toggle mid-edit goes through
  `switchFormDescriptionFormat()` (same function the detail modal uses), so whatever was already
  typed is read back, cached per-format, and restored verbatim on toggling back rather than lost or
  re-converted (see [Description format](#flows-what-calls-what)).
- `exportPatchToMarkdown()` still runs every description through the HTML-oriented `htmlToText()`
  regardless of `multilineFieldsFormat` - for an already-Markdown description this is a mostly
  harmless no-op today, but it is not format-aware.

## Where to change what

| Task | Where |
| --- | --- |
| Add a product / release | `releaseNames` (+ `epicID`), `titlePrefixes`, `availablePatchVersions`, optionally `buildChangesPipelineMap` |
| Add a patch version to a picker | `availablePatchVersions` |
| Add / remove an assignee | `assignees` |
| Change allowed statuses | `statusOptions` |
| Change which items load | the WIQL query in `loadProductData()` (types, `Closed` window) |
| Add a column or badge to a row | `tpl-work-item-row` (+ `WorkItemRow` computed) |
| Change task-status dots | `store.taskDotStatus`, `fetchTaskDotStatusForParents()`, `tpl-work-item-row` |
| Add a field to the detail modal | `#workItemDetailApp` markup + its computed |
| Add a new "change X" modal | a new entry in `PICKER_KINDS` (`build` + `apply`) - no new markup |
| Add a new modal | markup root in `<body>`, store slice, `mountApp`, `MODAL_STACK` entry |
| Change a filter rule | `itemPasses()` / `store.tree` |
| Change the Markdown layout | `exportPatchToMarkdown()` |
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
