export function maskKey(key: string): string {
  if (key.length <= 11) return '***';
  return `${key.slice(0, 8)}***${key.slice(-3)}`;
}