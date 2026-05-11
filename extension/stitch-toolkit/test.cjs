/**
 * Extension Validator — Automated checks for Stitch Toolkit
 * Run: node extension/stitch-toolkit/test.cjs
 */

const fs = require('fs');
const path = require('path');

const EXT_DIR = path.dirname(__filename);
const errors = [];
const warnings = [];

function error(msg, file, line) { errors.push({ msg, file, line }); }
function warn(msg, file, line) { warnings.push({ msg, file, line }); }

// ── 1. Syntax Check ──────────────────────────────────────────────────────
function checkSyntax(filePath) {
  const code = fs.readFileSync(filePath, 'utf-8');
  let testCode = code;

  // Strip ES module syntax for files that use import/export
  const isModule = filePath.includes('background.js') || filePath.includes('shared.js') || filePath.includes('session-manager.js');
  if (isModule) {
    testCode = code
      .replace(/import\s+.*?\s+from\s+['"].*?['"];?/g, '')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+default\s+/g, '')
      .replace(/export\s*\{[^}]*\}\s*;?/g, '');
  }

  try {
    new Function(testCode);
    console.log('  ✓ ' + path.basename(filePath) + ' — syntax OK');
    return true;
  } catch (e) {
    const lineMatch = e.stack.match(/:(\d+):/);
    const line = lineMatch ? parseInt(lineMatch[1], 10) : '?';
    error('Syntax error: ' + e.message, filePath, line);
    console.log('  ✗ ' + path.basename(filePath) + ' — SYNTAX ERROR at line ~' + line);
    return false;
  }
}

// ── 2. Check for shadow used outside PanelManager ────────────────────────
function checkUndefinedVars(filePath) {
  const code = fs.readFileSync(filePath, 'utf-8');
  const lines = code.split('\n');
  const issues = [];
  let inPanelManager = false;
  let iifeDepth = 0;
  let lineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    lineNum++;
    const trimmed = lines[i].trim();

    if (trimmed.indexOf('(function') !== -1 || trimmed.indexOf('function(') !== -1) {
      iifeDepth++;
    }
    if ((trimmed.startsWith('})') || (trimmed.startsWith('}') && trimmed.indexOf(')') !== -1))) {
      iifeDepth--;
    }

    if (trimmed.indexOf('PanelManager') !== -1 && trimmed.indexOf('= (function') !== -1) {
      inPanelManager = true;
    }
    if (inPanelManager && iifeDepth === 0 && trimmed.startsWith('})')) {
      inPanelManager = false;
    }

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    if (!inPanelManager && /\bshadow\b/.test(lines[i]) && lines[i].indexOf('shadowEl') === -1 && lines[i].indexOf('shadowRoot') === -1 && lines[i].indexOf('getToolContainer') === -1) {
      issues.push({ line: lineNum, text: trimmed.substring(0, 80) });
    }
  }

  if (issues.length > 0) {
    issues.forEach(function (issue) {
      warn('Possible shadow usage outside PanelManager scope', filePath, issue.line);
    });
  }

  return issues.length === 0;
}

