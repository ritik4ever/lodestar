import { scoreTier, TIER_LABELS, TIER_COLORS } from '@/lib/types';

interface Props {
  score: number;
  showScore?: boolean;
  size?: 'sm' | 'md';
}

export default function ScoreBadge({ score, showScore = true, size = 'md' }: Props) {
  const tier = scoreTier(score);
  const label = TIER_LABELS[tier];
  const colors = TIER_COLORS[tier];
  const textSize = size === 'sm' ? 'text-xs' : 'text-xs';
  const padding = size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-1';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${textSize} ${padding} ${colors}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          tier === 'elite'
            ? 'bg-amber-500'
            : tier === 'trusted'
            ? 'bg-emerald-500'
            : tier === 'established'
            ? 'bg-violet-500'
            : tier === 'building'
            ? 'bg-blue-500'
            : 'bg-gray-400'
        }`}
      />
      {label}
      {showScore && (
        <span className="opacity-70 font-mono">{score}</span>
      )}
    </span>
  );
}
