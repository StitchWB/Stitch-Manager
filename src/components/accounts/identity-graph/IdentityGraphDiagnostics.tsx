import type { UnifiedGraphDiagnostics } from '@/lib/graph/unifiedGraph';

interface IdentityGraphDiagnosticsProps {
  diagnostics: UnifiedGraphDiagnostics;
}

export function IdentityGraphDiagnostics({ diagnostics }: IdentityGraphDiagnosticsProps) {
  const items = [
    { label: 'Identities', value: diagnostics.identities },
    { label: 'Services', value: diagnostics.services },
    { label: 'Links', value: diagnostics.links },
    { label: 'Local accounts', value: diagnostics.localAccounts },
    { label: 'Local profiles', value: diagnostics.localProfiles },
    { label: 'Svc→Acc matches', value: diagnostics.matchedServiceToAccount },
    { label: 'Acc→Profile matches', value: diagnostics.matchedAccountToProfile },
  ];

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-300">
        Graph diagnostics
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {items.map(item => (
          <div
            key={item.label}
            className="rounded-lg border border-white/10 bg-white/[0.02] p-3"
          >
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">{item.label}</div>
            <div className="text-lg font-semibold text-white mt-1">{item.value}</div>
          </div>
        ))}
      </div>
      {diagnostics.reasons.length ? (
        <div className="space-y-1">
          {diagnostics.reasons.slice(0, 4).map(reason => (
            <div key={reason.code} className="text-[11px] text-amber-200/90">
              {reason.message}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
