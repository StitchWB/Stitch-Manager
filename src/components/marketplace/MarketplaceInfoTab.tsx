import { ExternalLink } from 'lucide-react';
import { KeyValueList } from '@/components/ui/KeyValueList';
import { t } from '@/lib/i18n';
import { resolveI18n } from '@/lib/i18nText';
import type { MarketplaceItem } from '@/lib/backend/modules/marketplace';

/** External link row (homepage / repository) for the detail info tab. */
function ExternalLinkRow({ href, label }: { href: string; label: string }) {
  return (
    // eslint-disable-next-line react/forbid-elements -- external URL; react-router Link is internal-only
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 w-fit text-sm text-indigo-300 hover:text-indigo-200 transition-colors"
    >
      <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </a>
  );
}

interface MarketplaceInfoTabProps {
  item: MarketplaceItem;
  language: string;
  sourceLabel: string;
}

export function MarketplaceInfoTab({ item, language, sourceLabel }: MarketplaceInfoTabProps) {
  const hasLinks = Boolean(item.homepage) || Boolean(item.repository);

  return (
    <div className="flex flex-col gap-5">
      <KeyValueList
        density="comfortable"
        rows={[
          {
            id: 'id',
            label: t('marketplace.idLabel'),
            value: item.id,
          },
          {
            id: 'source',
            label: t('marketplace.sourceLabel'),
            value: sourceLabel,
          },
          {
            id: 'author',
            label: t('marketplace.authorLabel'),
            value: item.author ?? '—',
          },
          {
            id: 'version',
            label: t('marketplace.versionLabel'),
            value: item.version ?? '—',
          },
          {
            id: 'installed-version',
            label: t('marketplace.installedVersionLabel'),
            value: item.installed_version ?? '—',
          },
          {
            id: 'access',
            label: t('marketplace.accessLabel'),
            value: item.entitled
              ? t('marketplace.accessGranted')
              : t('marketplace.unavailableForRole'),
            tone: item.entitled ? 'success' : 'danger',
          },
        ]}
      />

      {hasLinks && (
        <section>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            {t('marketplace.linksTitle')}
          </h3>
          <div className="flex flex-col gap-1.5">
            {item.homepage ? (
              <ExternalLinkRow
                href={item.homepage}
                label={t('marketplace.linkHomepage')}
              />
            ) : null}
            {item.repository ? (
              <ExternalLinkRow
                href={item.repository}
                label={t('marketplace.linkRepository')}
              />
            ) : null}
          </div>
        </section>
      )}

      {item.changelog != null && item.changelog.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            {t('marketplace.changelogTitle')}
          </h3>
          <ol className="flex flex-col gap-4 border-l border-white/[0.06] pl-3">
            {item.changelog.map(entry => (
              <li key={`${entry.version}:${entry.date}`}>
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-slate-200">
                    {entry.version}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {entry.date}
                  </span>
                </div>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {entry.changes.map(change => {
                    const text = resolveI18n(change, language);
                    return (
                      <li
                        key={text}
                        className="text-xs text-slate-400 leading-relaxed"
                      >
                        {text}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
