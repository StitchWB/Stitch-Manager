/**
 * TotpTimer — SVG circular countdown for a 30-second TOTP window.
 *
 * Displays a circle whose arc depletes as time passes.
 * Color transitions: green → amber (≤10s) → red (≤5s).
 */

import { useEffect, useRef, useState } from 'react';

interface TotpTimerProps {
  /** TOTP period in seconds (default 30) */
  period?: number;
  /** Circle size in px (default 28) */
  size?: number;
  /** Stroke width (default 2.5) */
  strokeWidth?: number;
  /** Show remaining seconds as text inside circle */
  showText?: boolean;
  className?: string;
}

function getSecondsRemaining(period: number): number {
  return period - (Math.floor(Date.now() / 1000) % period);
}

export function TotpTimer({
  period = 30,
  size = 28,
  strokeWidth = 2.5,
  showText = true,
  className,
}: TotpTimerProps) {
  const [remaining, setRemaining] = useState(() => getSecondsRemaining(period));
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    let last = -1;

    const tick = () => {
      const now = getSecondsRemaining(period);
      if (now !== last) {
        last = now;
        setRemaining(now);
      }
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [period]);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = remaining / period; // 1 → full, 0 → empty
  const dashOffset = circumference * (1 - progress);

  // Color based on remaining time
  const color =
    remaining <= 5
      ? '#f14c4c'   // vsc-red
      : remaining <= 10
      ? '#cca700'   // vsc-yellow
      : '#4ec9b0';  // vsc-green

  const cx = size / 2;
  const cy = size / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      aria-label={`${remaining} seconds remaining`}
      style={{ flexShrink: 0 }}
    >
      {/* Background track */}
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={strokeWidth}
      />
      {/* Progress arc — starts at top (−90°) */}
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: 'stroke 0.3s ease' }}
      />
      {showText && (
        <text
          x={cx}
          y={cy}
          dominantBaseline="central"
          textAnchor="middle"
          fontSize={size * 0.32}
          fontWeight="600"
          fill={color}
          style={{ fontVariantNumeric: 'tabular-nums', transition: 'fill 0.3s ease' }}
        >
          {remaining}
        </text>
      )}
    </svg>
  );
}
