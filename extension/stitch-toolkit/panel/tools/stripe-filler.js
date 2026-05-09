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
      <div class="tk-section-title">Stripe Card Filler</div>
      <div class="tk-hint">Card: number|MM|YYYY|CVC</div>
      <input
        id="tk-stripe-input"
        class="tk-input"
        type="text"
        placeholder="5154620021123771|01|2030|635"
        autocomplete="off"
        spellcheck="false"
      />
      <div class="tk-row" style="align-items:center;margin-top:4px;">
        <input id="tk-stripe-billing" type="checkbox" checked style="accent-color:#6366f1;width:14px;height:14px;" />
        <label for="tk-stripe-billing" style="font-size:11px;color:#8ea2d6;cursor:pointer;">Auto-fill billing fields</label>
      </div>
      <div class="tk-row" style="margin-top:8px;">
        <input id="tk-stripe-name" class="tk-input" type="text" placeholder="Cardholder name" style="margin-bottom:0;" />
      </div>
      <div class="tk-row" style="margin-top:6px;">
        <input id="tk-stripe-country" class="tk-input" type="text" placeholder="Country code (e.g. US)" style="margin-bottom:0;width:40%;" />
        <input id="tk-stripe-address" class="tk-input" type="text" placeholder="Address" style="margin-bottom:0;flex:1;" />
      </div>
      <div class="tk-row" style="margin-top:6px;">
        <input id="tk-stripe-postal" class="tk-input" type="text" placeholder="Postal code" style="margin-bottom:0;width:50%;" />
      </div>
      <div class="tk-row" style="margin-top:10px;">
        <button id="tk-stripe-fill" class="tk-btn tk-accent">Fill Stripe</button>
        <button id="tk-stripe-detect" class="tk-btn">Detect</button>
      </div>
      <div id="tk-stripe-status" class="tk-status tk-info" style="display:none"></div>
      <div class="tk-hint">
        Uses language-agnostic selectors (id / autocomplete) — works on checkout.stripe.com in any language.
      </div>
    `;

    const input = container.querySelector('#tk-stripe-input');
    const fillBtn = container.querySelector('#tk-stripe-fill');
    const detectBtn = container.querySelector('#tk-stripe-detect');
    const status = container.querySelector('#tk-stripe-status');
    const billingCb = container.querySelector('#tk-stripe-billing');
    const nameIn = container.querySelector('#tk-stripe-name');
    const countryIn = container.querySelector('#tk-stripe-country');
    const addressIn = container.querySelector('#tk-stripe-address');
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
        fillBtn.textContent = 'Fill Stripe';
      }
    });

    detectBtn.addEventListener('click', async () => {
      hideStatus();
      detectBtn.disabled = true;
      detectBtn.textContent = 'Detecting…';

      try {
        const resp = await chrome.runtime.sendMessage({
          type: 'tk:stripe-fill',
          payload: {
            cardData: { number: '4111111111111111', month: '12', year: '2030', cvc: '123' },
          },
        });
        if (resp?.ok) {
          showStatus(`Stripe detected in ${resp.filledFrames ?? '?'} frame(s).`, 'ok');
        } else {
          showStatus('Stripe fields not detected on this page.', 'err');
        }
      } catch (e) {
        showStatus(e instanceof Error ? e.message : String(e), 'err');
      } finally {
        detectBtn.disabled = false;
        detectBtn.textContent = 'Detect';
      }
    });

    // Allow Enter to trigger fill from the card input
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') fillBtn.click();
    });
  },
};
