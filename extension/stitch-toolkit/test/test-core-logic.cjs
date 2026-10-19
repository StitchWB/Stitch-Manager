// Stripe Extension — Core Logic Unit Tests
// Tests findField and setValue logic using jsdom (Node.js)
// Usage: node test/test-core-logic.js
// Requires: jsdom (installed via jest-environment-jsdom)

const { JSDOM } = require('jsdom');

// Polyfill CSS.escape for jsdom (available in real browsers)
if (typeof CSS === 'undefined' || !CSS.escape) {
  global.CSS = global.CSS || {};
  CSS.escape = function (val) {
    return val.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  };
}

// Polyfill HTMLInputElement prototype for jsdom descriptor fallback
if (typeof HTMLInputElement === 'undefined') {
  global.HTMLInputElement = require('jsdom/lib/jsdom/living/generated/HTMLInputElement');
}

// ── Test harness ─────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else {
    fail++;
    console.error(`  ✗ ${msg}`);
    // Print stack trace for easier debugging
    if (typeof cond !== 'undefined' && cond === false) {
      const stack = new Error().stack;
      const line = stack.split('\n')[2] || '';
      console.error(`     at ${line.trim()}`);
    }
  }
}

function run(name, fn) {
  console.log(`\n▶ ${name}`);
  try { fn(); } catch (e) {
    fail++;
    console.error(`  ✗ EXCEPTION: ${e.message}`);
  }
}

// ── Core functions (extracted from background.js) ─────────────────────────────
function findField(document, priority) {
  for (const { by, val } of priority) {
    try {
      let el = null;
      if (by === 'id') {
        el = document.getElementById(val);
      } else if (by === 'name') {
        el = document.querySelector(`[name="${CSS.escape(val)}"]`);
      } else if (by === 'autocomplete') {
        el = document.querySelector(`[autocomplete="${CSS.escape(val)}"]`);
      } else if (by === 'inputmode') {
        el = document.querySelector(`input[inputmode="${CSS.escape(val)}"]`);
      } else if (by === 'aria-label') {
        const all = document.querySelectorAll('[aria-label]');
        const vLow = val.toLowerCase();
        for (const a of all) {
          if ((a.getAttribute('aria-label') || '').toLowerCase().includes(vLow)) { el = a; break; }
        }
      } else if (by === 'data-testid') {
        el = document.querySelector(`[data-testid="${CSS.escape(val)}"]`);
      } else if (by === 'placeholder') {
        const all = document.querySelectorAll('input, textarea, select');
        const vLow = val.toLowerCase();
        for (const a of all) {
          if ((a.placeholder || '').toLowerCase().includes(vLow)) { el = a; break; }
        }
      } else if (by === 'label') {
        const labels = document.querySelectorAll('label');
        const vLow = val.toLowerCase();
        for (const lab of labels) {
          if ((lab.textContent || '').toLowerCase().includes(vLow)) {
            const forId = lab.getAttribute('for');
            if (forId) { el = document.getElementById(forId); if (el) break; }
            const child = lab.querySelector('input, select, textarea');
            if (child) { el = child; break; }
          }
        }
      }
      if (el) return el;
    } catch { continue; }
  }
  return null;
}

function setValue(el, value) {
  if (!el) return false;
  try {
    el.focus();
    const tag = el.tagName?.toLowerCase();
    // Get the correct Event constructor from the element's document
    const EventCtor = el.ownerDocument?.defaultView?.Event || (typeof Event !== 'undefined' ? Event : null);
    if (tag === 'select') {
      const v = String(value || '').trim();
      el.value = v;
      if (el.value !== v && el.options) {
        const vLow = v.toLowerCase();
        for (const opt of el.options) {
          if ((opt.value || '').toLowerCase() === vLow ||
              (opt.text || '').toLowerCase() === vLow) {
            el.value = opt.value;
            break;
          }
        }
      }
      if (el.value !== v && el.options && v.length === 2) {
        const vLow = v.toLowerCase();
        for (const opt of el.options) {
          const optVal = (opt.value || '').toLowerCase();
          const optText = (opt.text || '').toLowerCase();
          if (optVal === vLow || optText.startsWith(vLow) || optText.includes(vLow)) {
            el.value = opt.value;
            break;
          }
        }
      }
      if (EventCtor) el.dispatchEvent(new EventCtor('change', { bubbles: true }));
      return true;
    }
    const descriptor = Object.getOwnPropertyDescriptor(el.__proto__, 'value');
    if (descriptor && typeof descriptor.set === 'function') descriptor.set.call(el, value); else el.value = value;
    if (EventCtor) {
      el.dispatchEvent(new EventCtor('input', { bubbles: true }));
      el.dispatchEvent(new EventCtor('change', { bubbles: true }));
      el.dispatchEvent(new EventCtor('blur', { bubbles: true }));
    }
    return true;
  } catch {
    return false;
  }
}

