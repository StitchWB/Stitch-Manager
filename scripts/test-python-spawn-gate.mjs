#!/usr/bin/env node
/* Fixture regression test for the bare-python ast-grep gate. */

import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rule = path.join(root, ".ast-grep", "rules", "no-bare-python-spawn.yml");
const fixtureDir = path.join(root, ".ast-grep", "fixtures");
const bin = process.platform === "win32"
  ? path.join(root, "node_modules", "@ast-grep", "cli", "ast-grep.exe")
  : path.join(root, "node_modules", ".bin", "ast-grep");

if (!existsSync(bin)) {
  console.error(`ast-grep binary not found at ${bin}; run npm ci first`);
  process.exit(2);
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "stitch-python-spawn-gate-"));
try {
  const invalid = path.join(tmp, "invalid.py");
  const valid = path.join(tmp, "valid.py");
  copyFileSync(path.join(fixtureDir, "bare-python-invalid.py.txt"), invalid);
  copyFileSync(path.join(fixtureDir, "bare-python-valid.py.txt"), valid);

  const runScan = (target) => spawnSync(
    bin,
    ["scan", "--rule", rule, target, "--report-style=short"],
    { cwd: root, encoding: "utf8" },
  );

  const bad = runScan(invalid);
  const badOutput = `${bad.stdout}\n${bad.stderr}`;
  const diagnostics = badOutput.match(/error\[/g) ?? [];
  if (bad.status !== 1 || diagnostics.length !== 13) {
    console.error("invalid fixture must produce exactly 13 errors and exit 1");
    console.error(`got exit ${bad.status}, diagnostics ${diagnostics.length}`);
    console.error(badOutput);
    process.exit(1);
  }
  for (const ruleId of [
    "no-bare-python-subprocess",
    "no-bare-python-os-spawn",
    "no-bare-python-asyncio-spawn",
    "no-bare-python-interpreter-default",
    "no-bare-python-pexpect-spawn",
  ]) {
    if (!badOutput.includes(ruleId)) {
      console.error(`invalid fixture did not exercise ${ruleId}`);
      console.error(badOutput);
      process.exit(1);
    }
  }

  const good = runScan(valid);
  const goodOutput = `${good.stdout}\n${good.stderr}`;
  if (good.status !== 0) {
    console.error(`valid fixture must exit 0, got ${good.status}`);
    console.error(goodOutput);
    process.exit(1);
  }

  console.log("PYTHON SPAWN GATE FIXTURES CLEAN (invalid: 13 expected errors; valid: 0)");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
