#!/usr/bin/env node
/**
 * Vite dev-server module integrity gate.
 *
 * Catches the failure where Vite returns HTTP 200 for a transformed module
 * but with a 0-byte or otherwise broken body, which surfaces in the browser
 * as "does not provide an export named X".  This was the trigger for the
 * AddProviderMenu.tsx crash after a half-saved file edit.
 *
 * For each .ts/.tsx file under <root> with at least one ``export``, the gate
 * fetches ``${base}${path}?t=${cacheBuster}`` and verifies:
 *   - HTTP 200
 *   - content-type looks like JavaScript/ECMAScript
 *   - response body is not empty
 *   - body contains the ``export`` keyword
 *   - body contains each expected named export from the source file
 *
 * Retries handle transient HMR settle states.  Exits 1 with a clear report
 * on the first failure.  Wired into scripts/workspace-runtime.ps1 after
 * Vite reports ready, before the desktop window is announced.
 *
 * Usage:
 *   node scripts/check-vite-modules.mjs --base http://127.0.0.1:5195 --root src
 *
 * Sabotage tests live in python/tests/test_check_vite_modules.py.
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const RE_TSX = /\.(?:t|j)sx?$/;

const EXCLUDED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  "__tests__",
  "coverage",
]);

function parseArgs(argv) {
  const out = { retries: 4, timeoutMs: 5000, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") out.base = argv[++i];
    else if (a === "--root") out.root = argv[++i];
    else if (a === "--paths") out.paths = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--retries") out.retries = Number.parseInt(argv[++i], 10);
    else if (a === "--timeout") out.timeoutMs = Number.parseInt(argv[++i], 10);
    else if (a === "--json") out.json = true;
  }
  if (!out.base) throw new Error("--base http://127.0.0.1:PORT is required");
  if (!out.root) throw new Error("--root <frontend-src dir> is required");
  return out;
}

function expectedExports(source) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  return servedExports(compiled);
}

function servedExports(source) {
  const names = new Set();
  const tree = ts.createSourceFile("module.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (tree.parseDiagnostics.length > 0) throw new Error("invalid transformed JavaScript");
  for (const node of tree.statements) {
    if (ts.isExportAssignment(node)) names.add("default");
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const item of node.exportClause.elements) names.add(item.name.text);
    }
    if (!ts.canHaveModifiers(node)) continue;
    const modifiers = ts.getModifiers(node) || [];
    if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) names.add("default");
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) names.add(node.name.text);
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    }
  }
  return names;
}

async function* walkFiles(root) {
  async function* walk(dir) {
    for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
      if (EXCLUDED_DIRS.has(ent.name) || ent.name.startsWith(".")) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) yield* walk(p);
      else if (RE_TSX.test(ent.name) && !ent.name.endsWith(".d.ts")) yield p;
    }
  }
  yield* walk(root);
}

async function collectTargets(root) {
  const targets = [];
  const rootLeaf = path.basename(root);
  for await (const p of walkFiles(root)) {
    const source = await fs.readFile(p, "utf8");
    const expected = expectedExports(source);
    if (expected.size === 0) continue;
    const sub = path.relative(root, p).split(path.sep).join("/");
    const rel = `/${rootLeaf}/${sub}`;
    targets.push({ rel, expected });
  }
  return targets;
}

async function fetchModule(base, rel, retries, timeoutMs) {
  let lastError = "";
  for (let attempt = 1; attempt <= retries; attempt++) {
    const url = `${base}${rel}?t=${Date.now()}_${attempt}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) { lastError = `HTTP ${res.status}`; continue; }
      const ct = res.headers.get("content-type") ?? "";
      if (!/javascript|ecmascript/i.test(ct)) { lastError = `content-type ${ct}`; continue; }
      const body = await res.text();
      if (body.trim().length === 0) { lastError = `body ${body.length}B`; continue; }
      if (servedExports(body).size === 0) { lastError = "transformed body has no runtime export"; continue; }
      return { ok: true, body };
    } catch (err) {
      clearTimeout(timer);
      lastError = String(err?.message ?? err);
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: lastError };
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(`[vite-gate] ${e.message}`); process.exit(2); }

  const root = path.resolve(args.root);
  const base = args.base.replace(/\/+$/, "");
  const targets = args.paths
    ? args.paths.map((rel) => ({ rel, expected: new Set() }))
    : await collectTargets(root);

  const failures = [];
  const total = targets.length;
  let done = 0;
  for (const t of targets) {
    done++;
    if (!args.json && total > 25 && done % 25 === 0) {
      console.error(`[vite-gate] ${done}/${total}`);
    }
    const result = await fetchModule(base, t.rel, args.retries, args.timeoutMs);
    if (!result.ok) { failures.push({ rel: t.rel, reason: result.error }); continue; }
    const missingExports = [];
    const actual = servedExports(result.body);
    for (const name of t.expected) {
      if (!actual.has(name)) missingExports.push(name);
    }
    if (missingExports.length > 0) {
      failures.push({ rel: t.rel, reason: `missing exports: ${missingExports.join(", ")}` });
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ ok: failures.length === 0, total, failures }));
  } else if (failures.length === 0) {
    console.log(`[vite-gate] OK: ${total} modules served with expected exports`);
  } else {
    console.error(`[vite-gate] FAIL: ${failures.length}/${total} modules broken`);
    for (const f of failures) console.error(`  - ${f.rel}  (${f.reason})`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(`[vite-gate] ${e?.stack ?? e}`); process.exit(2); });