// ── Tests: findField ─────────────────────────────────────────────────────────
run('findField by id', () => {
  const dom = new JSDOM('<input id="cardNumber">');
  const el = findField(dom.window.document, [{ by: 'id', val: 'cardNumber' }]);
  assert(el && el.id === 'cardNumber', 'finds element by id');
});

run('findField by name', () => {
  const dom = new JSDOM('<input name="cardNumber">');
  const el = findField(dom.window.document, [{ by: 'name', val: 'cardNumber' }]);
  assert(el && el.getAttribute('name') === 'cardNumber', 'finds element by name');
});

run('findField by autocomplete', () => {
  const dom = new JSDOM('<input autocomplete="cc-number">');
  const el = findField(dom.window.document, [{ by: 'autocomplete', val: 'cc-number' }]);
  assert(el && el.getAttribute('autocomplete') === 'cc-number', 'finds element by autocomplete');
});

run('findField by aria-label partial', () => {
  const dom = new JSDOM('<input aria-label="Numéro de carte">');
  const el = findField(dom.window.document, [{ by: 'aria-label', val: 'carte' }]);
  assert(el && el.getAttribute('aria-label') === 'Numéro de carte', 'finds element by partial aria-label (French)');
});

run('findField by data-testid', () => {
  const dom = new JSDOM('<input data-testid="card-number">');
  const el = findField(dom.window.document, [{ by: 'data-testid', val: 'card-number' }]);
  assert(el && el.getAttribute('data-testid') === 'card-number', 'finds element by data-testid');
});

run('findField by placeholder partial', () => {
  const dom = new JSDOM('<input placeholder="Kartennummer">');
  const el = findField(dom.window.document, [{ by: 'placeholder', val: 'karten' }]);
  assert(el && el.placeholder === 'Kartennummer', 'finds element by partial placeholder (German)');
});

run('findField by label for', () => {
  const dom = new JSDOM('<label for="myName">Name auf Karte</label><input id="myName">');
  const el = findField(dom.window.document, [{ by: 'label', val: 'name auf' }]);
  assert(el && el.id === 'myName', 'finds element by label-for text (German)');
});

run('findField by nested label', () => {
  const dom = new JSDOM('<label>Vollständiger Name <input name="fullname"></label>');
  const el = findField(dom.window.document, [{ by: 'label', val: 'vollständiger' }]);
  assert(el && el.getAttribute('name') === 'fullname', 'finds nested element by label text (German)');
});

run('findField priority order', () => {
  const dom = new JSDOM('<input id="a"><input name="b">');
  const el = findField(dom.window.document, [
    { by: 'id', val: 'a' },
    { by: 'name', val: 'b' },
  ]);
  assert(el && el.id === 'a', 'respects priority order (id before name)');
});

run('findField CSS.escape safety', () => {
  const dom = new JSDOM('<input name="name[0]">');
  const el = findField(dom.window.document, [{ by: 'name', val: 'name[0]' }]);
  assert(el && el.getAttribute('name') === 'name[0]', 'handles special chars in name via CSS.escape');
});

// ── Tests: setValue ──────────────────────────────────────────────────────────
run('setValue on text input', () => {
  const dom = new JSDOM('<input type="text">', { runScripts: 'dangerously' });
  const el = dom.window.document.querySelector('input');
  const ok = setValue(el, '4242');
  assert(ok && el.value === '4242', 'sets text input value');
});

run('setValue on select by exact value', () => {
  const dom = new JSDOM(`
    <select>
      <option value="">Choose</option>
      <option value="US">United States</option>
      <option value="DE">Germany</option>
    </select>
  `);
  const el = dom.window.document.querySelector('select');
  const ok = setValue(el, 'DE');
  assert(ok && el.value === 'DE', 'sets select by exact option value');
});

run('setValue on select by option text', () => {
  const dom = new JSDOM(`
    <select>
      <option value="">Choose</option>
      <option value="us">United States</option>
      <option value="de">Germany</option>
    </select>
  `);
  const el = dom.window.document.querySelector('select');
  const ok = setValue(el, 'germany');
  assert(ok && el.value === 'de', 'sets select by option text match');
});

run('setValue on select by country code fuzzy', () => {
  const dom = new JSDOM(`
    <select>
      <option value="">Choose</option>
      <option value="US">United States</option>
      <option value="GB">United Kingdom</option>
    </select>
  `);
  const el = dom.window.document.querySelector('select');
  const ok = setValue(el, 'GB');
  assert(ok && el.value === 'GB', 'sets select by 2-letter country code fuzzy match');
});

