import { useEffect, useState } from 'react';
import { scoreColor } from '../lib/format';

// Animated SVG ring showing a 0-100 score.
function ScoreRing({ score = 0, size = 190, stroke = 14 }) {
  const value = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  const center = size / 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filledOffset = circumference * (1 - value / 100);

  // Start empty, then animate to the filled offset on mount (CSS transition).
  const [offset, setOffset] = useState(circumference);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOffset(filledOffset));
    return () => cancelAnimationFrame(id);
  }, [filledOffset]);

  const color = scoreColor(value);

  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="score-ring-svg" role="img" aria-label={`Health score ${value} of 100`}>
        <circle
          className="score-ring-track"
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className="score-ring-fill"
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <div className="score-ring-center">
        <div className="score-ring-value" style={{ color }}>{value}</div>
        <div className="score-ring-label">Health Score</div>
      </div>
    </div>
  );
}

export default ScoreRing;
