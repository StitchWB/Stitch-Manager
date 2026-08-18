import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function HoloneSecurity() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/ai/tools?tab=holone', { replace: true });
  }, [navigate]);
  return null;
}