run('setValue fires events', () => {
  let inputFired = false;
  let changeFired = false;
  let blurFired = false;
  const dom = new JSDOM('<input type="text">', { runScripts: 'dangerously' });
  const el = dom.window.document.querySelector('input');
  el.addEventListener('input', () => { inputFired = true; });
  el.addEventListener('change', () => { changeFired = true; });
  el.addEventListener('blur', () => { blurFired = true; });
  setValue(el, 'test');
  assert(inputFired && changeFired && blurFired, 'fires input, change, blur events');
});

run('setValue handles null element', () => {
  assert(setValue(null, 'x') === false, 'returns false for null element');
});

// ── Tests: Full Stripe field discovery simulation ──────────────────────────────
run('detectStripeFields — standard Stripe IDs', () => {
  const html = `
    <input id="cardNumber" autocomplete="cc-number">
    <input id="cardExpiry" autocomplete="cc-exp">
    <input id="cardCvc" autocomplete="cc-csc">
    <input id="billingName" autocomplete="cc-name">
    <select id="billingCountry"><option value="US">US</option></select>
    <input id="billingAddressLine1">
    <input id="billingPostalCode">
  `;
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const found = {
    number: findField(doc, [{ by: 'id', val: 'cardNumber' }, { by: 'autocomplete', val: 'cc-number' }, { by: 'name', val: 'cardNumber' }]),
    expiry: findField(doc, [{ by: 'id', val: 'cardExpiry' }, { by: 'autocomplete', val: 'cc-exp' }, { by: 'name', val: 'cardExpiry' }]),
    cvc: findField(doc, [{ by: 'id', val: 'cardCvc' }, { by: 'autocomplete', val: 'cc-csc' }, { by: 'name', val: 'cardCvc' }]),
    name: findField(doc, [{ by: 'id', val: 'billingName' }, { by: 'autocomplete', val: 'cc-name' }]),
    country: findField(doc, [{ by: 'id', val: 'billingCountry' }, { by: 'autocomplete', val: 'country' }]),
    address: findField(doc, [{ by: 'id', val: 'billingAddressLine1' }]),
    postalCode: findField(doc, [{ by: 'id', val: 'billingPostalCode' }]),
  };
  assert(
    found.number && found.expiry && found.cvc && found.name &&
    found.country && found.address && found.postalCode,
    'finds all standard Stripe fields'
  );
});

run('detectStripeFields — localized French labels', () => {
  const html = `
    <label for="cn">Numéro de carte</label>
    <input id="cn" autocomplete="cc-number">
    <label for="ce">Date d'expiration</label>
    <input id="ce" autocomplete="cc-exp">
    <label for="cv">CVC</label>
    <input id="cv" autocomplete="cc-csc">
    <label for="nm">Nom sur la carte</label>
    <input id="nm">
    <label for="ct">Pays</label>
    <select id="ct"><option value="FR">France</option></select>
    <label for="ad">Adresse</label>
    <input id="ad">
    <label for="cp">Code postal</label>
    <input id="cp">
  `;
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const found = {
    number: findField(doc, [{ by: 'label', val: 'numéro de carte' }, { by: 'autocomplete', val: 'cc-number' }]),
    expiry: findField(doc, [{ by: 'label', val: 'expiration' }, { by: 'autocomplete', val: 'cc-exp' }]),
    cvc: findField(doc, [{ by: 'label', val: 'cvc' }, { by: 'autocomplete', val: 'cc-csc' }]),
    name: findField(doc, [{ by: 'label', val: 'nom' }]),
    country: findField(doc, [{ by: 'label', val: 'pays' }]),
    address: findField(doc, [{ by: 'label', val: 'adresse' }]),
    postalCode: findField(doc, [{ by: 'label', val: 'code postal' }]),
  };
  assert(
    found.number && found.expiry && found.cvc && found.name &&
    found.country && found.address && found.postalCode,
    'finds all French-localized fields by label text'
  );
});

run('detectStripeFields — German aria-labels', () => {
  const html = `
    <input aria-label="Kartennummer" autocomplete="cc-number">
    <input aria-label="Ablaufdatum" autocomplete="cc-exp">
    <input aria-label="CVC" autocomplete="cc-csc">
    <input aria-label="Name auf der Karte" autocomplete="cc-name">
    <select aria-label="Land"><option value="DE">Deutschland</option></select>
    <input aria-label="Straße und Hausnummer">
    <input aria-label="Postleitzahl">
  `;
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const found = {
    number: findField(doc, [{ by: 'aria-label', val: 'karten' }]),
    expiry: findField(doc, [{ by: 'aria-label', val: 'ablauf' }]),
    cvc: findField(doc, [{ by: 'aria-label', val: 'cvc' }]),
    name: findField(doc, [{ by: 'aria-label', val: 'name auf' }]),
    country: findField(doc, [{ by: 'aria-label', val: 'land' }]),
    address: findField(doc, [{ by: 'aria-label', val: 'straße' }]),
    postalCode: findField(doc, [{ by: 'aria-label', val: 'postleitzahl' }]),
  };
  assert(
    found.number && found.expiry && found.cvc && found.name &&
    found.country && found.address && found.postalCode,
    'finds all German-localized fields by aria-label'
  );
});

