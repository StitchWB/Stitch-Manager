import { useNavigate } from 'react-router-dom';
import { Home, AlertTriangle } from 'lucide-react';
import { t } from '../lib/i18n';
import { Button } from '../components/ui/Button';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="text-center">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
          </div>
        </div>
        <h1 className="text-4xl font-bold text-white mb-2">{t('notFoundPage.title')}</h1>
        <p className="text-slate-400 mb-6">{t('notFoundPage.description')}</p>
        <Button
          onClick={() => navigate('/')}
          variant="primary"
          size="md"
          leftIcon={<Home className="w-4 h-4" />}
          className="mx-auto"
        >
          {t('notFoundPage.goHome')}
        </Button>
      </div>
    </div>
  );
}
