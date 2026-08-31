import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  ScoreHistoryChart,
  EMPTY_HISTORY_COPY,
  SINGLE_POINT_COPY,
} from '../components/ScoreHistoryChart';
import type { ScoreEvent } from '../components/ScoreHistoryChart';

describe('ScoreHistoryChart', () => {
  // ── Synthetic data path (scoreHistory omitted / null) ─────────────────────

  // Changed in #856: a brand-new agent used to see *nothing* here, which reads
  // as a broken widget on the first screen after registering. It now shows the
  // explained empty state instead.
  it('renders the explained empty state when there are no payments and no scoreHistory', () => {
    render(
      <ScoreHistoryChart
        currentScore={500}
        totalPayments={0}
        successfulPayments={0}
        failedPayments={0}
      />
    );

    expect(screen.getByTestId('score-history-empty')).toBeInTheDocument();
    expect(screen.getByText(EMPTY_HISTORY_COPY)).toBeInTheDocument();
  });

  it('renders the synthetic sparkline with an explicit "estimated" label', () => {
    render(
      <ScoreHistoryChart
        currentScore={520}
        totalPayments={3}
        successfulPayments={2}
        failedPayments={1}
      />
    );

    // The label must use "estimated", not the old "approx"
    expect(screen.getByText('Score History (estimated)')).toBeInTheDocument();

    const polyline = document.querySelector('polyline');
    expect(polyline).toBeInTheDocument();

    const circle = document.querySelector('circle');
    expect(circle).toBeInTheDocument();
  });

  it('carries a tooltip explaining the synthetic nature of the data', () => {
    render(
      <ScoreHistoryChart
        currentScore={520}
        totalPayments={3}
        successfulPayments={2}
        failedPayments={1}
      />
    );

    const label = screen.getByText('Score History (estimated)');
    expect(label.getAttribute('title')).toMatch(/reconstructed from payment counts/i);
  });

  it('renders the synthetic line with reduced opacity', () => {
    render(
      <ScoreHistoryChart
        currentScore={520}
        totalPayments={3}
        successfulPayments={2}
        failedPayments={1}
      />
    );

    const polyline = document.querySelector('polyline');
    // SVG className is an SVGAnimatedString in jsdom — use getAttribute instead
    expect(polyline?.getAttribute('class')).toContain('opacity-40');
  });

  it('clamps synthetic score projections to [0, 1000]', () => {
    // currentScore=0 and 2 successful payments means reconstructed start is negative
    render(
      <ScoreHistoryChart
        currentScore={0}
        totalPayments={2}
        successfulPayments={2}
        failedPayments={0}
      />
    );

    const polyline = document.querySelector('polyline');
    expect(polyline).toBeInTheDocument();

    // No point coordinate should be outside the SVG height
    const points = polyline!.getAttribute('points')!.split(' ');
    for (const point of points) {
      const [, y] = point.split(',').map(Number);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(30);
    }
  });

  // ── Real event data path (scoreHistory provided) ─────────────────────────

  it('renders the empty state with "No history yet" when scoreHistory is an empty array', () => {
    render(
      <ScoreHistoryChart
        currentScore={100}
        totalPayments={0}
        successfulPayments={0}
        failedPayments={0}
        scoreHistory={[]}
      />
    );

    expect(screen.getByText('Score History')).toBeInTheDocument();
    expect(screen.getByText(EMPTY_HISTORY_COPY)).toBeInTheDocument();

    // No sparkline should be drawn
    expect(document.querySelector('polyline')).toBeNull();
  });

  it('renders a clean chart without "estimated" when scoreHistory has events', () => {
    const events: ScoreEvent[] = [
      { timestamp: 1700000000, score: 100 },
      { timestamp: 1700001000, score: 110 },
      { timestamp: 1700002000, score: 120 },
    ];

    render(
      <ScoreHistoryChart
        currentScore={120}
        totalPayments={2}
        successfulPayments={2}
        failedPayments={0}
        scoreHistory={events}
      />
    );

    // Unambiguous "Score History" label, no "estimated" qualifier
    expect(screen.getByText('Score History')).toBeInTheDocument();
    expect(screen.queryByText('Score History (estimated)')).toBeNull();

    const polyline = document.querySelector('polyline');
    expect(polyline).toBeInTheDocument();

    // Real-data line must be fully opaque (not the 40% opacity used for synthetic)
    // SVG className is an SVGAnimatedString in jsdom — use getAttribute instead
    expect(polyline?.getAttribute('class')).not.toContain('opacity-40');
    expect(polyline?.getAttribute('class')).toContain('opacity-80');

    const circle = document.querySelector('circle');
    expect(circle).toBeInTheDocument();
  });

  it('places the terminal dot at the correct y coordinate for real events', () => {
    const events: ScoreEvent[] = [
      { timestamp: 1700000000, score: 500 },
      { timestamp: 1700001000, score: 1000 },
    ];

    render(
      <ScoreHistoryChart
        currentScore={1000}
        totalPayments={1}
        successfulPayments={1}
        failedPayments={0}
        scoreHistory={events}
      />
    );

    const circle = document.querySelector('circle');
    // score=1000, HEIGHT=30 → y = 30 - (1000/1000)*30 = 0
    expect(circle?.getAttribute('cy')).toBe('0');
  });
});

