import { isOtpauthUri, parseOtpauthUri } from '@/lib/otpauth';

const URI =
  'otpauth://totp/AWS%20Builder%20ID:user@whitebite.ru?secret=QOC2VNJ7MFNRH754&issuer=AWS%20Builder%20ID&period=30&digits=6&algorithm=SHA1';

describe('isOtpauthUri', () => {
  it('detects otpauth prefix case-insensitively', () => {
    expect(isOtpauthUri('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP')).toBe(true);
    expect(isOtpauthUri('  OTPAUTH://totp/x  ')).toBe(true);
    expect(isOtpauthUri('JBSWY3DPEHPK3PXP')).toBe(false);
  });
});

describe('parseOtpauthUri', () => {
  it('parses a full URI', () => {
    expect(parseOtpauthUri(URI)).toEqual({
      label: 'user@whitebite.ru',
      issuer: 'AWS Builder ID',
      secret: 'QOC2VNJ7MFNRH754',
      digits: 6,
      period: 30,
      algorithm: 'SHA1',
    });
  });

  it('derives issuer from label prefix when param is absent', () => {
    const r = parseOtpauthUri('otpauth://totp/GitHub:octocat?secret=JBSWY3DPEHPK3PXP');
    expect(r).toMatchObject({ label: 'octocat', issuer: 'GitHub' });
  });

  it('keeps label as-is without colon or issuer', () => {
    const r = parseOtpauthUri('otpauth://totp/my%20key?secret=JBSWY3DPEHPK3PXP');
    expect(r).toMatchObject({ label: 'my key', issuer: null });
  });

  it('normalizes lowercase secret with spaces', () => {
    const r = parseOtpauthUri('otpauth://totp/x?secret=jbsw y3dp ehpk 3pxp');
    expect(r?.secret).toBe('JBSWY3DPEHPK3PXP');
  });

  it('drops invalid digits/period/algorithm params', () => {
    const r = parseOtpauthUri(
      'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=7&period=-5&algorithm=MD5'
    );
    expect(r).toEqual({ label: 'x', issuer: null, secret: 'JBSWY3DPEHPK3PXP' });
  });

  it.each([
    ['not a uri', 'not a uri'],
    ['http url', 'https://example.com/totp/x?secret=JBSWY3DPEHPK3PXP'],
    ['hotp', 'otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP'],
    ['missing secret', 'otpauth://totp/x'],
    ['invalid base32', 'otpauth://totp/x?secret=12345678901'],
    ['empty label', 'otpauth://totp/?secret=JBSWY3DPEHPK3PXP'],
  ])('returns null for %s', (_name, input) => {
    expect(parseOtpauthUri(input)).toBeNull();
  });
});
