import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { t } from '@/lib/i18n';
import { openUrlInBrowser } from '@/lib/backend/modules/aiProxy';
import type { RadarOffer } from '@/lib/backend';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-2xs font-bold text-slate-600 uppercase tracking-widest mb-0.5">{label}</p>
      <p className="text-xs text-slate-300 truncate">{value}</p>
    </div>
  );
}

function Section({ label, content }: { label: string; content: string }) {
  return (
    <div className="mt-3">
      <p className="text-2xs font-bold text-slate-600 uppercase tracking-widest mb-1">{label}</p>
      <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">{content}</p>
    </div>
  );
}

interface OfferDetailProps {
  offer: RadarOffer;
}

/**
 * Accordion detail panel rendered below an expanded OfferRow.
 */
export function OfferDetail({ offer }: OfferDetailProps) {
  const sourceUrl = offer.source_url;

  return (
    <div className="px-4 py-3 bg-white/[0.02] border-t border-white/[0.04]">
      {offer.description && (
        <p className="text-sm text-slate-300 mb-3 leading-relaxed">{offer.description}</p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {offer.reliability !== null && (
          <Field label={t('radar.reliability')} value={`${Math.round(offer.reliability)}%`} />
        )}
        <Field label={t('radar.status')} value={offer.status} />
        {offer.engine && <Field label={t('radar.engine')} value={offer.engine} />}
        {offer.referral_required && <Field label={t('radar.referralRequired')} value={t('radar.referralRequired')} />}
      </div>

      {offer.claim_steps && <Section label={t('radar.claimSteps')} content={offer.claim_steps} />}
      {offer.requirements && <Section label={t('radar.requirements')} content={offer.requirements} />}

      {sourceUrl && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 text-indigo-400 hover:text-indigo-300"
          rightIcon={<ExternalLink size={12} />}
          onClick={() => void openUrlInBrowser(sourceUrl)}
        >
          {t('radar.sourceLink')}
        </Button>
      )}
    </div>
  );
}
