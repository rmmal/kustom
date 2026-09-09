import type { CSSProperties } from 'react';
import { chartGeometry } from '@/lib/board/chart';
import { CHART_TITLE, gamesLabel, SEED_LABEL } from '@/lib/board/copy';

/**
 * The rating history chart (`05-design.md`, "Rating history").
 *
 * One `<svg>`, rendered on the server, no charting library: a single 1.5px `accent` line, no
 * fill, no points, no grid, no tooltip, 140px tall. The geometry is `lib/board/chart.ts`; this
 * file is the markup and the accessible name.
 *
 * **The series is `Rating`**, titled with the same word line 2 of a leaderboard row uses, and
 * the reference line is the seed **in those same units**. The player's Proven number is not
 * plotted at all — it moves with sigma, so a new player's Proven line climbs while their skill
 * estimate is flat, and a 140px chart has nowhere to say "that is your uncertainty".
 *
 * The box stretches to the column and the strokes do not: `preserveAspectRatio="none"` scales
 * the plot to whatever width the phone has, and `vector-effect: non-scaling-stroke` keeps the
 * line 1.5px through it. The `seed` label is HTML positioned beside the line rather than an
 * SVG `<text>`, which that same stretch would smear.
 */

export interface RatingChartProps {
  /** `displayRating(mu)` in `started_at` order, oldest first. */
  history: readonly number[];
  /** `round(seedMu * 60)`. Never the seed's ordinal: one unit on one chart. */
  seed: number;
}

export function RatingChart({ history, seed }: RatingChartProps) {
  const geometry = chartGeometry(history, seed);
  if (geometry === null) return null;

  const first = history[0] as number;
  const last = history[history.length - 1] as number;

  /**
   * **How many games this line is, not how many points it has** (the designer's M3.5 review).
   * The series is the rating carried *into* the first game and then the rating carried out of
   * every game since, so a player with one game has two points — and the old label read
   * `Rating from 1392 to 1434`, which says nothing about how much play is behind the shape. A
   * one-game chart now says `Rating over 1 game, …`, and `gamesLabel` is the same function the
   * record beside it uses, so the two counts are spelled the same way.
   */
  const plotted = Math.max(1, history.length - 1);
  const label = `${CHART_TITLE} over ${gamesLabel(plotted)}, from ${first} to ${last}, ${SEED_LABEL} ${seed}.`;

  return (
    <figure className="cn-chart">
      <figcaption className="cn-chart-title">{CHART_TITLE}</figcaption>
      <div className="cn-chart-plot">
        <svg
          className="cn-chart-svg"
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={label}
        >
          <title>{label}</title>
          <line
            className="cn-chart-seed"
            x1={0}
            x2={geometry.width}
            y1={geometry.seedY}
            y2={geometry.seedY}
            vectorEffect="non-scaling-stroke"
          />
          <path className="cn-chart-line" d={geometry.path} fill="none" vectorEffect="non-scaling-stroke" />
        </svg>
        {/*
         * The position goes in as a custom property so the stylesheet can clamp it inside the
         * plot: a reference line at the very top of the range must not put its label over the
         * chart's title.
         */}
        <span
          className="cn-num cn-chart-seed-label"
          style={{ '--cn-seed-pos': `${geometry.seedPercent}%` } as CSSProperties}
        >
          {SEED_LABEL}
        </span>
      </div>
    </figure>
  );
}
