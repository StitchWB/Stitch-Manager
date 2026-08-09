function looksSensitive(text) {
  const v = String(text || '')
    .trim()
    .toLowerCase();
  if (!v) return false;
  return [
    'password',
    'passcode',
    'otp',
    'token',
    'secret',
    'cvv',
    'cvc',
    'security code',
    'card',
    'pan',
    'expiry',
    'exp',
    'iban',
    'ssn',
  ].some(k => v.includes(k));
}

function shouldRedact(el) {
  if (!el) return false;
  const type = String(el.getAttribute?.('type') || '').toLowerCase();
  if (type === 'password') return true;
  const attrs = [
    el.getAttribute?.('name'),
    el.getAttribute?.('id'),
    el.getAttribute?.('autocomplete'),
    el.getAttribute?.('aria-label'),
    el.getAttribute?.('placeholder'),
  ];
  return attrs.some(looksSensitive);
}

function redactValue(el, value) {
  if (shouldRedact(el)) return '***';
  return value;
}
