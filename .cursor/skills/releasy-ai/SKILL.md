---
name: releasy-ai
description: >-
  Create, read, and manage Azure DevOps Bugs/Features/Tasks and their comments for the
  smartermdm/Board project directly via the Azure DevOps REST API, bypassing the Releasy
  front-end. Use when the user asks to create a bug/feature/task ticket, add a task to an
  existing ticket, add a comment to a ticket, change a ticket's status, or look up/read an
  existing Azure DevOps work item, for any of Xeelo, XeeloAdmin, Integray, Repository, or
  Connectors.
---

# releasy-ai

Scripts in `scripts/` do the actual API calls; this file is the workflow that decides what to put
in them. Full field mappings, the JSON plan schema, and relation types are in
[reference.md](reference.md) - read it before drafting a plan or a script call you're unsure about.

**Never skip the confirmation step.** Every path below ends with printing a plan/summary and
waiting for the user to confirm before any script that writes to Azure DevOps is run. Read-only
calls (`get-ticket.mjs`, `releasy-config.mjs`) don't need confirmation.

## Credentials

`AZURE_DEVOPS_PAT` from `.env` in this folder (copy `.env.example`) or an exported env var. If
neither is set, the scripts fail with a clear message - don't ask the user for their PAT in chat,
tell them to fill in `.env`.

## 0. Always start here

Run `node scripts/releasy-config.mjs` to get the current products, title prefixes, active
releases/majors/patches, epic IDs, assignees, and valid statuses. Never assume or hardcode any of
these - they change as products move between release waves. If the request names an existing
ticket (a number or a DevOps URL), also run `node scripts/get-ticket.mjs <id>` first to load its
current fields, child Tasks, and comments before doing anything else with it.

## 1. Creating a new Bug or Feature (+ optional Tasks)

1. Resolve product from the request. If the change spans multiple products (e.g. a Xeelo change
   that also needs a XeeloAdmin change), plan one item per product - each resolves its own
   release/epic independently - and link them with `relatedRefIds` (see reference.md).
2. Resolve the title prefix against `titlePrefixes[product]`.
3. Resolve release/major: look up the product's active series in `availablePatchVersions`. If a
   product has more than one active series (e.g. Xeelo currently has both `Labe-07` and
   `Odra-01`), list them and ask the user which one - never guess.
4. Resolve patch: ask if this belongs to a specific already-scheduled patch, or the backlog.
   Backlog = patch `"999"` (per your instruction: "add to backlog" always means the `999` suffix).
5. Always ask: Priority (1-4), and Severity (Bug) or T-shirt size (Feature) - never silently
   default. If the user has no preference, fall back to Releasy's own defaults: Priority/Severity
   `3 - Medium`, T-shirt `M`.
6. Ask for an assignee (validate against the live `assignees` list) - optional, unassigned is fine.
7. Description format defaults to Markdown unless the user asks for HTML.
8. If the ticket needs Tasks created right away (e.g. the initial 1-5 DEV tasks), nest them under
   the item in the plan - see reference.md's Task fields. A Task added *later* (e.g. a TEST task
   once the DEV tasks are done) does not belong here - use step 4 below instead.
9. Build the JSON plan (schema in reference.md), print a human-readable summary - type, product,
   title, release/patch or "Backlog", priority/severity or t-shirt, assignee, nested tasks, any
   related links - and **stop for explicit confirmation**.
10. On confirmation, write the plan to a temp file and run:
    `node scripts/create-ticket.mjs <planfile>`
    Report back the created IDs and their DevOps URLs.

Validate first with `node scripts/create-ticket.mjs <planfile> --dry-run` if you want to sanity
check the plan against live config without creating anything yet.

## 2. Adding a Task to a ticket that already exists

The common case: a Feature already has its DEV tasks, and now needs a TEST task once they're
done - or any other Task added to a ticket after the fact. No plan file needed.

1. Confirm the parent (via `get-ticket.mjs` if not already loaded) is a Bug or Feature, not a
   Task - a Task cannot itself have child Tasks.
2. Gather just the Task's own fields - prefix (validate against `titlePrefixesTask`), title,
   description, optional assignee. No product/release/epic/priority questions; those only apply
   to the parent.
3. Print the summary and confirm, then run:
   `node scripts/create-task.mjs <parentId> --prefix DEV --title "..." [--description "..."] [--assignee email]`

## 3. Changing a ticket's status

1. Load the ticket (`get-ticket.mjs`) to see its current type and state if not already loaded.
2. Confirm the target state is valid for that type (Bug/Feature have `Evaluation` as an extra
   option Tasks don't - see live `statusOptions`).
3. Confirm with the user, then run:
   `node scripts/change-status.mjs <id> <newState>`

## 4. Editing fields on a ticket that already exists

1. Load the ticket first (`get-ticket.mjs`).
2. Only propose fields valid for that item's type - same per-type rules as creation: no Severity
   on a Feature, no Priority/Severity/T-shirt/PlatformRelease on a Task, etc.
3. Validate new values against live config exactly as in creation (prefix, patch, assignee...).
4. Print a before/after summary and confirm, then run:
   `node scripts/update-ticket.mjs <id> [--title ...] [--priority ...] [--severity ...] [--tshirt ...] [--release ... --major ... --patch ...] [--assignee ... | --unassign] [--description ... | --description-file ...]`

Note: description edits stay in whatever format (HTML/Markdown) the field already has - no
HTML<->Markdown conversion here (browser-only Releasy-UI feature, see reference.md).

## 5. Adding a comment

**Bug or Feature only - never a Task.** `add-comment.mjs` itself checks the item's type and
refuses on a Task, but say so upfront rather than let the user hit that error.

1. Load the ticket if not already loaded, confirm it's a Bug or Feature.
2. Draft the comment text - Markdown by default unless HTML is requested.
3. Confirm with the user, then run:
   `node scripts/add-comment.mjs <id> --format markdown --text "..."`
   (use `--file path` instead of `--text` for long comments)

## 6. Just looking something up

`node scripts/get-ticket.mjs <id-or-url>` is read-only - no confirmation needed. Use it whenever
the user asks to "look at", "show me", or "what's the status of" a ticket.

## Maintenance

If any of these scripts start failing after `index.html` changes (new/renamed config constant, a
changed field mapping, a changed API version), see the reminder in `AGENTS.md`'s "Documentation
duties" section - most product/release/prefix/status data is read live via
`scripts/releasy-config.mjs`, but the field-mapping/endpoint logic embedded in the other scripts
is not, and needs a matching update here.
