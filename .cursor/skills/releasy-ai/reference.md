# releasy-ai reference

Detailed field mappings, the JSON plan schema, and relation types behind the scripts in
`scripts/`. See `SKILL.md` for the workflow that uses these.

Everything here mirrors `index.html` in the Releasy repo (`createWorkItem()`, `createChildTask()`,
`updateWorkItemDescription()`, `changeWorkItemStatus()`, `submitNewWorkItemComment()`,
`openWorkItemDetailModal()`) - this file documents that mapping, it does not replace it. Product/
release/prefix/assignee/status data itself is never hardcoded here; it is always read live via
`scripts/releasy-config.mjs`.

## Credentials

`AZURE_DEVOPS_PAT` in `.env` (copy `.env.example`) or exported in the environment. This is a
dedicated PAT for this skill, separate from the repo's own `dev.env` (see `AGENTS.md`).

## Field mapping

### Bug / Feature (creation and edits)

| Field | Path | Notes |
|---|---|---|
| Title | `System.Title` | `"<prefix> - <text>"`. `prefix` must be one of `titlePrefixes[product]`. |
| Priority | `Microsoft.VSTS.Common.Priority` | Integer 1-4. Required. |
| Product | `System.Tags` | The product name itself (e.g. `"Xeelo"`), not a tag list. |
| Platform release | `Custom.PlatformRelease` | `"<Release>-<major>.<patch>"`, e.g. `"Labe-07.999"`. `patch` must be one of `availablePatchVersions[product].versions[...].patches`; `"999"` is backlog. |
| Description | `Microsoft.VSTS.TCM.ReproSteps` (Bug) or `System.Description` (Feature) | Plain text/HTML/Markdown string. |
| Description format | `/multilineFieldsFormat/<field>` | Only added when the description is Markdown; op `add`, value `"Markdown"`. Once a field is saved as Markdown in Azure DevOps it cannot revert to HTML - this skill never attempts that. |
| Severity (Bug only) | `Microsoft.VSTS.Common.Severity` | Label string, e.g. `"2 - High"` (`resolveSeverityLabel()` in `releasy-config.mjs` accepts either the digit or the full label). |
| T-shirt size (Feature only) | `Custom.Shirtsize` | One of `S`, `M`, `L`. Optional. |
| Assignee | `System.AssignedTo` | Email string; must be one of the live `assignees`. |
| Parent Epic | relation | `System.LinkTypes.Hierarchy-Reverse` -> `.../wit/workitems/<epicID>`, `epicID` resolved from `releaseNames` by release name. |
| Status | `System.State` | One of the live `statusOptions.Bug` / `statusOptions.Feature`. |

### Task

| Field | Path | Notes |
|---|---|---|
| Title | `System.Title` | `"<prefix> - <text>"`, `prefix` must be one of `titlePrefixesTask`. |
| Description | `System.Description` | No ReproSteps variant. Draft per **Child task content (DEV vs TEST)** in SKILL.md: DEV may be technical and split SQL vs back-end+front-end as the requester asked; TEST is a front-end manual scenario for a medior tester (console/network ok, no DB, no back-end API testing) covering **only the change**; unrelated findings go to a new Bug/Feature on the correct product. |
| Description format | `/multilineFieldsFormat/System.Description` | Same Markdown-only rule as above. |
| Assignee | `System.AssignedTo` | Optional. |
| Parent | relation | `System.LinkTypes.Hierarchy-Reverse` -> `.../wit/workitems/<parentId>`. |
| Status | `System.State` | One of the live `statusOptions.Task` (no `Evaluation`). |

Tasks never get: Priority, Severity, T-shirt size, Tags, or PlatformRelease - `update-ticket.mjs`
and `create-ticket.mjs` reject those fields on a Task.

