import React from 'react';

/**
 * A single point in a real score history, sourced from indexed contract events.
 * Once the Lodestar agents contract emits events, the backend will index them and
 * pass them here as `scoreHistory`.
 */
export interface ScoreEvent {
  /** Unix timestamp (seconds) of the on-chain event */
  timestamp: number;
  /** Agent score after this event */
  score: number;
}

interface Props {
  currentScore: number;
  totalPayments: number;
  successfulPayments: number;
  failedPayments: number;
  /**
   * Real, indexed score history sourced from contract events.
   * Pass `null` (or omit) while events are not yet available — the chart will
   * fall back to a synthesised approximation and label it as such.
   * Pass an empty array to show the "no history yet" empty state without any line.
   */
  scoreHistory?: ScoreEvent[] | null;
}

const WIDTH = 120;
const HEIGHT = 30;

/**
 * Copy shown in the sparse states (#856).
 *
 * A newly registered agent has zero or one data point, and this chart is one of
 * the first things it sees after registering. Saying *why* the chart is sparse
 * turns an apparently broken widget into an expected one.
 */
export const EMPTY_HISTORY_COPY = 'Score history starts after this agent’s first transaction.';
export const SINGLE_POINT_COPY = 'One data point so far — a trend line appears after the next transaction.';

/** Build a synthetic history by replaying deltas backwards from the current score. */
function buildSyntheticPoints(
  currentScore: number,
  successfulPayments: number,
  failedPayments: number
): number[] {
  const history: number[] = [];
  let score = currentScore - successfulPayments * 10 + failedPayments * 25;
  history.push(Math.max(0, Math.min(1000, score)));

  let s = successfulPayments;
  let f = failedPayments;

  while (s > 0 || f > 0) {
    if (s > 0 && (f === 0 || s >= f)) {
      score += 10;
      s--;
    } else {
      score -= 25;
      f--;
    }
    history.push(Math.max(0, Math.min(1000, score)));
  }

  // Guarantee the last point is the known current score.
  history[history.length - 1] = currentScore;
  return history;
}

function yFor(score: number): number {
  return HEIGHT - (Math.max(0, Math.min(1000, score)) / 1000) * HEIGHT;
}

function toPolylinePoints(values: number[]): string {
  const stepX = WIDTH / Math.max(1, values.length - 1);
  return values.map((val, i) => `${i * stepX},${yFor(val)}`).join(' ');
}

function ChartFrame({
  label,
  title,
  children,
}: {
  label: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-end">
      <div className="text-[10px] text-secondary mb-1" title={title}>
        {label}
      </div>
      {children}
    </div>
  );
}

/**
 * Zero data points: nothing to plot, so plot nothing — and explain it.
 * Rendering an empty axis or a flat line would imply a score that never moved,
 * which is a different claim from "nothing has happened yet".
 */
function EmptyState() {
  return (
    <ChartFrame label="Score History">
      <div
        data-testid="score-history-empty"
        className="text-[10px] text-secondary italic text-center leading-tight"
        style={{ width: WIDTH, minHeight: HEIGHT, display: 'flex', alignItems: 'center' }}
      >
        {EMPTY_HISTORY_COPY}
      </div>
    </ChartFrame>
  );
}

/**
 * One data point: a polyline of a single point draws nothing, and the end marker
 * would sit at the right-hand edge regardless of where the point actually is.
 * Render the point itself, centred, with a baseline for context.
 */
function SinglePointState({ score, estimated = false }: { score: number; estimated?: boolean }) {
  const y = yFor(score);
  const cx = WIDTH / 2;

  return (
    <ChartFrame
      label={estimated ? 'Score History (estimated)' : 'Score History'}
      title={estimated ? 'Estimated from payment counts, not real on-chain events.' : undefined}
    >
      <svg
        width={WIDTH}
        height={HEIGHT}
        className="overflow-visible"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Score history: a single data point at ${score}`}
        data-testid="score-history-single"
      >
        {/* Dashed baseline so the lone point reads as a position, not a stray dot. */}
        <line
          x1="0"
          y1={y}
          x2={WIDTH}
          y2={y}
          strokeWidth="1"
          strokeDasharray="2 3"
          stroke="currentColor"
          className="text-primary opacity-25"
        />
        <circle cx={cx} cy={y} r="3" className={estimated ? 'fill-primary opacity-60' : 'fill-primary'} />
      </svg>
      <div className="text-[10px] text-secondary italic text-center leading-tight" style={{ width: WIDTH }}>
        {SINGLE_POINT_COPY}
      </div>
    </ChartFrame>
  );
}

function LineChart({ values, estimated = false }: { values: number[]; estimated?: boolean }) {
  const points = toPolylinePoints(values);
  const lastY = yFor(values[values.length - 1]);

  return (
    <ChartFrame
      label={estimated ? 'Score History (estimated)' : 'Score History'}
      title={
        estimated
          ? 'Estimated only — the order and shape are reconstructed from payment counts, ' +
            'not from real on-chain events. Exact history will be available once contract events are indexed.'
          : undefined
      }
    >
      <svg
        width={WIDTH}
        height={HEIGHT}
        className="overflow-visible"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        aria-label={estimated ? 'Estimated score history chart' : 'Score history chart'}
        data-testid="score-history-line"
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={estimated ? 'text-primary opacity-40' : 'text-primary opacity-80'}
          points={points}
        />
        {/* The final point is always at the right edge for a multi-point series. */}
        <circle cx={WIDTH} cy={lastY} r="3" className={estimated ? 'fill-primary opacity-60' : 'fill-primary'} />
      </svg>
    </ChartFrame>
  );
}

export function ScoreHistoryChart({
  currentScore,
  totalPayments,
  successfulPayments,
  failedPayments,
  scoreHistory = null,
}: Props) {
  // ── Real event data path ────────────────────────────────────────────────────
  if (scoreHistory !== null) {
    if (scoreHistory.length === 0) return <EmptyState />;
    if (scoreHistory.length === 1) return <SinglePointState score={scoreHistory[0].score} />;

    return <LineChart values={scoreHistory.map((e) => e.score)} />;
  }

  // ── Synthetic data path ─────────────────────────────────────────────────────
  // No real events available. With no payments there is nothing to reconstruct,
  // so show the same honest empty state rather than rendering nothing at all —
  // a newly registered agent should see an explanation, not a blank space.
  if (successfulPayments === 0 && failedPayments === 0) {
    return <EmptyState />;
  }

  const syntheticValues = buildSyntheticPoints(currentScore, successfulPayments, failedPayments);

  if (syntheticValues.length === 1) {
    return <SinglePointState score={syntheticValues[0]} estimated />;
  }

  return <LineChart values={syntheticValues} estimated />;
}
