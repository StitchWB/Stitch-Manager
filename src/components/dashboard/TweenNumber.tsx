import { useEffect } from 'react';
import { motion, useReducedMotion, useSpring, useTransform } from 'framer-motion';

interface TweenNumberProps {
  value: number;
  className?: string;
}

export function TweenNumber({ value, className }: TweenNumberProps) {
  const reduced = useReducedMotion();
  const spring = useSpring(value, { stiffness: 170, damping: 26 });
  const rounded = useTransform(spring, v => Math.round(v));

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  if (reduced) return <span className={className}>{value}</span>;
  return <motion.span className={className}>{rounded}</motion.span>;
}
