# Stripe Filler — Test Environment

This folder contains tests and test fixtures for the Stripe browser-extension filler.

## Files

| File | Purpose |
|------|---------|
| `test-core-logic.cjs` | Node.js unit tests for `findField()` and `setValue()` using jsdom |
| `test-stripe-form.html` | Static HTML page with simulated Stripe checkout forms (open in browser) |

## Running Unit Tests

```bash
cd extension/stitch-toolkit
node test/test-core-logic.cjs
```

**Requirements:** jsdom (already installed via `jest-environment-jsdom` at repo root).

The unit tests verify:
- Field discovery by `id`, `name`, `autocomplete`, `aria-label` (partial), `data-testid`, `placeholder` (partial), and `label` text (fuzzy).
- Select / `<option>` matching: exact value, exact text, and 2-letter country-code fuzzy fallback.
- CSS.escape safety for special characters in selectors.
- Event dispatch (`input`, `change`, `blur`).
- Full end-to-end simulated fill against standard Stripe IDs.
- Locale-agnostic discovery against French (`label`) and German (`aria-label`) markup.

## Manual Browser Testing

1. Build / load the extension in Chrome/Edge developer mode:
   - `chrome://extensions` → **Developer mode ON** → **Load unpacked**
   - Point to `extension/stitch-toolkit/`
2. Open `test/test-stripe-form.html` in a normal browser tab (or serve via `npx serve .`).
3. Click the Stitch Toolkit extension icon → **Stripe Filler**.
4. Paste a card string, e.g.:
   ```
   4242424242424242|12|2030|123
   ```
5. Fill in billing fields (optional):
   - Name: `Jane Doe`
   - Country: `US`
   - Address: `123 Main St`
   - Postal code: `12345`
6. Click **Detect** — should show found fields per form.
7. Click **Fill Stripe** — should populate fields in all forms that are present.

### Expected behavior per form

| Form | Strategy | Expected result |
|------|----------|-----------------|
| A | Exact IDs + autocomplete | All fields filled instantly |
| B | French `aria-label` / `label` text | Found via partial `aria-label` or `label` fuzzy match |
| C | German `data-testid` + `placeholder` | Found via `data-testid` exact match or `placeholder` partial match |
| D | Minimal markup (`name` with brackets, `label` text) | Found via `label` text fuzzy match or `name` with CSS.escape |

## Troubleshooting

- **Detect shows nothing** → open DevTools on the test page, check Console for errors from `executeScript`.
- **Country not selected** → verify the `<select>` option `value` matches the 2-letter code you typed (or that option text contains the code). The filler tries direct value, then option text, then fuzzy country-code match.
- **Events not firing** → `setValue` dispatches `input`, `change`, `blur`. Some Stripe iframes may need additional events; add them to `setValue` if required.
