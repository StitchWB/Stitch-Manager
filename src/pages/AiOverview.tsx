import { Navigate } from 'react-router-dom';

/**
 * Legacy AI overview page. The hub now lands directly on /ai/providers,
 * so we just redirect any /ai entry to the providers tab.
 */
export default function AiOverview() {
  return <Navigate to="/ai/providers" replace />;
}