// ── Sparse states (#856) ───────────────────────────────────────────────────
//
// A newly registered agent has zero or one data point, and this chart is one of
// the first things it sees. Both states must render deliberately rather than
// degenerately, and must say why the chart is sparse.

describe('ScoreHistoryChart — sparse states (#856)', () => {
  describe('zero points', () => {
    it('explains why there is no history rather than drawing an empty axis', () => {
      render(
        <ScoreHistoryChart
          currentScore={500}
          totalPayments={0}
          successfulPayments={0}
          failedPayments={0}
          scoreHistory={[]}
        />
      );

      expect(screen.getByTestId('score-history-empty')).toBeInTheDocument();
      expect(screen.getByText(EMPTY_HISTORY_COPY)).toBeInTheDocument();
      expect(screen.queryByTestId('score-history-line')).not.toBeInTheDocument();
    });

    it('draws no polyline, so a flat line cannot be mistaken for a static score', () => {
      const { container } = render(
        <ScoreHistoryChart
          currentScore={500}
          totalPayments={0}
          successfulPayments={0}
          failedPayments={0}
          scoreHistory={[]}
        />
      );

      expect(container.querySelector('polyline')).toBeNull();
      expect(container.querySelector('circle')).toBeNull();
    });
  });

  describe('single point', () => {
    const oneEvent: ScoreEvent[] = [{ timestamp: 1_756_000_000, score: 500 }];

    it('renders the point itself instead of an invisible one-point line', () => {
      const { container } = render(
        <ScoreHistoryChart
          currentScore={500}
          totalPayments={1}
          successfulPayments={1}
          failedPayments={0}
          scoreHistory={oneEvent}
        />
      );

      expect(screen.getByTestId('score-history-single')).toBeInTheDocument();
      // A polyline of one point draws nothing at all — the marker carries the value.
      expect(container.querySelector('polyline')).toBeNull();
      expect(container.querySelector('circle')).not.toBeNull();
    });

    it('places the marker at the point\'s own value, not at the right-hand edge', () => {
      const { container } = render(
        <ScoreHistoryChart
          currentScore={500}
          totalPayments={1}
          successfulPayments={1}
          failedPayments={0}
          scoreHistory={oneEvent}
        />
      );

      const circle = container.querySelector('circle')!;
      // Previously the end marker was pinned to cx=120 regardless of the data.
      expect(Number(circle.getAttribute('cx'))).toBe(60);
      // score 500 of 1000 over a 30px height → y = 15.
      expect(Number(circle.getAttribute('cy'))).toBeCloseTo(15, 5);
    });

    it('explains that a trend line needs another transaction', () => {
      render(
        <ScoreHistoryChart
          currentScore={500}
          totalPayments={1}
          successfulPayments={1}
          failedPayments={0}
          scoreHistory={oneEvent}
        />
      );

      expect(screen.getByText(SINGLE_POINT_COPY)).toBeInTheDocument();
    });

    it('gives the lone point an accessible description', () => {
      render(
        <ScoreHistoryChart
          currentScore={500}
          totalPayments={1}
          successfulPayments={1}
          failedPayments={0}
          scoreHistory={oneEvent}
        />
      );

      expect(screen.getByLabelText(/single data point at 500/i)).toBeInTheDocument();
    });

    it('clamps an out-of-range score into the plot area', () => {
      const { container } = render(
        <ScoreHistoryChart
          currentScore={0}
          totalPayments={1}
          successfulPayments={0}
          failedPayments={1}
          scoreHistory={[{ timestamp: 1, score: 5000 }]}
        />
      );

      const cy = Number(container.querySelector('circle')!.getAttribute('cy'));
      expect(cy).toBeGreaterThanOrEqual(0);
      expect(cy).toBeLessThanOrEqual(30);
    });
  });

  describe('two or more points', () => {
    it('still renders a line', () => {
      const { container } = render(
        <ScoreHistoryChart
          currentScore={520}
          totalPayments={2}
          successfulPayments={2}
          failedPayments={0}
          scoreHistory={[
            { timestamp: 1, score: 500 },
            { timestamp: 2, score: 520 },
          ]}
        />
      );

      expect(screen.getByTestId('score-history-line')).toBeInTheDocument();
      expect(container.querySelector('polyline')).not.toBeNull();
      expect(screen.queryByText(SINGLE_POINT_COPY)).not.toBeInTheDocument();
    });
  });
});
