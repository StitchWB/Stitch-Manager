#!/usr/bin/env node
/**
 * Stitch Toolkit — Full Test Suite
 * Runs syntax checks + integration test
 * Run: node extension/stitch-toolkit/test-all.cjs
 */

const { spawnSync } = require('child_process');
const path = require('path');

const dir = path.dirname(__filename);

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  Stitch Toolkit — Full Test Suite');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

function run(name, file) {
  console.log('Running ' + name + '...');
  console.log('───────────────────────────────────────────────────────────────');
  const result = spawnSync('node', [path.join(dir, file)], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
  console.log('');
  return result.status === 0;
}

const syntaxOk = run('Syntax & Architecture Checks', 'test.cjs');
if (!syntaxOk) {
  console.log('❌ Syntax checks FAILED — fix before integration test');
  process.exit(1);
}

const integrationOk = run('Integration Test (Mock Browser)', 'test-integration.cjs');
if (!integrationOk) {
  console.log('❌ Integration test FAILED');
  process.exit(1);
}

const backgroundOk = run('Background Smoke Test (WS Bridge Protocol)', 'test-background.cjs');
if (!backgroundOk) {
  console.log('❌ Background smoke test FAILED');
  process.exit(1);
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('  ✅ ALL TESTS PASSED');
console.log('  Extension is ready for browser testing!');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');
