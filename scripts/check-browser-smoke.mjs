#!/usr/bin/env node
/**
 * Real-browser smoke gate for the frontend dev server.
 *
 * Boots an isolated Vite server (random port), opens the app in headless
 * Chrome, and proves three things the HTTP-level module gate cannot: the full
 * module graph links in a real browser, a probe module exposes its expected
 * export, and an HMR invalidation reaches the browser client without killing
 * the page.  The default probe is the aiGateway module whose ``saveConnection``
 * export drives the Add-connection dialog.
 *
 * Usage:
 *   node scripts/check-browser-smoke.mjs
 *   node scripts/check-browser-smoke.mjs --probe /src/foo.ts --probe-export bar
 *
 * Prints a JSON result line to stdout.  Exits 0 when a browser runs and the
 * smoke passes, 0 with {"skipped": true} when no Chrome/Chromium is found
 * (STITCH_SMOKE_BROWSER overrides), 1 on failure.  Real-run and sabotage tests:
 * python/tests/test_check_browser_smoke.py.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const TAG = "[browser-smoke]";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..");

class GateError extends Error {}

function parseArgs(argv) {
  const out = {
    root: DEFAULT_ROOT,
    probe: "/src/lib/backend/modules/aiGateway.ts",
    probeExport: "saveConnection",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") out.root = argv[++i];
    else if (a === "--probe") out.probe = argv[++i];
    else if (a === "--probe-export") out.probeExport = argv[++i];
    else throw new GateError(`unknown argument: ${a}`);
  }
  return out;
}

function browserCandidates() {
  const out = [];
  const override = process.env.STITCH_SMOKE_BROWSER;
  if (override) out.push(override);
  const bases = [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.LOCALAPPDATA,
  ].filter(Boolean);
  for (const base of bases) {
    out.push(path.join(base, "Google", "Chrome", "Application", "chrome.exe"));
    out.push(path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"));
  }
  out.push(
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  );
  return out;
}

function findBrowser() {
  for (const candidate of browserCandidates()) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function closeQuietly(target) {
  try {
    await target?.close();
  } catch {
    // teardown failures must not mask the gate result
  }
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

async function waitRendered(page, timeoutMs) {
  // poll via evaluate so an in-flight full-reload does not reject the wait
  return waitFor(async () => {
    try {
      return await page.evaluate(() => {
        const root = document.getElementById("root");
        return !!root && root.childElementCount > 0;
      });
    } catch {
      return false;
    }
  }, timeoutMs);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${TAG} ${e.message}`);
    return 2;
  }

  const root = path.resolve(args.root);
  if (!fs.existsSync(path.join(root, "index.html"))) {
    console.error(`${TAG} ${root} has no index.html`);
    return 2;
  }

  const browserExe = findBrowser();
  if (!browserExe) {
    console.log(JSON.stringify({
      ok: false,
      skipped: true,
      reason: "no Chrome/Chromium executable found; set STITCH_SMOKE_BROWSER to override",
    }));
    return 0;
  }

  const diagnostics = [];
  let browser = null;
  let server = null;
  let result = null;

  try {
    server = await createServer({
      root,
      logLevel: "silent",
      clearScreen: false,
      server: { port: 0, host: "127.0.0.1", strictPort: false },
    });
    await server.listen();
    const address = server.httpServer?.address();
    const port = address && typeof address === "object" ? address.port : server.config.server.port;
    const base = `http://127.0.0.1:${port}`;

    browser = await chromium.launch({ headless: true, executablePath: browserExe });
    const page = await browser.newPage();
    const frames = [];
    page.on("websocket", (ws) => {
      ws.on("framereceived", (frame) => {
        const parsed = safeJson(frame.payload);
        if (parsed) frames.push(parsed);
      });
    });
    page.on("pageerror", (err) => diagnostics.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") diagnostics.push(`console.error: ${msg.text()}`);
    });

    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
    if (!(await waitRendered(page, 60_000))) {
      throw new GateError("app root never rendered");
    }

    const probeType = await page.evaluate(
      async ({ url, exportName }) => {
        const mod = await import(url);
        return typeof mod[exportName];
      },
      { url: args.probe, exportName: args.probeExport },
    );
    if (probeType !== "function") {
      throw new GateError(`probe ${args.probe} export ${args.probeExport}: ${probeType ?? "missing"}`);
    }

    const node = await server.moduleGraph.getModuleByUrl(args.probe);
    if (!node) throw new GateError(`module ${args.probe} not in Vite module graph`);
    // only frames after this index count: dep-opt full-reloads during boot must not satisfy the HMR check
    const framesBefore = frames.length;
    await server.reloadModule(node);
    const hmrFrame = await waitFor(() => {
      for (let i = framesBefore; i < frames.length; i++) {
        if (frames[i].type === "update" || frames[i].type === "full-reload") return frames[i];
      }
      return null;
    }, 15_000);
    if (!hmrFrame) {
      const seen = frames.map((f) => f.type).join(", ") || "none";
      throw new GateError(`no HMR frame reached the browser after reloadModule (frames: ${seen})`);
    }
    if (!(await waitRendered(page, 30_000))) {
      throw new GateError("app root not rendered after HMR");
    }

    result = { ok: true, probe: args.probe, export: args.probeExport, hmr: hmrFrame.type, port };
  } catch (e) {
    if (e instanceof GateError) {
      result = { ok: false, error: e.message };
      console.error(`${TAG} FAIL: ${e.message}`);
      for (const d of diagnostics.slice(0, 10)) console.error(`  ${d}`);
    } else {
      result = { ok: false, error: String(e?.stack ?? e) };
      console.error(`${TAG} ${result.error}`);
    }
  } finally {
    await closeQuietly(browser);
    await closeQuietly(server);
  }

  console.log(JSON.stringify(result));
  return result?.ok ? 0 : 1;
}

main().then((code) => process.exit(code));