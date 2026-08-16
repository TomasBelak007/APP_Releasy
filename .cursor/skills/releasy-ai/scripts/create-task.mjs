#!/usr/bin/env node
// Adds one new Task to an already-existing Bug/Feature - the common "1-5 DEV tasks up front,
// then a TEST task once they're done" flow. No JSON plan file needed; create-ticket.mjs's
// nested `tasks` array is for Tasks created in the same run as a brand-new parent instead.
//
// Usage:
//   node create-task.mjs <parentId-or-url> --prefix DEV --title "..."
//                         [--description "..." | --description-file path]
//                         [--assignee email]

import { loadReleasyConfig, isValidPrefix, isValidAssignee } from './releasy-config.mjs';
import { loadPat, getWorkItemType, createWorkItemApi, releasyWorkItemUrl, parseWorkItemId, parseArgs, readTextFlag, fail } from './lib.mjs';

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (!positional[0]) fail('Usage: node create-task.mjs <parentId-or-url> --prefix DEV --title "..." [--description ... | --description-file ...] [--assignee email]');

  const parentId = parseWorkItemId(positional[0]);
  const cfg = loadReleasyConfig();
  const pat = loadPat();

  const parentType = await getWorkItemType(cfg, parentId, pat);
  if (parentType !== 'Bug' && parentType !== 'Feature') {
    fail(`Work item #${parentId} is a ${parentType}, not a Bug or Feature - a Task cannot be the parent of another Task.`);
  }

  const errors = [];
  if (!flags.prefix || !isValidPrefix(cfg, 'Task', null, flags.prefix)) {
    errors.push(`--prefix "${flags.prefix ?? ''}" is not a valid Task prefix. Valid: ${cfg.titlePrefixesTask.join(', ')}.`);
  }
  if (!flags.title || !String(flags.title).trim()) {
    errors.push('--title is required.');
  }
  if (flags.assignee && !isValidAssignee(cfg, flags.assignee)) {
    errors.push(`--assignee "${flags.assignee}" is not in the known assignees list.`);
  }
  if (flags.description !== undefined && flags['description-file'] !== undefined) {
    errors.push('Provide either --description or --description-file, not both.');
  }
  if (errors.length) {
    console.error(`Cannot create task (${errors.length} problem${errors.length === 1 ? '' : 's'}):`);
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  const description = readTextFlag(flags, 'description', 'description-file');
  const isMarkdown = flags.format !== 'html';
  const title = `${flags.prefix} - ${String(flags.title).trim()}`;

  const operations = [{ op: 'add', path: '/fields/System.Title', value: title }];
  if (description) {
    operations.push({ op: 'add', path: '/fields/System.Description', value: description });
    if (isMarkdown) {
      operations.push({ op: 'add', path: '/multilineFieldsFormat/System.Description', value: 'Markdown' });
    }
  }
  if (flags.assignee) {
    operations.push({ op: 'add', path: '/fields/System.AssignedTo', value: flags.assignee });
  }
  operations.push({
    op: 'add',
    path: '/relations/-',
    value: {
      rel: 'System.LinkTypes.Hierarchy-Reverse',
      url: `https://dev.azure.com/${cfg.organization}/${cfg.project}/_apis/wit/workitems/${parentId}`
    }
  });

  const created = await createWorkItemApi(cfg, 'Task', operations, pat);
  console.log(`Task #${created.id} "${created.fields['System.Title']}" created under ${parentType} #${parentId} - ${releasyWorkItemUrl(created.id)}`);
}

main().catch((e) => fail(e.message));
