// Stitch Toolkit — Stripe Filler Tool
// Parses card string "5154620021123771|01|2030|635" and fills Stripe fields
// via background script executeScript(allFrames:true) to reach cross-origin iframes.
// Billing fields (name, country, address, postal code) are optional.

export const StripeFillerTool = {
  id: 'stripe-filler',
  name: 'Stripe Filler',
  icon: '💳',

  mount(container) {
    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
        <input id="tk-stripe-input" class="tk-input" type="text" placeholder="5154...|MM|YYYY|CVC" autocomplete="off" spellcheck="false" style="flex:1;margin:0;font-size:12px;padding:6px 8px;" />
        <button id="tk-stripe-fill-mini" class="tk-btn tk-accent" style="flex:0 0 auto;padding:6px 10px;font-size:11px;" title="Fill">⚡</button>
      </div>

      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:11px;color:var(--tk-text-muted);">
        <input id="tk-stripe-billing" type="checkbox" checked style="accent-color:var(--tk-accent);width:12px;height:12px;margin:0;" />
        <label for="tk-stripe-billing" style="cursor:pointer;">Billing</label>
        <span style="flex:1"></span>
        <button id="tk-stripe-preset" class="tk-btn" style="padding:2px 6px;font-size:10px;flex:0 0 auto;">US</button>
      </div>

      <div id="tk-billing-fields">
        <input id="tk-stripe-name" class="tk-input" type="text" placeholder="Name" style="margin-bottom:4px;padding:5px 8px;font-size:11px;" />
        <div style="display:flex;gap:4px;margin-bottom:4px;">
          <input id="tk-stripe-country" class="tk-input" type="text" placeholder="US" style="margin:0;flex:0 0 45px;padding:5px 8px;font-size:11px;" />
          <input id="tk-stripe-address" class="tk-input" type="text" placeholder="Address" style="margin:0;flex:1;padding:5px 8px;font-size:11px;" />
        </div>
        <div style="display:flex;gap:4px;margin-bottom:4px;">
          <input id="tk-stripe-city" class="tk-input" type="text" placeholder="City" autocomplete="address-level2" style="margin:0;flex:1;padding:5px 8px;font-size:11px;" />
          <input id="tk-stripe-state" class="tk-input" type="text" placeholder="ST" autocomplete="address-level1" style="margin:0;flex:0 0 45px;padding:5px 8px;font-size:11px;" />
        </div>
        <input id="tk-stripe-postal" class="tk-input" type="text" placeholder="ZIP" style="margin-bottom:6px;width:60px;padding:5px 8px;font-size:11px;" />
      </div>

      <div style="display:flex;gap:4px;">
        <button id="tk-stripe-fill" class="tk-btn tk-accent" style="flex:1;padding:6px;font-size:11px;">Fill Card</button>
        <button id="tk-stripe-detect" class="tk-btn" style="flex:0 0 auto;padding:6px 8px;font-size:11px;" title="Detect fields">🔍</button>
      </div>

      <div id="tk-stripe-status" class="tk-status tk-info" style="display:none;margin-top:6px;padding:6px 8px;font-size:11px;"></div>
    `;

    const input = container.querySelector('#tk-stripe-input');
    const fillBtn = container.querySelector('#tk-stripe-fill');
    const fillMiniBtn = container.querySelector('#tk-stripe-fill-mini');
    const detectBtn = container.querySelector('#tk-stripe-detect');
    const presetBtn = container.querySelector('#tk-stripe-preset');
    const billingFields = container.querySelector('#tk-billing-fields');
    const status = container.querySelector('#tk-stripe-status');
    const billingCb = container.querySelector('#tk-stripe-billing');
    const nameIn = container.querySelector('#tk-stripe-name');
    const countryIn = container.querySelector('#tk-stripe-country');
    const addressIn = container.querySelector('#tk-stripe-address');
    const cityIn = container.querySelector('#tk-stripe-city');
    const stateIn = container.querySelector('#tk-stripe-state');
    const postalIn = container.querySelector('#tk-stripe-postal');

    const showStatus = (text, type = 'info') => {
      status.style.display = '';
      status.className = `tk-status tk-${type}`;
      status.textContent = text;
    };

    const hideStatus = () => { status.style.display = 'none'; };

    // Parse core card data from the main input field
    const parseCard = (raw) => {
      const text = String(raw || '').trim();
      if (!text) return null;
      const parts = text.split('|');
      if (parts.length >= 4) {
        const [number, month, year, cvc] = parts;
        return {
          number: number.trim(),
          month: month.trim(),
          year: year.trim(),
          cvc: cvc.trim(),
          expiry: `${month.trim()}/${year.trim().slice(-2)}`,
        };
      }
      // Loose format: any separators between 4 groups
      const m = text.match(/(\d{13,19})\D+(\d{1,2})\D+(\d{2,4})\D+(\d{3,4})/);
      if (m) {
        const [, number, month, year, cvc] = m;
        return { number, month, year, cvc, expiry: `${month}/${year.slice(-2)}` };
      }
      return null;
    };

    const gatherCardData = () => {
      const data = parseCard(input.value);
      if (!data) return null;
      if (billingCb.checked) {
        if (nameIn.value.trim()) data.name = nameIn.value.trim();
        if (countryIn.value.trim()) data.country = countryIn.value.trim().toUpperCase();
        if (addressIn.value.trim()) data.address = addressIn.value.trim();
        if (cityIn.value.trim()) data.city = cityIn.value.trim();
        if (stateIn.value.trim()) data.state = stateIn.value.trim();
        if (postalIn.value.trim()) data.postalCode = postalIn.value.trim();
      }
      return data;
    };

    fillBtn.addEventListener('click', async () => {
      hideStatus();
      const data = gatherCardData();
      if (!data) {
        showStatus('Invalid card format. Use: number|MM|YYYY|CVC', 'err');
        return;
      }

      fillBtn.disabled = true;
      fillBtn.textContent = 'Filling…';

      try {
        const resp = await chrome.runtime.sendMessage({
          type: 'tk:stripe-fill',
          payload: { cardData: data },
        });

        if (resp?.ok) {
          const count = resp?.filledFrames ?? '?';
          showStatus(`Filled ${count} frame(s).`, 'ok');
        } else {
          showStatus(resp?.error || 'Fill failed — no Stripe fields found.', 'err');
        }
      } catch (e) {
        showStatus(e instanceof Error ? e.message : String(e), 'err');
      } finally {
        fillBtn.disabled = false;
        fillBtn.textContent = 'Fill Card';
      }
    });

    // Toggle billing fields visibility
    billingCb.addEventListener('change', () => {
      billingFields.style.display = billingCb.checked ? '' : 'none';
    });

    // Mini fill button (next to input)
    fillMiniBtn.addEventListener('click', async () => {
      hideStatus();
      const data = gatherCardData();
      if (!data) {
        showStatus('Invalid format: number|MM|YYYY|CVC', 'err');
        return;
      }
      try {
        const resp = await chrome.runtime.sendMessage({
          type: 'tk:stripe-fill',
          payload: { cardData: data },
        });
        if (resp?.ok) {
          showStatus(`Filled ${resp.filledFrames ?? '?'} frame(s)`, 'ok');
        } else {
          showStatus(resp?.error || 'Fill failed', 'err');
        }
      } catch (e) {
        showStatus(e instanceof Error ? e.message : String(e), 'err');
      }
    });

    presetBtn.addEventListener('click', () => {
      nameIn.value = 'John Doe';
      countryIn.value = 'US';
      addressIn.value = '123 Main St';
      cityIn.value = 'New York';
      stateIn.value = 'NY';
      postalIn.value = '10001';
      billingCb.checked = true;
      billingFields.style.display = '';
      showStatus('US preset applied', 'ok');
    });

    detectBtn.addEventListener('click', async () => {
      hideStatus();
      detectBtn.disabled = true;
      detectBtn.textContent = 'Detecting…';

      try {
        const resp = await chrome.runtime.sendMessage({
          type: 'tk:stripe-detect',
        });
        if (resp?.ok) {
          // Build a human-readable summary of detected fields per frame
          const parts = [];
          for (const fr of resp.perFrame || []) {
            const fields = Object.keys(fr.detected || {});
            if (fields.length) {
              parts.push(`${fr.host}: ${fields.join(', ')}`);
            }
          }
          const summary = parts.length
            ? `Detected fields:\n${parts.join('\n')}`
            : `No Stripe fields detected in ${resp.detectedFrames ?? '?'} frame(s).`;
          showStatus(summary, 'ok');
        } else {
          showStatus('Stripe fields not detected on this page.', 'err');
        }
      } catch (e) {
        showStatus(e instanceof Error ? e.message : String(e), 'err');
      } finally {
        detectBtn.disabled = false;
        detectBtn.textContent = '🔍';
      }
    });

    // Allow Enter to trigger fill from the card input
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') fillBtn.click();
    });
  },
};