run('detectStripeFields — mixed/locale fallback', () => {
  const html = `
    <input data-testid="cardnumber-input" autocomplete="cc-number">
    <input placeholder="MM / YY" autocomplete="cc-exp">
    <input name="security_code" autocomplete="cc-csc">
    <input placeholder="Имя на карте" name="name">
    <select name="country_code"><option value="RU">Russia</option></select>
    <input aria-label="Адрес">
    <input id="zip">
  `;
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const found = {
    number: findField(doc, [{ by: 'data-testid', val: 'cardnumber' }, { by: 'autocomplete', val: 'cc-number' }]),
    expiry: findField(doc, [{ by: 'placeholder', val: 'mm' }, { by: 'autocomplete', val: 'cc-exp' }]),
    cvc: findField(doc, [{ by: 'name', val: 'security_code' }, { by: 'autocomplete', val: 'cc-csc' }]),
    name: findField(doc, [{ by: 'placeholder', val: 'имя' }, { by: 'name', val: 'name' }]),
    country: findField(doc, [{ by: 'name', val: 'country_code' }]),
    address: findField(doc, [{ by: 'aria-label', val: 'адрес' }]),
    postalCode: findField(doc, [{ by: 'id', val: 'zip' }]),
  };
  assert(
    found.number && found.expiry && found.cvc && found.name &&
    found.country && found.address && found.postalCode,
    'finds fields via mixed selectors (data-testid, placeholder, name, aria-label, id)'
  );
});

run('fillStripeFields — full flow simulation', () => {
  const html = `
    <input id="cardNumber">
    <input id="cardExpiry">
    <input id="cardCvc">
    <input id="billingName">
    <select id="billingCountry">
      <option value="">Choose</option>
      <option value="US">United States</option>
    </select>
    <input id="billingAddressLine1">
    <input id="billingPostalCode">
  `;
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  const doc = dom.window.document;
  const globalDocument = global.document;
  global.document = doc; // fillStripeFields uses global document

  // Inline fillStripeFields for test (uses findField / setValue defined above)
  const cardData = {
    number: '4242424242424242',
    expiry: '12/25',
    cvc: '123',
    name: 'John Doe',
    country: 'US',
    address: '123 Main St',
    postalCode: '12345',
  };

  // Simulate fillStripeFields body
  const filled = [];
  if (cardData.number) {
    const el = findField(doc, [{ by: 'id', val: 'cardNumber' }]);
    if (el && setValue(el, cardData.number)) filled.push('number');
  }
  if (cardData.expiry) {
    const el = findField(doc, [{ by: 'id', val: 'cardExpiry' }]);
    if (el && setValue(el, cardData.expiry)) filled.push('expiry');
  }
  if (cardData.cvc) {
    const el = findField(doc, [{ by: 'id', val: 'cardCvc' }]);
    if (el && setValue(el, cardData.cvc)) filled.push('cvc');
  }
  if (cardData.name) {
    const el = findField(doc, [{ by: 'id', val: 'billingName' }]);
    if (el && setValue(el, cardData.name)) filled.push('name');
  }
  if (cardData.country) {
    const el = findField(doc, [{ by: 'id', val: 'billingCountry' }]);
    if (el && setValue(el, cardData.country)) filled.push('country');
  }
  if (cardData.address) {
    const el = findField(doc, [{ by: 'id', val: 'billingAddressLine1' }]);
    if (el && setValue(el, cardData.address)) filled.push('address');
  }
  if (cardData.postalCode) {
    const el = findField(doc, [{ by: 'id', val: 'billingPostalCode' }]);
    if (el && setValue(el, cardData.postalCode)) filled.push('postalCode');
  }

  global.document = globalDocument;

  assert(
    filled.length === 7 &&
    doc.getElementById('cardNumber').value === '4242424242424242' &&
    doc.getElementById('cardExpiry').value === '12/25' &&
    doc.getElementById('cardCvc').value === '123' &&
    doc.getElementById('billingName').value === 'John Doe' &&
    doc.getElementById('billingCountry').value === 'US' &&
    doc.getElementById('billingAddressLine1').value === '123 Main St' &&
    doc.getElementById('billingPostalCode').value === '12345',
    'fills all standard Stripe fields correctly'
  );
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('Some tests failed.');
  process.exit(1);
} else {
  console.log('All tests passed!');
  process.exit(0);
}
