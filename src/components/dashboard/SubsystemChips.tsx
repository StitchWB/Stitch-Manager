import { Blocks, KeyRound, Mail, Radar, Timer, Users } from 'lucide-react';

import { t } from '@/lib/i18n';
import { StatItem } from '@/components/ui/StatItem';

import { formatDuration } from './ServiceRow';

// Official plugin matrix size (README): 9 service + engine-pack + 7 autoreg + legacy.
const OFFICIAL_PLUGIN_TOTAL = 17;

interface SubsystemChipsProps {
  pluginsInstalled: number;
  mailProfiles: number;
  totpKeys: number;
  schedulerTasks: number;
  friends: number | null;
  radarOffers: number | null;
  nextRunUnix: number | null;
  now: number;
}

export function SubsystemChips({
  pluginsInstalled,
  mailProfiles,
  totpKeys,
  schedulerTasks,
  friends,
  radarOffers,
  nextRunUnix,
  now,
}: SubsystemChipsProps) {
  const nextRunText =
    nextRunUnix !== null && nextRunUnix > 0
      ? ` · ${t('dashboard.cc.subsystems.nextRun', {
          time: formatDuration(Math.max(0, nextRunUnix * 1000 - now)),
        })}`
      : '';

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2 py-1">
      <StatItem
        icon={<Blocks size={14} />}
        tooltip={t('dashboard.cc.subsystems.plugins')}
        label={
          <span className="uppercase tracking-wider">{t('dashboard.cc.subsystems.plugins')}</span>
        }
        value={<span className="font-medium">{`${pluginsInstalled}/${OFFICIAL_PLUGIN_TOTAL}`}</span>}
        href="/marketplace"
      />
      <StatItem
        icon={<Mail size={14} />}
        tooltip={t('dashboard.cc.subsystems.mail')}
        label={
          <span className="uppercase tracking-wider">{t('dashboard.cc.subsystems.mail')}</span>
        }
        value={<span className="font-medium">{mailProfiles}</span>}
        href="/mail"
      />
      <StatItem
        icon={<KeyRound size={14} />}
        tooltip={t('dashboard.cc.subsystems.totp')}
        label={
          <span className="uppercase tracking-wider">{t('dashboard.cc.subsystems.totp')}</span>
        }
        value={<span className="font-medium">{totpKeys}</span>}
        href="/totp"
      />
      <StatItem
        icon={<Timer size={14} />}
        tooltip={t('dashboard.cc.subsystems.scheduler')}
        label={
          <span className="uppercase tracking-wider">{t('dashboard.cc.subsystems.scheduler')}</span>
        }
        value={<span className="font-medium">{`${schedulerTasks}${nextRunText}`}</span>}
        href="/scheduler"
      />
      <StatItem
        icon={<Users size={14} />}
        tooltip={t('dashboard.cc.subsystems.friends')}
        label={
          <span className="uppercase tracking-wider">{t('dashboard.cc.subsystems.friends')}</span>
        }
        value={friends !== null ? <span className="font-medium">{friends}</span> : undefined}
        href="/friends"
      />
      <StatItem
        icon={<Radar size={14} />}
        tooltip={t('dashboard.cc.subsystems.radar')}
        label={
          <span className="uppercase tracking-wider">{t('dashboard.cc.subsystems.radar')}</span>
        }
        value={radarOffers !== null ? <span className="font-medium">{radarOffers}</span> : undefined}
        href="/radar"
      />
    </div>
  );
}
