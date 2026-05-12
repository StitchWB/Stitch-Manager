// Stitch Toolkit — Stripe Filler Tool (IIFE)
// Parses card string "5154620021123771|01|2030|635" and fills Stripe fields
// via background script executeScript(allFrames:true) to reach cross-origin iframes.
// Billing fields (name, country, address, city, state, postal code) are optional.

(function () {
  'use strict';

  // Prevent double registration
  if (window.StripeFillerTool) return;

  function luhn(card) {
    var n = card.replace(/\D/g, '');
    if (!n || n.length < 13) return false;
    var sum = 0, odd = false;
    for (var i = n.length - 1; i >= 0; i--) {
      var d = parseInt(n[i], 10);
      if (odd) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
      odd = !odd;
    }
    return sum % 10 === 0;
  }

  function mask(raw) { return raw.replace(/\d(?=\d{4})/g, '*'); }

  function parseCard(raw) {
    var t = String(raw || '').trim();
    if (!t) return null;
    var p = t.split('|');
    if (p.length >= 4) return { number: p[0].trim(), month: p[1].trim(), year: p[2].trim(), cvc: p[3].trim() };
    var m = t.match(/(\d{13,19})\D+(\d{1,2})\D+(\d{2,4})\D+(\d{3,4})/);
    if (m) return { number: m[1], month: m[2], year: m[3], cvc: m[4] };
    return null;
  }

  function saveCard(raw) {
    if (!raw || raw.trim().length < 10) return;
    var hist = window.StateManager.get('cardHistory') || [];
    var filtered = hist.filter(function (h) { return h.raw !== raw.trim(); });
    filtered.unshift({ raw: raw.trim(), ts: Date.now(), name: '' });
    if (filtered.length > 10) filtered.length = 10;
    window.StateManager.set('cardHistory', filtered);
    window.StateManager.set('lastCard', raw.trim());
  }

  function fillForm(data, billing) {
    return chrome.runtime.sendMessage({ type: 'tk:stripe-fill', payload: { cardData: data, billing: billing } })
      .then(function (resp) {
        if (resp && resp.ok) return resp;
        throw new Error(resp && resp.error ? resp.error : 'No Stripe fields found');
      });
  }

  function quickFill() {
    var lastCard = window.StateManager.get('lastCard');
    if (!lastCard) { window.NotificationService.warn(window.StitchI18n.t('stripe.noLastCard')); return; }
    var data = parseCard(lastCard);
    if (!data) { window.NotificationService.error(window.StitchI18n.t('stripe.invalidLastCard')); return; }
    window.PanelManager.setSubtitle(window.StitchI18n.t('status.filling'));
    fillForm(data, null).then(function (resp) {
      window.NotificationService.success(window.StitchI18n.t('stripe.filledLastCard', { count: resp.filledFrames || '?' }));
      window.PanelManager.setSubtitle(window.StitchI18n.t('stripe.cardDetails'));
    }).catch(function (e) {
      window.NotificationService.error(window.StitchI18n.t('stripe.fillFailed') + ': ' + (e.message || ''));
      window.PanelManager.setSubtitle(window.StitchI18n.t('stripe.cardDetails'));
    });
  }

  function render() {
    var hist = window.StateManager.get('cardHistory') || [];
    var last = window.StateManager.get('lastCard') || '';
    var i18n = window.StitchI18n.t;
    var opts = hist.map(function (h, i) {
      return '<option value="' + h.raw.replace(/"/g, '&quot;') + '">' + mask(h.raw) + '</option>';
    }).join('');

    return (
      '<div class="tk-section-title">' + i18n('stripe.cardDetails') + '</div>' +
      '<div class="tk-row">' +
        '<input id="tk-card" class="tk-input" type="text" placeholder="5154...|MM|YY|CVC" autocomplete="off" spellcheck="false" value="' + last.replace(/"/g, '&quot;') + '" />' +
      '</div>' +
      '<div class="tk-row" style="display:flex;gap:4px;">' +
        '<button id="tk-fill-btn" class="tk-btn tk-accent" style="flex:1;">' + i18n('stripe.fillCard') + '</button>' +
        '<button id="tk-save-btn" class="tk-btn" style="flex:0 0 auto;padding:6px 8px;" title="' + i18n('stripe.saveCard') + '">💾</button>' +
      '</div>' +
      '<div class="tk-row" style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--tk-text-muted);">' +
        '<input id="tk-use-billing" type="checkbox" checked style="accent-color:var(--tk-accent);width:12px;height:12px;margin:0;" />' +
        '<label for="tk-use-billing" style="cursor:pointer;">' + i18n('stripe.billing') + '</label>' +
        '<span style="flex:1"></span>' +
        '<button id="tk-preset-us" class="tk-btn" style="padding:2px 6px;font-size:10px;flex:0 0 auto;">🇺🇸</button>' +
      '</div>' +
      '<div id="tk-billing-fields" style="display:none;">' +
        '<input id="tk-name" class="tk-input" type="text" placeholder="' + i18n('stripe.name') + '" style="margin-bottom:4px;padding:5px 8px;font-size:11px;" />' +
        '<div style="display:flex;gap:4px;margin-bottom:4px;">' +
          '<input id="tk-country" class="tk-input" type="text" placeholder="US" style="margin:0;flex:0 0 45px;padding:5px 8px;font-size:11px;text-transform:uppercase;" />' +
          '<input id="tk-address" class="tk-input" type="text" placeholder="' + i18n('stripe.address') + '" style="margin:0;flex:1;padding:5px 8px;font-size:11px;" />' +
        '</div>' +
        '<div style="display:flex;gap:4px;margin-bottom:4px;">' +
          '<input id="tk-city" class="tk-input" type="text" placeholder="' + i18n('stripe.city') + '" autocomplete="address-level2" style="margin:0;flex:1;padding:5px 8px;font-size:11px;" />' +
          '<input id="tk-state" class="tk-input" type="text" placeholder="' + i18n('stripe.state') + '" autocomplete="address-level1" style="margin:0;flex:0 0 45px;padding:5px 8px;font-size:11px;text-transform:uppercase;" />' +
        '</div>' +
        '<input id="tk-postal" class="tk-input" type="text" placeholder="' + i18n('stripe.postal') + '" style="margin-bottom:6px;width:80px;padding:5px 8px;font-size:11px;" />' +
      '</div>' +
      '<div class="tk-row">' +
        '<select id="tk-hist" class="tk-input" style="font-size:11px;padding:4px;">' +
          '<option value="">' + i18n('stripe.history') + '</option>' + opts +
        '</select>' +
      '</div>' +
      '<div id="tk-msg" class="tk-status" style="display:none;"></div>' +
      '<div class="tk-hint">' + i18n('stripe.shortcuts') + '</div>'
    );
  }

  function mount(container) {
    container.innerHTML = render();
    var $ = function (s) { return container.querySelector(s.charAt(0) === '#' ? s : '#' + s); };

    var showOk = function (msg) {
      var el = $('tk-msg'); if (el) { el.style.display = 'flex'; el.className = 'tk-status tk-ok'; el.innerHTML = '<span class="tk-status-icon">✅</span><span>' + msg + '</span>'; }
    };
    var showErr = function (msg) {
      var el = $('tk-msg'); if (el) { el.style.display = 'flex'; el.className = 'tk-status tk-err'; el.innerHTML = '<span class="tk-status-icon">❌</span><span>' + msg + '</span>'; }
    };
    var hideMsg = function () { var el = $('tk-msg'); if (el) el.style.display = 'none'; };

    // Toggle billing fields
    $('tk-use-billing').addEventListener('change', function () {
      var billingFields = $('tk-billing-fields');
      billingFields.style.display = this.checked ? 'block' : 'none';
    });
    // Initialize billing fields visibility
    $('tk-billing-fields').style.display = $('tk-use-billing').checked ? 'block' : 'none';

    // US Preset button
    $('tk-preset-us').addEventListener('click', function () {
      $('tk-use-billing').checked = true;
      $('tk-billing-fields').style.display = 'block';
      $('tk-country').value = 'US';
      $('tk-state').value = 'CA';
      $('tk-city').value = 'San Francisco';
      $('tk-postal').value = '94105';
      $('tk-address').value = '1 Market St';
    });

    // Card input validation
    $('tk-card').addEventListener('input', function () {
      var raw = this.value.trim();
      if (raw.length >= 13) {
        var num = raw.split('|')[0].replace(/\D/g, '');
        if (num.length >= 13) {
          this.classList.toggle('tk-valid', luhn(num));
          this.classList.toggle('tk-invalid', !luhn(num) && raw.indexOf('|') !== -1);
        }
      } else {
        this.classList.remove('tk-valid', 'tk-invalid');
      }
    });

    // History dropdown
    $('tk-hist').addEventListener('change', function () {
      if (this.value) { $('tk-card').value = this.value; this.value = ''; }
    });

    // Save button
    $('tk-save-btn').addEventListener('click', function () {
      var raw = $('tk-card').value;
      if (!raw.trim()) { showErr(window.StitchI18n.t('stripe.enterCardFirst')); return; }
      if (!parseCard(raw)) { showErr(window.StitchI18n.t('stripe.invalidFormat')); return; }
      saveCard(raw);
      showOk(window.StitchI18n.t('stripe.saved'));
      setTimeout(hideMsg, 1500);
    });

    // Fill button
    $('tk-fill-btn').addEventListener('click', function () {
      hideMsg();
      var raw = $('tk-card').value;
      var data = parseCard(raw);
      if (!data) { showErr(window.StitchI18n.t('stripe.formatHint')); return; }

      var billing = $('tk-use-billing').checked ? {
        name: $('tk-name').value.trim(),
        country: $('tk-country').value.trim().toUpperCase(),
        address: $('tk-address').value.trim(),
        locality: $('tk-city').value.trim(),
        administrativeArea: $('tk-state').value.trim(),
        postalCode: $('tk-postal').value.trim(),
      } : null;

      saveCard(raw);
      var btn = $('tk-fill-btn');
      btn.disabled = true;
      btn.innerHTML = '<span>⏳</span> ' + window.StitchI18n.t('status.filling');

      fillForm(data, billing).then(function (resp) {
        btn.disabled = false;
        btn.innerHTML = window.StitchI18n.t('stripe.fillCard');
        showOk(window.StitchI18n.t('stripe.filledFrames', { count: resp.filledFrames || '?' }));
        setTimeout(hideMsg, 3000);
      }).catch(function (e) {
        btn.disabled = false;
        btn.innerHTML = window.StitchI18n.t('stripe.fillCard');
        showErr(window.StitchI18n.t('stripe.fillFailed') + ': ' + (e.message || ''));
        setTimeout(hideMsg, 4000);
      });
    });

    // Quick fill button (mini)
    var miniBtn = container.querySelector('#tk-stripe-fill-mini');
    if (miniBtn) {
      miniBtn.addEventListener('click', quickFill);
    }
  }

  // Export to window namespace
  window.StripeFillerTool = {
    id: 'stripe',
    name: 'Stripe Filler',
    icon: '💳',
    mount: mount,
    quickFill: quickFill
  };

})();