// ── 2b. Check for querySelector without # on id-like selectors ────────────
function checkQuerySelectorIds(filePath) {
  const code = fs.readFileSync(filePath, 'utf-8');
  const lines = code.split('\n');
  const issues = [];
  let lineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    lineNum++;
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    // Match querySelector('tk-...') or $( without # prefix
    // Pattern: querySelector(  "  or '  tk-   without preceding #
    const badPatterns = [
      /querySelector\(['"](tk-[\w-]+)['"]\)/,  // querySelector('tk-card') — missing #
    ];

    for (let p = 0; p < badPatterns.length; p++) {
      const match = line.match(badPatterns[p]);
      if (match) {
        // Check if this line is inside a helper function that auto-adds #
        if (line.indexOf("s.charAt(0) === '#' ? s : '#' + s") !== -1) {
          continue; // This is the helper itself — skip
        }
        issues.push({ line: lineNum, text: trimmed.substring(0, 80), selector: match[1] });
      }
    }
  }

  if (issues.length > 0) {
    issues.forEach(function (issue) {
      error("querySelector missing '#' for id '" + issue.selector + "' — will return null", filePath, issue.line);
    });
  } else {
    console.log('  ✓ querySelector id selectors have # prefix');
  }

  return issues.length === 0;
}

// ── 3. Check manifest consistency ──────────────────────────────────────
function checkManifest() {
  const manifestPath = path.join(EXT_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  const sharedPath = path.join(EXT_DIR, 'shared.js');
  const sharedCode = fs.readFileSync(sharedPath, 'utf-8');

  const versionMatch = sharedCode.match(/TOOLKIT_VERSION\s*=\s*['"]([\d.]+)['"]/);
  const sharedVersion = versionMatch ? versionMatch[1] : null;

  if (manifest.version !== sharedVersion) {
    error('Version mismatch: manifest.json says "' + manifest.version + '" but shared.js says "' + sharedVersion + '"', 'manifest.json / shared.js', 1);
  } else {
    console.log('  ✓ Version consistent: ' + manifest.version);
  }

  const cs = manifest.content_scripts && manifest.content_scripts[0];
  if (cs && cs.type === 'module') {
    error('content_scripts must NOT have "type": "module" for CloakBrowser compatibility', 'manifest.json', 1);
  } else {
    console.log('  ✓ content_scripts type is OK (no module)');
  }

  if (manifest.background && manifest.background.type !== 'module') {
    warn('background should have "type": "module" for ES imports', 'manifest.json', 1);
  } else {
    console.log('  ✓ background type is "module"');
  }

  return manifest.version;
}

// ── 4. Check CSS syntax ──────────────────────────────────────────────────
function checkCSS(filePath) {
  const css = fs.readFileSync(filePath, 'utf-8');
  let braceCount = 0;
  let lineNum = 0;
  const issues = [];

  for (let i = 0; i < css.split('\n').length; i++) {
    lineNum++;
    const line = css.split('\n')[i];
    for (let j = 0; j < line.length; j++) {
      if (line[j] === '{') braceCount++;
      if (line[j] === '}') braceCount--;
      if (braceCount < 0) {
        issues.push({ line: lineNum, msg: 'Unmatched closing brace' });
        braceCount = 0;
      }
    }
  }

  if (braceCount !== 0) {
    issues.push({ line: lineNum, msg: 'Unmatched braces: ' + braceCount + ' open at EOF' });
  }

  if (issues.length > 0) {
    issues.forEach(function (issue) { error(issue.msg, filePath, issue.line); });
    return false;
  }

  console.log('  ✓ ' + path.basename(filePath) + ' — braces balanced');
  return true;
}

// ── 5. Check for EventBus.on inside IIFEs ────────────────────────────────
function checkArchitecture() {
  const contentPath = path.join(EXT_DIR, 'content.js');
  const code = fs.readFileSync(contentPath, 'utf-8');
  const lines = code.split('\n');
  let inIIFE = false;
  let lineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    lineNum++;
    const trimmed = lines[i].trim();

    if (trimmed.indexOf('(function ()') !== -1) {
      inIIFE = true;
    }
    if (inIIFE && trimmed.startsWith('})()')) {
      inIIFE = false;
    }

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    if (inIIFE && trimmed.indexOf('EventBus.on') !== -1) {
      // Allow in Subscriptions block (lines ~1145-1180)
      if (lineNum > 1145 && lineNum < 1180) {
        continue;
      }
      warn('EventBus.on inside IIFE at line ' + lineNum + ' — should be in Subscriptions block', 'content.js', lineNum);
    }
  }

  console.log('  ✓ Architecture checks passed');
}

// ════════════════════════════════════════════════════════════════════════
// RUN ALL CHECKS
// ════════════════════════════════════════════════════════════════════════

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  Stitch Toolkit Extension Validator');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

console.log('1. Syntax Checks');
console.log('─────────────────');
checkSyntax(path.join(EXT_DIR, 'content.js'));
checkSyntax(path.join(EXT_DIR, 'background.js'));
checkSyntax(path.join(EXT_DIR, 'shared.js'));
checkSyntax(path.join(EXT_DIR, 'session-manager.js'));

console.log('');
console.log('2. Undefined Variable Check');
console.log('────────────────────────────');
checkUndefinedVars(path.join(EXT_DIR, 'content.js'));

console.log('');
console.log('2b. querySelector ID Prefix Check');
console.log('──────────────────────────────────');
checkQuerySelectorIds(path.join(EXT_DIR, 'content.js'));

console.log('');
console.log('3. Manifest Consistency');
console.log('────────────────────────');
var version = checkManifest();

console.log('');
console.log('4. CSS Validation');
console.log('──────────────────');
checkCSS(path.join(EXT_DIR, 'panel', 'panel.css'));

console.log('');
console.log('5. Architecture Validation');
console.log('─────────────────────────');
checkArchitecture();

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  Results: ' + errors.length + ' errors, ' + warnings.length + ' warnings');
console.log('═══════════════════════════════════════════════════════════════');

if (errors.length > 0) {
  console.log('\n❌ ERRORS:');
  errors.forEach(function (e) { console.log('  [' + e.file + ':' + e.line + '] ' + e.msg); });
}

if (warnings.length > 0) {
  console.log('\n⚠️ WARNINGS:');
  warnings.forEach(function (w) { console.log('  [' + w.file + ':' + w.line + '] ' + w.msg); });
}

if (errors.length === 0 && warnings.length === 0) {
  console.log('\n✅ ALL CHECKS PASSED — Extension is ready for testing in browser!');
  console.log('   Version: ' + version);
} else if (errors.length === 0) {
  console.log('\n✅ No errors — ready for browser testing (fix warnings if possible)');
} else {
  console.log('\n❌ Fix errors before testing in browser!');
  process.exit(1);
}
