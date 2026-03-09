import type { InvalidRow, SchemaIssue } from '@/types/generated';

interface IdentityGraphAlertsProps {
  schemaIssues: SchemaIssue[];
  invalidRows: InvalidRow[];
}

export function IdentityGraphAlerts({ schemaIssues, invalidRows }: IdentityGraphAlertsProps) {
  return (
    <>
      {schemaIssues.length > 0 ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-amber-200">
            Schema issues ({schemaIssues.length})
          </div>
          <div className="mt-2 space-y-1">
            {schemaIssues.slice(0, 6).map((issue, idx) => (
              <div key={`${issue.sheetName}-${idx}`} className="text-xs text-amber-100/90">
                [{issue.level}] {issue.sheetName}: {issue.message}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {invalidRows.length > 0 ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-rose-200">
            Invalid rows ({invalidRows.length})
          </div>
          <div className="mt-2 space-y-1">
            {invalidRows.slice(0, 6).map(row => (
              <div key={`${row.sheetName}-${row.rowNumber}`} className="text-xs text-rose-100/90">
                {row.sheetName} row {row.rowNumber}: {row.reason}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
