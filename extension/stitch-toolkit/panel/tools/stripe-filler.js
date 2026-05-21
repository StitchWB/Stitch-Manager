// Stitch Toolkit — Stripe Filler Tool (IIFE)
// Parses card string "5154620021123771|01|2030|635" and fills Stripe fields
// via background script executeScript(allFrames:true) to reach cross-origin iframes.
// Billing fields (name, country, address, city, state, postal code) are optional.

(function () {
  'use strict';

  // Prevent double registration
  if (window.StripeFillerTool) return;

  // ── Address presets by country ────────────────────────────────────────────
  // Each entry: [displayName, country, state, city, postalCode, addressLine]
  // Addresses are realistic-looking test data for form autofill.
  var ADDRESS_PRESETS = {
    US: ['🇺🇸 US', 'US', 'CA', 'San Francisco', '94105', '1 Market St'],
    GB: ['🇬🇧 UK', 'GB', 'London', 'London', 'SW1A 1AA', '10 Downing Street'],
    DE: ['🇩🇪 DE', 'DE', 'Bayern', 'München', '80331', 'Marienplatz 1'],
    FR: ['🇫🇷 FR', 'FR', 'Île-de-France', 'Paris', '75001', '1 Rue de la Paix'],
    KR: ['🇰🇷 KR', 'KR', 'Seoul', 'Seoul', '04524', '23 Teheran-ro'],
    JP: ['🇯🇵 JP', 'JP', 'Tokyo', 'Shibuya-ku', '150-0002', '1-1-1 Dogenzaka'],
    CA: ['🇨🇦 CA', 'CA', 'ON', 'Toronto', 'M5H 2N2', '100 King Street West'],
    AU: ['🇦🇺 AU', 'AU', 'VIC', 'Melbourne', '3000', '1 Collins Street'],
    BR: ['🇧🇷 BR', 'BR', 'SP', 'São Paulo', '01311-100', 'Av Paulista 1578'],
    NL: ['🇳🇱 NL', 'NL', 'Noord-Holland', 'Amsterdam', '1012 AB', 'Dam 1'],
    SG: ['🇸🇬 SG', 'SG', '', 'Singapore', '018956', '1 Raffles Place'],
    HK: ['🇭🇰 HK', 'HK', '', 'Hong Kong', '999077', '1 Queen\'s Road Central'],
    SE: ['🇸🇪 SE', 'SE', 'Stockholm', 'Stockholm', '111 22', 'Drottninggatan 1'],
    CH: ['🇨🇭 CH', 'CH', 'ZH', 'Zürich', '8001', 'Bahnhofstrasse 1'],
    IT: ['🇮🇹 IT', 'IT', 'Lazio', 'Roma', '00100', 'Via del Corso 1'],
    ES: ['🇪🇸 ES', 'ES', 'Madrid', 'Madrid', '28001', 'Calle Gran Vía 1'],
    PL: ['🇵🇱 PL', 'PL', 'Mazowieckie', 'Warszawa', '00-001', 'ul. Nowy Świat 1'],
    CZ: ['🇨🇿 CZ', 'CZ', 'Hlavní město Praha', 'Praha', '110 00', 'Václavské náměstí 1'],
    PT: ['🇵🇹 PT', 'PT', 'Lisboa', 'Lisboa', '1100-001', 'Rua Augusta 1'],
    IE: ['🇮🇪 IE', 'IE', 'Dublin', 'Dublin', 'D02 AF30', '1 Grafton Street'],
  };

  // Surnames and given names per country for name generation
  var NAME_DATA = {
    US: { given: ['James','Mary','Robert','Patricia','John','Jennifer','Michael','Linda','David','Elizabeth'], surname: ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez'] },
    GB: { given: ['Oliver','Amelia','Harry','Emily','George','Isla','Noah','Ava','Jack','Mia'], surname: ['Smith','Jones','Williams','Taylor','Brown','Davies','Evans','Wilson','Thomas','Roberts'] },
    DE: { given: ['Lukas','Anna','Maximilian','Sophie','Paul','Marie','Leon','Emma','Felix','Hannah'], surname: ['Müller','Schmidt','Schneider','Fischer','Weber','Meyer','Wagner','Becker','Schulz','Hoffmann'] },
    FR: { given: ['Luc','Camille','Raphaël','Léa','Gabriel','Manon','Louis','Chloé','Arthur','Inès'], surname: ['Martin','Bernard','Dubois','Thomas','Robert','Richard','Petit','Durand','Leroy','Moreau'] },
    KR: { given: ['Min-jun','Ji-woo','Do-yun','Seo-yun','Ye-jun','Ha-eun','Joo-won','So-yu','Si-woo','Yu-na'], surname: ['Kim','Lee','Park','Choi','Jung','Kang','Cho','Yoo','Lim','Han'] },
    JP: { given: ['Haruto','Yui','Sota','Sakura','Ren','Hina','Yamato','Aoi','Sota','Hana'], surname: ['Sato','Suzuki','Takahashi','Tanaka','Watanabe','Ito','Yamamoto','Nakamura','Kobayashi','Kato'] },
    CA: { given: ['Liam','Olivia','Noah','Emma','William','Sophia','Oliver','Ava','Benjamin','Isabella'], surname: ['Smith','Brown','Tremblay','Martin','Roy','Wilson','MacDonald','Gagnon','Johnson','Taylor'] },
    AU: { given: ['Oliver','Charlotte','Jack','Mia','William','Amelia','Lucas','Harper','Thomas','Ella'], surname: ['Smith','Jones','Williams','Brown','Taylor','Wilson','Johnson','Martin','Anderson','Thompson'] },
    BR: { given: ['Miguel','Ana','Arthur','Helena','Gael','Valentina','Heitor','Laura','Davi','Alice'], surname: ['Silva','Santos','Oliveira','Souza','Lima','Pereira','Costa','Ferreira','Rodrigues','Almeida'] },
    NL: { given: ['Daan','Emma','Lucas','Sophie','Sem','Mila','Lars','Lotte','Bram','Saar'], surname: ['de Jong','Jansen','de Vries','van den Berg','van Dijk','Bakker','Janssen','Visser','Smit','Meijer'] },
    SG: { given: ['Jian','Xin','Wei','Hui','Kai','Ling','Zhen','Yan','Jun','Mei'], surname: ['Tan','Lim','Lee','Ng','Ong','Wong','Goh','Chua','Chan','Koh'] },
    HK: { given: ['Chi','Yan','Wai','Mei','Kwan','Ling','Fai','Siu','Ho','Wing'], surname: ['Chan','Lee','Cheung','Wong','Liu','Leung','Chow','Yeung','Tang','Cheng'] },
    SE: { given: ['Liam','Alice','Noah','Maja','William','Ella','Lucas','Olivia','Oscar','Elsa'], surname: ['Andersson','Johansson','Karlsson','Nilsson','Eriksson','Larsson','Svensson','Persson','Gustafsson','Jönsson'] },
    CH: { given: ['Luca','Mia','Leo','Lina','Nico','Anna','Fabio','Sara','Matteo','Noemi'], surname: ['Müller','Meier','Schmid','Keller','Weber','Huber','Schneider','Steiner','Fischer','Brunner'] },
    IT: { given: ['Leonardo','Sofia','Francesco','Aurora','Lorenzo','Giulia','Andrea','Beatrice','Matteo','Alice'], surname: ['Rossi','Ferrari','Russo','Bianchi','Romano','Colombo','Ricci','Marino','Greco','Bruno'] },
    ES: { given: ['Lucas','Sofía','Mateo','María','Daniel','Lucía','Pablo','Martina','Hugo','Paula'], surname: ['García','Fernández','López','Martínez','Sánchez','Pérez','Gómez','Martín','Jiménez','Ruiz'] },
    PL: { given: ['Jan','Anna','Jakub','Zofia','Antoni','Hanna','Franciszek','Maria','Aleksander','Polonia'], surname: ['Nowak','Kowalska','Wiśniewski','Wójcik','Kamińska','Lewandowski','Zielińska','Szymańska','Woźniak','Dąbrowska'] },
    CZ: { given: ['Jan','Ema','Jakub','Eliška','Tomáš','Anna','Matěj','Tereza','Lukáš','Natálie'], surname: ['Novák','Svobodová','Novotná','Dvořáková','Černý','Procházková','Kučerová','Veselá','Horáková','Němcová'] },
    PT: { given: ['Francisco','Maria','João','Leonor','Santiago','Beatriz','Afonso','Inês','Duarte','Carolina'], surname: ['Silva','Santos','Ferreira','Pereira','Rodrigues','Costa','Martins','Sousa','Fernandes','Gonçalves'] },
    IE: { given: ['Jack','Emily','Sean','Aoife','Conor','Niamh','Finn','Saoirse','Oscar','Caoimhe'], surname: ['Murphy','Kelly','O\'Sullivan','Walsh','Smith','O\'Brien','Byrne','Ryan','O\'Connor','O\'Neill'] },
  };

  function randomPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function generateName(countryCode) {
    var data = NAME_DATA[countryCode] || NAME_DATA.US;
    return randomPick(data.given) + ' ' + randomPick(data.surname);
  }

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
        '<select id="tk-country-preset" class="tk-input" style="padding:1px 4px;font-size:10px;flex:0 0 auto;max-width:90px;cursor:pointer;">' +
          Object.keys(ADDRESS_PRESETS).map(function (code) {
            return '<option value="' + code + '">' + ADDRESS_PRESETS[code][0] + '</option>';
          }).join('') +
        '</select>' +
        '<button id="tk-gen-addr" class="tk-btn" style="padding:2px 6px;font-size:10px;flex:0 0 auto;" title="Generate address">🎲</button>' +
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

    // Address generator: country preset + randomize
    function applyAddressPreset() {
      var code = $('tk-country-preset').value;
      var preset = ADDRESS_PRESETS[code];
      if (!preset) return;
      $('tk-use-billing').checked = true;
      $('tk-billing-fields').style.display = 'block';
      $('tk-name').value = generateName(code);
      $('tk-country').value = preset[1]; // country code
      $('tk-state').value = preset[2];   // administrative area
      $('tk-city').value = preset[3];     // city
      $('tk-postal').value = preset[4];   // postal code
      $('tk-address').value = preset[5];  // address line
    }

    $('tk-country-preset').addEventListener('change', applyAddressPreset);

    // Randomize button: re-roll name + slight address variation
    $('tk-gen-addr').addEventListener('click', function () {
      applyAddressPreset();
      // Re-roll the name for variety
      var code = $('tk-country-preset').value;
      $('tk-name').value = generateName(code);
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