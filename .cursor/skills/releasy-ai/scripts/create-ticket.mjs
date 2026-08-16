#!/usr/bin/env node
// Creates one or more brand-new Bugs/Features (+ their nested Tasks, + any Related cross-links
// between items in the same plan) from a JSON plan file. See reference.md for the plan schema.
//
// Usage:
//   node create-ticket.mjs <plan.json>
//   node create-ticket.mjs <plan.json> --dry-run   (validate only, no API calls)
//
// Adding a Task to a ticket that already exists does NOT go through this script - use
// create-task.mjs instead (no plan file needed for that single-Task case).

import fs from 'node:fs';
import {
  loadReleasyConfig,
  findEpicId,
  isValidPrefix,
  isValidPatch,
  isValidAssignee,
  isValidPriority,
  resolveSeverityLabel,
  isValidTshirtSize
} from './releasy-config.mjs';
import { loadPat, createWorkItemApi, patchWorkItem, releasyWorkItemUrl, parseArgs, fail } from './lib.mjs';

function validatePlan(plan, cfg) {
  const errors = [];
  if (!plan || !Array.isArray(plan.items) || plan.items.length === 0) {
    return ['Plan must have a non-empty "items" array.'];
  }

  const refIds = new Set();
  plan.items.forEach((item, idx) => {
    const label = `items[${idx}]${item.refId ? ` (refId "${item.refId}")` : ''}`;

    if (!item.refId || typeof item.refId !== 'string') {
      errors.push(`${label}: "refId" is required and must be a string, unique within the plan.`);
    } else if (refIds.has(item.refId)) {
      errors.push(`${label}: duplicate refId "${item.refId}".`);
    } else {
      refIds.add(item.refId);
    }

    if (item.type !== 'Bug' && item.type !== 'Feature') {
      errors.push(`${label}: "type" must be "Bug" or "Feature" (top-level items only - use create-task.mjs to add a Task to an existing item).`);
      return; // rest of the checks assume a valid type
    }

    if (!cfg.titlePrefixes[item.product]) {
      errors.push(`${label}: unknown product "${item.product}". Known products: ${Object.keys(cfg.titlePrefixes).join(', ')}.`);
    } else if (!isValidPrefix(cfg, item.type, item.product, item.prefix)) {
      errors.push(`${label}: prefix "${item.prefix}" is not valid for product "${item.product}". Valid: ${cfg.titlePrefixes[item.product].join(', ')}.`);
    }

    if (!item.title || !String(item.title).trim()) {
      errors.push(`${label}: "title" is required.`);
    }

    if (!isValidPriority(item.priority)) {
      errors.push(`${label}: "priority" must be one of 1-4 (got ${JSON.stringify(item.priority)}).`);
    }

    if (item.type === 'Bug' && item.tshirtSize) {
      errors.push(`${label}: "tshirtSize" is only valid on a Feature, not a Bug.`);
    }
    if (item.type === 'Feature' && item.severity) {
      errors.push(`${label}: "severity" is only valid on a Bug, not a Feature.`);
    }
    if (item.type === 'Bug' && item.severity && !resolveSeverityLabel(cfg, item.severity)) {
      errors.push(`${label}: severity "${item.severity}" is not a recognized rating (expected one of ${cfg.ratingLevels.map((l) => l.label).join(', ')}).`);
    }
    if (item.type === 'Feature' && item.tshirtSize && !isValidTshirtSize(item.tshirtSize)) {
      errors.push(`${label}: tshirtSize must be one of S, M, L (got ${JSON.stringify(item.tshirtSize)}).`);
    }

    if (!item.release || !item.major) {
      errors.push(`${label}: "release" and "major" are required.`);
    } else {
      if (!findEpicId(cfg, item.release)) {
        errors.push(`${label}: release "${item.release}" has no epicID in releaseNames - is this a current release?`);
      }
      if (!item.patch) {
        errors.push(`${label}: "patch" is required ("999" = backlog).`);
      } else if (!isValidPatch(cfg, item.product, item.release, item.major, item.patch)) {
        errors.push(`${label}: "${item.release}-${item.major}" patch "${item.patch}" is not a currently available patch version for "${item.product}".`);
      }
    }

    if (item.descriptionMarkdown && item.descriptionHtml) {
      errors.push(`${label}: provide either "descriptionMarkdown" or "descriptionHtml", not both.`);
    }

    if (item.assigneeEmail && !isValidAssignee(cfg, item.assigneeEmail)) {
      errors.push(`${label}: assignee "${item.assigneeEmail}" is not in the known assignees list.`);
    }

    (item.tasks || []).forEach((task, taskIdx) => {
      const taskLabel = `${label}.tasks[${taskIdx}]`;
      if (!isValidPrefix(cfg, 'Task', null, task.prefix)) {
        errors.push(`${taskLabel}: prefix "${task.prefix}" is not a valid Task prefix. Valid: ${cfg.titlePrefixesTask.join(', ')}.`);
      }
      if (!task.title || !String(task.title).trim()) {
        errors.push(`${taskLabel}: "title" is required.`);
      }
      if (task.descriptionMarkdown && task.descriptionHtml) {
        errors.push(`${taskLabel}: provide either "descriptionMarkdown" or "descriptionHtml", not both.`);
      }
      if (task.assigneeEmail && !isValidAssignee(cfg, task.assigneeEmail)) {
        errors.push(`${taskLabel}: assignee "${task.assigneeEmail}" is not in the known assignees list.`);
      }
    });
  });

  // Second pass: relatedRefIds must point at other items actually present in this plan.
  plan.items.forEach((item, idx) => {
    (item.relatedRefIds || []).forEach((refId) => {
      if (refId === item.refId) {
        errors.push(`items[${idx}]: relatedRefIds cannot reference its own refId.`);
      } else if (!refIds.has(refId)) {
        errors.push(`items[${idx}]: relatedRefIds references unknown refId "${refId}".`);
      }
    });
  });

  return errors;
}