**Exception — release-container Tasks** created by `create-release.mjs` (see below): their titles
have no `DEV`/`TEST` prefix, and they *do* get `Custom.PlatformRelease` copied from the parent,
matching Labe-07.013 (#10077-#10082). Regular `create-task.mjs` Tasks still do not.

### Comments

Bug/Feature only - never a Task. Every script that touches an existing item's comments
(`add-comment.mjs`, and `get-ticket.mjs` when reading them back) checks `System.WorkItemType`
first and refuses on a Task.

`POST /wit/workitems/{id}/comments?format=markdown|html&api-version=7.1-preview.4`, body
`{ "text": "..." }`. `format` is per-request, not per-field like `multilineFieldsFormat` - each
comment on the same item can independently be Markdown or HTML.

Reading comments back: `GET /wit/workitems/{id}/comments?api-version=7.1-preview.4&$expand=renderedText`
(paginated via `continuationToken`). `$expand=renderedText` is what makes a Markdown comment's
server-rendered HTML available - a Markdown comment's own `text` is raw Markdown source, not HTML.

## Relation types

| Relation | Meaning | Used by |
|---|---|---|
| `System.LinkTypes.Hierarchy-Reverse` | "my parent is X" | Bug/Feature -> Epic; Task -> Bug/Feature. Set on the child, pointing at the parent's URL. |
| `System.LinkTypes.Hierarchy-Forward` | "my child is X" | The complementary side of Hierarchy-Reverse; Azure DevOps maintains it automatically once Hierarchy-Reverse is added. `get-ticket.mjs` reads this relation on a Bug/Feature to find its child Tasks. |
| `System.LinkTypes.Related` | "see also X" (symmetric) | Multi-product companion tickets (e.g. Xeelo + XeeloAdmin). Add once (on either item) - Azure DevOps shows it on both sides. |

## Description format limitation on `update-ticket.mjs`

`update-ticket.mjs --description`/`--description-file` writes the new text into whichever
description field the item already uses, and re-asserts the existing `multilineFieldsFormat` if
it's already Markdown (insurance against Azure DevOps ever silently reverting it - same as
`updateWorkItemDescription()` does on every save, not just the first). It does **not** convert
between HTML and Markdown, and it does **not** upload pasted screenshots as attachments - both of
those are Releasy-UI-only features (`convertDescriptionContent()` via Turndown/marked, and
`processImagesForDevOps()`/`processImagesForDevOpsMarkdown()`) that depend on a live browser DOM
and have no CLI equivalent. Supply description edits already in the item's current format, with
any images already hosted (an existing attachment URL, or a plain link) rather than pasted.

## JSON plan schema (`create-ticket.mjs`)

Creates one or more brand-new Bugs/Features, each with an optional nested `tasks` array (Tasks
created in the *same run* as their new parent), plus optional `relatedRefIds` cross-links between
items in the plan.

```json
{
  "items": [
    {
      "refId": "A",
      "type": "Bug",
      "product": "Xeelo",
      "prefix": "Xeelo",
      "title": "Free-text title",
      "descriptionMarkdown": "...",
      "priority": 2,
      "severity": "2 - High",
      "release": "Labe",
      "major": "07",
      "patch": "999",
      "assigneeEmail": "foo@bar.com",
      "tasks": [
        { "prefix": "DEV", "title": "...", "descriptionMarkdown": "...", "assigneeEmail": "..." }
      ]
    },
    {
      "refId": "B",
      "type": "Feature",
      "product": "XeeloAdmin",
      "prefix": "Xeelo admin",
      "title": "Companion change on the admin side",
      "tshirtSize": "M",
      "priority": 3,
      "release": "Odra",
      "major": "01",
      "patch": "999",
      "relatedRefIds": ["A"]
    }
  ]
}
```

Field notes:

- `refId`: required, unique within the plan - used for `relatedRefIds` and to report back which
  created ID corresponds to which planned item.
- `type`: `"Bug"` or `"Feature"` only. A standalone Task on an *already-existing* parent does not
  use this schema at all - see `create-task.mjs` below.
- `descriptionMarkdown` xor `descriptionHtml` - pick one; Markdown is the default per your
  instruction unless HTML was explicitly requested.
- `severity` is Bug-only, `tshirtSize` is Feature-only - `create-ticket.mjs` rejects the wrong one
  for the type.
