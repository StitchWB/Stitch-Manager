type StatusBadgeVariant = 'success' | 'error' | 'warning' | 'info' | 'default' | 'neutral';

const normalizeValue = (value: string | undefined) => (value ?? '').toLowerCase().trim();

export const getServiceBadgeClass = (service: string) => {
  const key = normalizeValue(service);
  if (key.includes('aws')) return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  if (key.includes('github')) return 'border-slate-500/30 bg-slate-500/10 text-slate-200';
  if (key.includes('kiro')) return 'border-indigo-500/30 bg-indigo-500/10 text-indigo-200';
  if (key.includes('windsurf')) return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200';
  if (key.includes('trae')) return 'border-purple-500/30 bg-purple-500/10 text-purple-200';
  return 'border-white/10 bg-white/5 text-slate-300';
};

export const getLinkTypeBadgeClass = (linkType?: string) => {
  const key = normalizeValue(linkType);
  if (key.includes('oauth')) return 'border-indigo-500/30 bg-indigo-500/10 text-indigo-200';
  if (key.includes('password')) return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  if (key.includes('phone')) return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200';
  if (key.includes('recovery')) return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  return 'border-white/10 bg-white/5 text-slate-300';
};

export const getStatusBadgeVariant = (status?: string): StatusBadgeVariant => {
  const key = normalizeValue(status);
  if (key.includes('active')) return 'success';
  if (key.includes('expired') || key.includes('limit')) return 'warning';
  if (key.includes('banned') || key.includes('suspended')) return 'error';
  if (key.includes('pending')) return 'info';
  return 'default';
};
