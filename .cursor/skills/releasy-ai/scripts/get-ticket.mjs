#!/usr/bin/env node
// Loads an existing work item: fields, relations, child Tasks (if it's a Bug/Feature), and
// comments - everything the agent needs before changing status, adding a comment, editing a
// field, or adding a Task to it. Prints one JSON object.
//
// Usage:
//   node get-ticket.mjs <id-or-url>

import { loadReleasyConfig, resolveProduct } from './releasy-config.mjs';
import {
  loadPat,
  getWorkItem,
  getHierarchyParentId,
  fetchChildTasks,
  fetchAllComments,
  mapComment,
  releasyWorkItemUrl,
  parseWorkItemId,
  parseArgs,
  printJson,
  fail
} from './lib.mjs';

async function main() {
  const { positional } = parseArgs(process.argv.slice(2));
  if (!positional[0]) fail('Usage: node get-ticket.mjs <id-or-url>');

  const id = parseWorkItemId(positional[0]);
  const cfg = loadReleasyConfig();
  const pat = loadPat();

  const data = await getWorkItem(cfg, id, pat, { expandRelations: true });
  const fields = data.fields || {};
  const type = fields['System.WorkItemType'];
  if (!type) fail(`Work item #${id} was not found (or has no fields) in ${cfg.organization}/${cfg.project}.`);

  const relations = data.relations || [];
  const descriptionFieldPath = type === 'Bug' && fields['Microsoft.VSTS.TCM.ReproSteps']
    ? 'Microsoft.VSTS.TCM.ReproSteps'
    : 'System.Description';
  const descriptionFormat = String(data.multilineFieldsFormat?.[descriptionFieldPath] || '').toLowerCase() === 'markdown'
    ? 'Markdown'
    : 'Html';

  const [tasks, comments] = await Promise.all([
    type === 'Task' ? Promise.resolve([]) : fetchChildTasks(cfg, id, relations, pat),
    fetchAllComments(cfg, id, pat)
  ]);

  const result = {
    id,
    type,
    title: fields['System.Title'] || null,
    state: fields['System.State'] || null,
    priority: fields['Microsoft.VSTS.Common.Priority'] ?? null,
    severity: fields['Microsoft.VSTS.Common.Severity'] || null,
    tshirtSize: fields['Custom.Shirtsize'] || null,
    // Resolved, not the raw fields['System.Tags'] - Azure DevOps lower-cases Tags on save, which
    // would silently break any later exact-case lookup (titlePrefixes, availablePatchVersions).
    product: resolveProduct(cfg, fields),
    platformRelease: fields['Custom.PlatformRelease'] || null,
    assignedTo: fields['System.AssignedTo'] ? {
      displayName: fields['System.AssignedTo'].displayName,
      email: fields['System.AssignedTo'].uniqueName
    } : null,
    parentId: type === 'Task' ? getHierarchyParentId(relations) : null,
    description: fields[descriptionFieldPath] || null,
    descriptionFieldPath,
    descriptionFormat,
    url: releasyWorkItemUrl(id),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.fields['System.Title'],
      state: t.fields['System.State'],
      assignedTo: t.fields['System.AssignedTo']?.uniqueName || null
    })),
    comments: comments.map(mapComment),
    commentsAllowed: type === 'Bug' || type === 'Feature'
  };

  printJson(result);
}

main().catch((e) => fail(e.message));