- `patch: "999"` is exactly what "add to backlog" means.
- `tasks[]` items follow the Task field mapping above; no product/release/priority fields (Tasks
  don't have them).
- `relatedRefIds`: array of other `refId`s in the same plan to `System.LinkTypes.Related`-link
  this item to.

## `create-task.mjs` (adding a Task to an item that already exists)

No plan file - flags only:

```
node scripts/create-task.mjs <parentId-or-url> --prefix DEV --title "..." \
  [--description "..." | --description-file path] [--format markdown|html] [--assignee email]
```

Rejects the parent if it is a Task (a Task cannot itself have child Tasks). `--format` defaults to
`markdown`.

## `list-tickets.mjs` (querying Bugs/Features + their Tasks for a release or the backlog)

Read-only (a WIQL query + a batch field fetch), no plan file, no confirmation needed. This is the
"what do we have queued up" / "what's not done yet" data source - it returns the raw list with
every field the other scripts use for validation (state, priority, severity, t-shirt, assignee,
dates) plus each item's Tasks with their own state/assignee/description; it does not itself decide
what counts as "not done" or "new" - filter/summarize the returned JSON for whatever the user asked.

```
node scripts/list-tickets.mjs --product <Product>
  [--release <ReleaseName>]      # default: that product's releaseNames entry
  [--major <NN>]                 # e.g. "07" - default: auto-resolved if the product has exactly
                                  # one configured major under this release, else required
  [--patch <NNN> | --backlog]    # --backlog is exactly patch "999"; requires major (auto-resolved
                                  # the same way); omit both to get every patch under the major
  [--state New,Active | --open]  # --open = NOT IN ('Closed','Removed'); default: no state filter
  [--no-tasks]                   # skip the per-item child-task fetch (faster for a big list)
  [--descriptions]               # include each Bug/Feature description (off by default)
```

Scope resolution, from most to least specific: `--major` + (`--patch` or `--backlog`) -> exactly
one `Custom.PlatformRelease` value (`WHERE = '<release>-<major>.<patch>'`). `--major` alone -> every
patch under that major (`CONTAINS '<release>-<major>.'`). Neither -> every major/patch under that
release name (`CONTAINS '<release>-'`) - the same scope `index.html`'s own `loadProductData()` uses
for a product's default tab.

Output shape:

```json
{
  "product": "Xeelo",
  "release": "Labe",
  "major": "07",
  "patch": "999",
  "scope": "Labe-07.999",
  "count": 2,
  "items": [
    {
      "id": 10180, "type": "Bug", "title": "...", "state": "New",
      "priority": 2, "severity": "2 - High", "tshirtSize": null,
      "platformRelease": "Labe-07.999", "assignedTo": "Tomas Belak",
      "createdDate": "...", "changedDate": "...",
      "url": "https://provisioning.integray.app/.../release-overview?workitem=10180",
      "tasks": [
        { "id": 10181, "title": "DEV - ...", "state": "New", "assignedTo": "...", "description": "...", "url": "..." }
      ]
    }
  ]
}
```

Notes:

- `getWorkItemsBatch()` in `lib.mjs` chunks any ID list over 200 into multiple requests
  automatically (Azure DevOps rejects more than 200 IDs per call, `VS403474`) - relevant here
  because an unfiltered whole-release query can easily return 200+ items.
- Tasks are fetched per matched item (one extra call each) unless `--no-tasks` is passed - for a
  large, unfiltered scope this can be dozens of extra calls; narrow with `--major`/`--patch`/
  `--state`/`--open` first if you only need a subset.
- `--state` is validated against the live `statusOptions.Bug` (Bug and Feature share the same
  state list in the current config).
- `--descriptions` adds a `description` string on each item (same field pick as `get-ticket.mjs`:
  Bug uses `Microsoft.VSTS.TCM.ReproSteps` when present, otherwise `System.Description`; Feature
  always uses `System.Description`). Omit it for list/summary questions so the JSON stays small;
  pass it when the caller needs the raw ticket text (e.g. the `releasy-notes` skill).

## `create-release.mjs` (release-container Feature + 6 checklist Tasks)

Not a normal Bug/Feature. Template is Labe-07.013 (`Release: Labe-07.013 (18/08/2026)`, Feature
#10076). Title has **no** product prefix; child Tasks have **no** `titlePrefixesTask` prefix.
`create-ticket.mjs` / `create-task.mjs` cannot produce this shape. Workflow (confirm first) is
the sibling `releasy-release` skill.

```
node scripts/create-release.mjs --version Labe-07.014 --date 25/08/2026 [--dry-run]
node scripts/create-release.mjs --product Xeelo --release Labe --major 07 --patch 014 --date 25/08/2026
```

`--date` is stored in the title as `DD/MM/YYYY` (also accepts `YYYY-MM-DD` / `D.M.YYYY`).
Defaults: `--owner` and `--steps-assignee` (tasks 01-05) `tomas.kocyan@intelstudios.com`;
`--production-assignee` (task 06) `tomas@intelstudios.com`. Refuses backlog patch `999` and
refuses to create a second container for the same
`Custom.PlatformRelease`. Feature is Priority 4, no t-shirt, no description.

## Other script flag references

- `change-status.mjs <id-or-url> <newState>` - `newState` validated against the live
  `statusOptions` for that item's own type.
- `update-ticket.mjs <id-or-url> [--title ...] [--priority ...] [--severity ...] [--tshirt ...]
  [--release ... --major ... --patch ...] [--assignee ... | --unassign]
  [--description ... | --description-file ...]` - any subset; only the given fields change.
- `add-comment.mjs <id-or-url> --format markdown|html (--text "..." | --file path)`.
- `get-ticket.mjs <id-or-url>` - read-only, prints fields/state/relations-derived parent or child
  Tasks/comments/`commentsAllowed` as one JSON object.
- `list-tickets.mjs --product <name> [--release ... ] [--major ... ] [--patch ... | --backlog]
  [--state s1,s2 | --open] [--no-tasks] [--descriptions]` - read-only, see below.
- `releasy-config.mjs` - no arguments, prints the live config as JSON.
- `create-release.mjs --version Labe-07.014 --date 25/08/2026 [--dry-run]` - release-container
  Feature + 6 checklist Tasks; see above. Not a substitute for `create-ticket.mjs`.

All scripts accept a bare numeric work item ID, a Releasy `...release-overview?workitem=<id>`
link, or a full `https://dev.azure.com/<org>/<project>/_workitems/edit/<id>` DevOps URL wherever
an ID is expected. Every script that reports on a work item (create, update, status change,
comment, task, get) prints/returns a Releasy link
(`https://provisioning.integray.app/api/endpoint/web-app/azure-devops/release-overview?workitem=<id>`),
not a raw DevOps link - see `releasyWorkItemUrl()` in `scripts/lib.mjs`.
