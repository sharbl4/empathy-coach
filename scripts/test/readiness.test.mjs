import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('service preflight fails closed and does not print connection secrets',()=>{
  const secret='DO_NOT_PRINT_TEST_SECRET';
  const result=spawnSync(process.execPath,['scripts/check-services.mjs'],{encoding:'utf8',env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,DATABASE_URL:`invalid:${secret}`},timeout:10000});
  assert.equal(result.status,1);assert.ok(result.stdout.includes('BLOCKED PostgreSQL'));
  assert.ok(result.stdout.includes('missing SUPABASE_URL'));assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
});
test('live checkpoint refuses to send requests without explicit live configuration',()=>{
  const result=spawnSync(process.execPath,['scripts/live-checkpoint.mjs'],{encoding:'utf8',env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot},timeout:10000});
  assert.equal(result.status,1);assert.ok(result.stderr.includes('No API calls made.'));
});
