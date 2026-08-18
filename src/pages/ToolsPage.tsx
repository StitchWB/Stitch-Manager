import { useSearchParams } from 'react-router-dom';
import Header from '@/components/layout/Header';
import { AiTopTabs } from '@/components/ai-proxy/AiTopTabs';
import { CompressionSection } from '@/components/ai-proxy/sections/CompressionSection';
import { HoloneSection } from '@/components/ai-proxy/sections/HoloneSection';
import { TabButton } from '@/components/ui';
import { t } from '@/lib/i18n';
import { useAppStore } from '@/stores/app';
import { Wrench } from 'lucide-react';

type SubTab = 'compression' | 'holone';

export default function ToolsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const language = useAppStore(state => state.language);

  const tabParam = searchParams.get('tab');
  const activeSubTab: SubTab = tabParam === 'compression' ? 'compression' : 'holone';

  const setSubTab = (tab: SubTab) => {
    setSearchParams({ tab }, { replace: true });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-vsc-bg">
      <Header
        title={language === 'ru' ? 'Инструменты' : 'Tools'}
        icon={<Wrench size={18} />}
      />
      <AiTopTabs />

      {/* ── Sub-tab bar ────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-vsc-border-light bg-vsc-panel/60 px-3 md:px-5">
        <div className="flex h-10 items-center gap-0.5">
          <TabButton
            active={activeSubTab === 'compression'}
            onClick={() => setSubTab('compression')}
            appearance="section"
            size="sm"
            label={t('aiHub.tabs.compression')}
          />
          <TabButton
            active={activeSubTab === 'holone'}
            onClick={() => setSubTab('holone')}
            appearance="section"
            size="sm"
            label={t('aiHub.tabs.holone')}
          />
        </div>
      </div>

      {activeSubTab === 'compression' ? <CompressionSection /> : <HoloneSection />}
    </div>
  );
}