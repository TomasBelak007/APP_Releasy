#!/usr/bin/env node
// Uploads a local file and links it to a Bug, Feature, or Task as an AttachedFile relation.
// Unlike comments, this is allowed on every Task prefix, including TEST.
//
// Usage:
//   node add-attachment.mjs <id-or-url> --file path

import fs from 'node:fs';
import path from 'node:path';
import { loadReleasyConfig } from './releasy-config.mjs';
import { loadPat, getWorkItem, patchWorkItem, uploadAttachmentFile, releasyWorkItemUrl, parseWorkItemId, parseArgs, fail } from './lib.mjs';

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (!positional[0] || !flags.file) {
    fail('Usage: node add-attachment.mjs <id-or-url> --file path');
  }

  const filePath = path.resolve(String(flags.file));
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    fail(`File not found: ${filePath}`);
  }

  const id = parseWorkItemId(positional[0]);
  const cfg = loadReleasyConfig();
  const pat = loadPat();

  const data = await getWorkItem(cfg, id, pat);
  const type = data.fields?.['System.WorkItemType'];
  if (!type) fail(`Work item #${id} was not found (or has no fields) in ${cfg.organization}/${cfg.project}.`);

  const uploaded = await uploadAttachmentFile(cfg, filePath, pat);
  if (!uploaded?.url) fail('Attachment upload did not return a url.');

  const fileName = path.basename(filePath);
  await patchWorkItem(cfg, id, [{
    op: 'add',
    path: '/relations/-',
    value: {
      rel: 'AttachedFile',
      url: uploaded.url,
      attributes: { comment: fileName }
    }
  }], pat);

  console.log(`Attached ${fileName} to ${type} #${id} - ${releasyWorkItemUrl(id)}`);
}

main().catch((e) => fail(e.message));
