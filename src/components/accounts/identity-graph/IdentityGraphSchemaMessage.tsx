import { cn } from '@/lib/utils';

interface IdentityGraphSchemaMessageProps {
  schemaMessage: string | null;
  schemaStatus: 'idle' | 'loading' | 'success' | 'error';
}

export function IdentityGraphSchemaMessage({
  schemaMessage,
  schemaStatus,
}: IdentityGraphSchemaMessageProps) {
  if (!schemaMessage) return null;

  return (
    <div
      className={cn(
        'rounded-xl border p-3 text-xs',
        schemaStatus === 'error'
          ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
      )}
    >
      {schemaMessage}
    </div>
  );
}
