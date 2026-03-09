import type { UnifiedGraphDiagnostics } from '@/lib/graph/unifiedGraph';

interface IdentityGraphDiagnosticsProps {
  diagnostics: UnifiedGraphDiagnostics;
}

export function IdentityGraphDiagnostics({ diagnostics }: IdentityGraphDiagnosticsProps) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-300">
        Graph diagnostics
      </div>
      <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-slate-400">
        <div>Identities: {diagnostics.identities}</div>
        <div>Services: {diagnostics.services}</div>
        <div>Links: {diagnostics.links}</div>
        <div>Local accounts: {diagnostics.localAccounts}</div>
        <div>Local profiles: {diagnostics.localProfiles}</div>
        <div>Svc→Acc matches: {diagnostics.matchedServiceToAccount}</div>
        <div>Acc→Profile matches: {diagnostics.matchedAccountToProfile}</div>
      </div>
      {diagnostics.reasons.length ? (
        <div className="mt-2 space-y-1">
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
