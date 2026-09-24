#!/usr/bin/env node
// Posts a new comment on a Bug, a Feature, or a Task whose title prefix is ISSUE.
// Other Task prefixes are refused.
//
// Usage:
//   node add-comment.mjs <id-or-url> --format markdown|html (--text "..." | --file path)

import { loadReleasyConfig } from './releasy-config.mjs';
import { loadPat, apiBase, devOpsFetch, getWorkItem, commentsAllowedFor, releasyWorkItemUrl, parseWorkItemId, parseArgs, fail } from './lib.mjs';
import fs from 'node:fs';

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (!positional[0]) fail('Usage: node add-comment.mjs <id-or-url> --format markdown|html (--text "..." | --file path)');

  const id = parseWorkItemId(positional[0]);
  const cfg = loadReleasyConfig();
  const pat = loadPat();

  const data = await getWorkItem(cfg, id, pat);
  const type = data.fields?.['System.WorkItemType'];
  const title = data.fields?.['System.Title'] || '';
  if (!type) fail(`Work item #${id} was not found (or has no fields) in ${cfg.organization}/${cfg.project}.`);
  if (type === 'Task' && !commentsAllowedFor(cfg, type, title)) {
    fail(`Work item #${id} is a Task without the ISSUE prefix - comments on a Task are only allowed when the title starts with "ISSUE - ".`);
  }

  const format = String(flags.format || 'markdown').toLowerCase();
  if (format !== 'markdown' && format !== 'html') {
    fail(`--format must be "markdown" or "html" (got "${flags.format}").`);
  }

  let text = flags.file ? fs.readFileSync(String(flags.file), 'utf8') : flags.text;
  if (!text || !String(text).trim()) {
    fail('Comment text is required - pass --text "..." or --file path.');
  }

  const url = `${apiBase(cfg)}/wit/workitems/${id}/comments?format=${format}&api-version=7.1-preview.4`;
  const created = await devOpsFetch(url, { method: 'POST', pat, body: { text } });

  console.log(`Comment #${created.id} added to ${type} #${id} (${format}) - ${releasyWorkItemUrl(id)}`);
}

main().catch((e) => fail(e.message));
