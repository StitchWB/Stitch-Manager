import { useNavigate } from 'react-router-dom';
import { Home, AlertTriangle } from 'lucide-react';

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
        <h1 className="text-4xl font-bold text-white mb-2">404</h1>
        <p className="text-slate-400 mb-6">Page Not Found</p>
        <button
          onClick={() => navigate('/')}
          className="btn-primary py-2 px-4 text-sm flex items-center gap-2 mx-auto"
        >
          <Home className="w-4 h-4" />
          Go Home
        </button>
      </div>
    </div>
  );
}
