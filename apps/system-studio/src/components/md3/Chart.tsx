import type { ReactNode } from "react"

import "./primitives.css"
import {
  DEFAULT_BOX,
  describeSeries,
  domainOf,
  niceTicks,
  scaleX,
  scaleY,
  seriesPath,
  type ChartSeries,
} from "./chart-model"

/**
 * A line chart that carries everything Bible §7.1 says a professional chart
 * carries, and refuses to draw when it has nothing to draw.
 *
 * §7.1, in its own words: *"Professional charts with units, time range, source,
 * freshness, filters, accessible tabular equivalents, and truthful zero/missing/
 * loading/error states."* Six of those are PROPS here rather than optional
 * decoration, because a cost line with no unit and no time range is a shape, and
 * a shape is what gets screenshotted into a review.
 *
 * ## The table is not an alternative view, it is part of the component
 *
 * STUDIO-030-009 requires a table or outline alternative for every visualisation.
 * It is rendered beneath the chart, always, inside a `<details>` so it does not
 * dominate the page — expandable by keyboard, present in the DOM, and copyable.
 * A chart with a "view as table" toggle behind client state is a chart whose
 * alternative disappears when the bundle fails to load.
 *
 * ## Missing is not zero
 *
 * A `null` reading breaks the line and is counted in the description ("3
 * readings missing"). Drawing a gap as zero is the charting version of
 * rendering an unknown read as an empty list, which STUDIO-000-007 forbids by
 * name.
 *
 * ## Series are told apart by more than colour
 *
 * Each series gets a dash pattern as well as a stroke role, and the legend
 * shows the same pattern. Four lines distinguished only by tint is unreadable
 * for roughly one man in twelve, and unreadable for everybody in a printed
 * change review.
 *
 * ## `role="img"` with a real description
 *
 * The SVG is one image with a name (the title) and a description assembled from
 * `describeSeries` — direction, endpoints, extremes, gaps. That sentence is
 * what a screen reader gets instead of the picture, and it is the same reading
 * a sighted operator takes from the shape.
 */

export interface ChartProps {
  /** What is being plotted. The accessible name. */
  title: string
  /** The unit, named — "USD per day", "requests per minute", "percent". */
  unit: string
  /** The window — "Last 30 days", "2026-07-01 to 2026-07-31 UTC". */
  timeRange: string
  /** Where the numbers came from — "Cost Explorer", "CloudWatch, 5-minute period". */
  source: string
  /** When it was read. A sentence: "Read 4 minutes ago". */
  freshness: ReactNode
  series: readonly ChartSeries[]
  /** How the x values should be shown in the table and axis — an epoch formatter. */
  formatX?: (x: number) => string
  /** Any filters in force, so the reading is reproducible. */
  filters?: string
  id?: string
}

const DASHES = ["0", "6 3", "2 3", "10 4"]

export function Chart({
  title,
  unit,
  timeRange,
  source,
  freshness,
  series,
  formatX = (x) => String(x),
  filters,
  id,
}: ChartProps) {
  const baseId = id ?? "chart"
  const titleId = `${baseId}-title`
  const descId = `${baseId}-desc`
  const domain = domainOf(series)
  const box = DEFAULT_BOX

  const meta = (
    <figcaption data-md3="chart-caption">
      <span id={titleId} className="md3-title-small">
        {title}
      </span>
      <span data-md3="chart-meta" className="md3-label-small">
        {unit} · {timeRange} · {source}
      </span>
      <span data-md3="chart-meta" className="md3-label-small">
        {freshness}
        {filters ? ` · ${filters}` : null}
      </span>
    </figcaption>
  )

  if (!domain) {
    // Truthful empty state: the difference between "nothing happened" and "we
    // have no readings" is the difference between a working system and a broken
    // pipeline, so it says which one this is.
    return (
      <figure data-md3="chart" id={id}>
        {meta}
        <p data-md3="chart-empty" className="md3-body-medium">
          No readings in this range. An empty chart is not the same as a zero
          reading, and none of the series returned a value.
        </p>
      </figure>
    )
  }

  const ticks = niceTicks(domain.minY, domain.maxY)
  const description = series.map((one) => describeSeries(one, unit)).join(" ")
  const columns = series[0]?.points.map((point) => point.x) ?? []

  return (
    <figure data-md3="chart" id={id}>
      {meta}
      <svg
        data-md3="chart-svg"
        viewBox={`0 0 ${box.width} ${box.height}`}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        preserveAspectRatio="none"
      >
        <desc id={descId}>{description}</desc>
        {ticks.map((tick) => {
          const y = scaleY(tick, domain, box)
          return (
            <g key={tick}>
              <line
                data-md3="chart-grid"
                x1={box.padLeft}
                x2={box.width - box.padRight}
                y1={y}
                y2={y}
              />
              <text data-md3="chart-tick" x={box.padLeft - 8} y={y + 4} textAnchor="end">
                {tick}
              </text>
            </g>
          )
        })}
        {series.map((one, index) => (
          <path
            key={one.key}
            data-md3="chart-series"
            data-series={index % DASHES.length}
            d={seriesPath(one.points, domain, box)}
            strokeDasharray={DASHES[index % DASHES.length]}
            fill="none"
          />
        ))}
        <line
          data-md3="chart-axis"
          x1={box.padLeft}
          x2={box.padLeft}
          y1={box.padTop}
          y2={box.height - box.padBottom}
        />
        <text
          data-md3="chart-tick"
          x={scaleX(domain.minX, domain, box)}
          y={box.height - 6}
          textAnchor="start"
        >
          {formatX(domain.minX)}
        </text>
        <text
          data-md3="chart-tick"
          x={scaleX(domain.maxX, domain, box)}
          y={box.height - 6}
          textAnchor="end"
        >
          {formatX(domain.maxX)}
        </text>
      </svg>
      <ul data-md3="chart-legend">
        {series.map((one, index) => (
          <li key={one.key} className="md3-label-small">
            <svg
              data-md3="chart-swatch"
              viewBox="0 0 24 8"
              aria-hidden="true"
              width="24"
              height="8"
            >
              <line
                data-md3="chart-series"
                data-series={index % DASHES.length}
                x1="0"
                x2="24"
                y1="4"
                y2="4"
                strokeDasharray={DASHES[index % DASHES.length]}
              />
            </svg>
            {one.label}
          </li>
        ))}
      </ul>
      <details data-md3="chart-table">
        <summary className="md3-label-medium">Read the numbers</summary>
        <div data-md3="chart-table-scroll" tabIndex={0} role="region" aria-labelledby={titleId}>
          <table className="md3-table md3-body-small">
            <caption>
              {title} — {unit}, {timeRange}
            </caption>
            <thead>
              <tr>
                <th scope="col">Point</th>
                {series.map((one) => (
                  <th key={one.key} scope="col">
                    {one.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {columns.map((x, row) => (
                <tr key={x}>
                  <th scope="row">{formatX(x)}</th>
                  {series.map((one) => {
                    const value = one.points[row]?.y
                    return (
                      <td key={one.key}>
                        {/* The word, not a blank cell. A blank reads as zero. */}
                        {value === null || value === undefined ? "no reading" : value}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
