import { t } from '@/lib/i18n';

const CODE_KEY: Record<string, string> = {
  R1: 'devboxPage.errR1',
  R2: 'devboxPage.errR2',
  R4: 'devboxPage.errR4',
  R5: 'devboxPage.errR5',
  R6: 'devboxPage.errR6',
  R7: 'devboxPage.errR7',
  R8: 'devboxPage.errR8',
  R9: 'devboxPage.errR9',
  R10: 'devboxPage.errR10',
  R11: 'devboxPage.errR11',
  R12: 'devboxPage.errR12',
  R13: 'devboxPage.errR13',
  R14: 'devboxPage.errR14',
  R15: 'devboxPage.errR15',
  R16: 'devboxPage.errR16',
  R17: 'devboxPage.errR17',
  R18: 'devboxPage.errR18',
  R19: 'devboxPage.errR19',
  R20: 'devboxPage.errR20',
  R21: 'devboxPage.errR21',
  R22: 'devboxPage.errR22',
  R23: 'devboxPage.errR23',
  R25: 'devboxPage.errR25',
  R26: 'devboxPage.errR26',
  R27: 'devboxPage.errR27',
  R28: 'devboxPage.errR28',
  R29: 'devboxPage.errR29',
  R30: 'devboxPage.errR30',
  R31: 'devboxPage.errR31',
  R32: 'devboxPage.errR32',
  R33: 'devboxPage.errR33',
  R34: 'devboxPage.errR34',
  R35: 'devboxPage.errR35',
  R36: 'devboxPage.errR36',
  R37: 'devboxPage.errR37',
  R38: 'devboxPage.errR38',
  R39: 'devboxPage.errR39',
  R40: 'devboxPage.errR40',
  R41: 'devboxPage.errR41',
  R42: 'devboxPage.errR42',
};

export function profileErrorTitle(line: string): string | null {
  const match = /^(?:WARN )?(R\d+):/.exec(line.trim());
  if (match === null) return null;
  const key = CODE_KEY[match[1]];
  return key === undefined ? null : t(key);
}

export function isFolderProfileError(line: string): boolean {
  const match = /^(?:WARN )?(R\d+):/.exec(line.trim());
  if (match !== null) return match[1] === 'R1' || match[1] === 'R2';
  return /project_dir|\$ProjectDir/i.test(line);
}