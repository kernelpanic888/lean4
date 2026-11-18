// Copyright (c) 2026 Salkutsan Aleksey. All rights reserved.
// Released under Apache 2.0 license as described in the file LICENSE.
// Run with: node script/test-pr-release.mjs
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const workflow = readFileSync(new URL('../.github/workflows/pr-release.yml', import.meta.url), 'utf8');
const step = workflow.split('      - name: Delete existing releases if present\n')[1]
  .split('      # We use `gh release create`')[0];
const source = step.split('          script: |\n')[1].trimEnd()
  .split('\n').map(line => line.slice(12)).join('\n');
const directory = mkdtempSync(join(tmpdir(), 'lean-release-test-'));
const modulePath = join(directory, 'cleanup.mjs');
let cleanup;
try {
  writeFileSync(modulePath, `export default async function(github, context, process) {\n${source}\n}`);
  cleanup = (await import(pathToFileURL(modulePath).href)).default;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
const tags = ['pr-release-123', 'pr-release-123-abc1234'];

async function check(name, responses, deletionError, expectedIds, expectedError) {
  const lookedUp = [], deleted = [];
  const github = { rest: { repos: {
    async getReleaseByTag({ owner, repo, tag }) {
      assert.equal(owner, 'leanprover');
      assert.equal(repo, 'lean4-pr-releases');
      lookedUp.push(tag);
      const response = responses[tags.indexOf(tag)];
      if (response >= 400) throw Object.assign(new Error('lookup'), { status: response });
      return { data: { id: response } };
    },
    async deleteRelease({ owner, repo, release_id }) {
      assert.equal(owner, 'leanprover');
      assert.equal(repo, 'lean4-pr-releases');
      if (deletionError) throw Object.assign(new Error('delete'), { status: deletionError });
      deleted.push(release_id);
    },
  } } };
  const run = () => cleanup(github, { repo: { owner: 'leanprover' } },
    { env: { PR_NUMBER: '123', SHORT_SHA: 'abc1234' } });
  if (expectedError) await assert.rejects(run, error => error.status === expectedError);
  else { await run(); assert.deepEqual(lookedUp, tags); }
  assert.deepEqual(deleted, expectedIds);
  return name;
}

export const results = [];
results.push(await check('both absent', [404, 404], null, []));
results.push(await check('both present: delete exact IDs', [101, 102], null, [101, 102]));
results.push(await check('short present, SHA absent', [101, 404], null, [101]));
results.push(await check('short absent, SHA present', [404, 102], null, [102]));
results.push(await check('lookup forbidden: stop', [403], null, [], 403));
results.push(await check('lookup server failure: stop', [500], null, [], 500));
results.push(await check('delete failure: stop', [101], 500, [], 500));
console.log(`${results.length}/${results.length} PR release cleanup tests PASS`);
