function cssPath(el) {
  if (!el || el.nodeType !== 1) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;

  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && parts.length < 6) {
    const tag = (node.tagName || '').toLowerCase();
    if (!tag) break;
    let part = tag;

    const cls = String(node.className || '')
      .split(/\b\/\b/g)
      .filter(Boolean)
      .slice(0, 2);
    if (cls.length) {
      part += `.${cls.map(c => CSS.escape(c)).join('.')}`;
    }

    if (node.parentElement) {
      const siblings = Array.from(node.parentElement.children).filter(
        x => x.tagName === node.tagName
      );
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
    }

    parts.unshift(part);
    node = node.parentElement;
  }

  return parts.join(' > ') || null;
}

function cssEscape(value) {
  const s = String(value ?? '');
  try {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(s);
    }
  } catch {}
  return s.replace(/([\0-\x1f\x7f-\x9f !"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function isLikelyStableClassName(cls) {
  const v = String(cls || '').trim();
  if (!v) return false;
  if (v.length > 48) return false;
  if (/\b(\b\/\b|[a-f0-9]){10,}\b/i.test(v)) return false;
  return true;
}

function collectCssCandidates(el) {
  if (!el || el.nodeType !== 1) return [];
  const out = [];
  const seen = new Set();
  const tag = (el.tagName || '').toLowerCase();

  const push = selector => {
    const s = String(selector || '').trim();
    if (!s) return;
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  const id = el.getAttribute?.('id') || '';
  if (id) push(`#${cssEscape(id)}`);

  const testId = el.getAttribute?.('data-testid') || el.getAttribute?.('data-test-id') || '';
  if (testId) {
    push(`[data-testid="${cssEscape(testId)}"]`);
    if (tag) push(`${tag}[data-testid="${cssEscape(testId)}"]`);
    push(`[data-test-id="${cssEscape(testId)}"]`);
    if (tag) push(`${tag}[data-test-id="${cssEscape(testId)}"]`);
  }

  const name = el.getAttribute?.('name') || '';
  if (name) {
    push(`[name="${cssEscape(name)}"]`);
    if (tag) push(`${tag}[name="${cssEscape(name)}"]`);
  }

  const ariaLabel = el.getAttribute?.('aria-label') || '';
  if (ariaLabel) {
    push(`[aria-label="${cssEscape(ariaLabel)}"]`);
    if (tag) push(`${tag}[aria-label="${cssEscape(ariaLabel)}"]`);
  }

  const placeholder = el.getAttribute?.('placeholder') || '';
  if (placeholder) {
    push(`[placeholder="${cssEscape(placeholder)}"]`);
    if (tag) push(`${tag}[placeholder="${cssEscape(placeholder)}"]`);
  }

  const role = el.getAttribute?.('role') || '';
  if (role) {
    push(`[role="${cssEscape(role)}"]`);
    if (tag) push(`${tag}[role="${cssEscape(role)}"]`);
  }

  const stableClasses = String(el.className || '')
    .split(/\b\/\b/g)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(isLikelyStableClassName)
    .slice(0, 2);
  if (stableClasses.length && tag) {
    push(`${tag}.${stableClasses.map(cls => cssEscape(cls)).join('.')}`);
  }

  const path = cssPath(el);
  if (path) push(path);

  return out.slice(0, 12);
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\b\/\b/g, ' ')
    .trim();
}

function selectorForElement(el) {
  const candidates = collectCssCandidates(el);
  return candidates[0] || null;
}

function buildLocators(el) {
  const tag = (el?.tagName || '').toLowerCase() || null;
  const text = normalizeText(el?.innerText || el?.textContent || '').slice(0, 96);
  const css = collectCssCandidates(el);
  return {
    css,
    text: text ? { tag, value: text } : null,
  };
}

function describeEl(el) {
  if (!el || el.nodeType !== 1) return {};
  const testId = el.getAttribute?.('data-testid') || el.getAttribute?.('data-test-id') || null;
  const ariaLabel = el.getAttribute?.('aria-label') || null;
  const placeholder = el.getAttribute?.('placeholder') || null;
  const role = el.getAttribute?.('role') || null;
  const locators = buildLocators(el);

  return {
    tag: (el.tagName || '').toLowerCase(),
    id: el.id || null,
    name: el.getAttribute?.('name') || null,
    type: el.getAttribute?.('type') || null,
    text: normalizeText(el.textContent || '').slice(0, 120),
    testId,
    ariaLabel,
    placeholder,
    role,
    locators,
  };
}