function buildItemOperations(cfg, item) {
  const isBug = item.type === 'Bug';
  const epicID = findEpicId(cfg, item.release);
  const title = `${item.prefix} - ${String(item.title).trim()}`;
  const platformRelease = `${item.release}-${item.major}.${item.patch}`;
  const isMarkdown = !!item.descriptionMarkdown;
  const description = item.descriptionMarkdown || item.descriptionHtml;

  const operations = [
    { op: 'add', path: '/fields/System.Title', value: title },
    { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: parseInt(item.priority, 10) },
    { op: 'add', path: '/fields/System.Tags', value: item.product },
    { op: 'add', path: '/fields/Custom.PlatformRelease', value: platformRelease },
    {
      op: 'add',
      path: '/relations/-',
      value: {
        rel: 'System.LinkTypes.Hierarchy-Reverse',
        url: `https://dev.azure.com/${cfg.organization}/${cfg.project}/_apis/wit/workitems/${epicID}`
      }
    }
  ];

  if (description) {
    const descriptionField = isBug ? 'Microsoft.VSTS.TCM.ReproSteps' : 'System.Description';
    operations.push({ op: 'add', path: `/fields/${descriptionField}`, value: description });
    if (isMarkdown) {
      operations.push({ op: 'add', path: `/multilineFieldsFormat/${descriptionField}`, value: 'Markdown' });
    }
  }
  if (item.assigneeEmail) {
    operations.push({ op: 'add', path: '/fields/System.AssignedTo', value: item.assigneeEmail });
  }
  if (isBug) {
    operations.push({ op: 'add', path: '/fields/Microsoft.VSTS.Common.Severity', value: resolveSeverityLabel(cfg, item.severity ?? '3') });
  } else if (item.tshirtSize) {
    operations.push({ op: 'add', path: '/fields/Custom.Shirtsize', value: item.tshirtSize });
  }

  return operations;
}

function buildTaskOperations(cfg, task, parentId) {
  const title = `${task.prefix} - ${String(task.title).trim()}`;
  const isMarkdown = !!task.descriptionMarkdown;
  const description = task.descriptionMarkdown || task.descriptionHtml;

  const operations = [{ op: 'add', path: '/fields/System.Title', value: title }];
  if (description) {
    operations.push({ op: 'add', path: '/fields/System.Description', value: description });
    if (isMarkdown) {
      operations.push({ op: 'add', path: '/multilineFieldsFormat/System.Description', value: 'Markdown' });
    }
  }
  if (task.assigneeEmail) {
    operations.push({ op: 'add', path: '/fields/System.AssignedTo', value: task.assigneeEmail });
  }
  operations.push({
    op: 'add',
    path: '/relations/-',
    value: {
      rel: 'System.LinkTypes.Hierarchy-Reverse',
      url: `https://dev.azure.com/${cfg.organization}/${cfg.project}/_apis/wit/workitems/${parentId}`
    }
  });
  return operations;
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const planPath = positional[0];
  if (!planPath) fail('Usage: node create-ticket.mjs <plan.json> [--dry-run]');

  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  } catch (e) {
    fail(`Could not read/parse plan file "${planPath}": ${e.message}`);
  }

  const cfg = loadReleasyConfig();
  const errors = validatePlan(plan, cfg);
  if (errors.length) {
    console.error(`Plan is invalid (${errors.length} problem${errors.length === 1 ? '' : 's'}):`);
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  if (flags['dry-run']) {
    console.log(`Plan is valid: ${plan.items.length} item(s), ${plan.items.reduce((n, i) => n + (i.tasks || []).length, 0)} nested task(s). No API calls made (--dry-run).`);
    return;
  }

  const pat = loadPat();
  const createdByRefId = {};
  const results = [];

  for (const item of plan.items) {
    const operations = buildItemOperations(cfg, item);
    const created = await createWorkItemApi(cfg, item.type, operations, pat);
    createdByRefId[item.refId] = created;
    results.push({
      refId: item.refId,
      id: created.id,
      type: created.fields['System.WorkItemType'],
      title: created.fields['System.Title'],
      url: releasyWorkItemUrl(created.id),
      tasks: []
    });

    for (const task of item.tasks || []) {
      const taskOperations = buildTaskOperations(cfg, task, created.id);
      const createdTask = await createWorkItemApi(cfg, 'Task', taskOperations, pat);
      results[results.length - 1].tasks.push({
        id: createdTask.id,
        title: createdTask.fields['System.Title'],
        url: releasyWorkItemUrl(createdTask.id)
      });
    }
  }

  // Second pass: Related is symmetric in Azure DevOps, so adding it once (on the item that
  // declared relatedRefIds) is enough for it to also show up on the other side.
  for (const item of plan.items) {
    for (const relatedRefId of item.relatedRefIds || []) {
      const from = createdByRefId[item.refId];
      const to = createdByRefId[relatedRefId];
      await patchWorkItem(cfg, from.id, [{
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'System.LinkTypes.Related',
          url: `https://dev.azure.com/${cfg.organization}/${cfg.project}/_apis/wit/workitems/${to.id}`
        }
      }], pat);
    }
  }

  console.log('Created:');
  for (const r of results) {
    console.log(`  ${r.type} #${r.id} [${r.refId}] "${r.title}" - ${r.url}`);
    for (const t of r.tasks) {
      console.log(`    Task #${t.id} "${t.title}" - ${t.url}`);
    }
  }
}

main().catch((e) => fail(e.message));
