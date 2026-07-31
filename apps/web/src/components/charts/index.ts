/**
 * Hand-rolled, dependency-free chart kit. Inline SVG only — the repo avoids
 * chart libraries on purpose (bundle size + a trivial CSP story), and this kit
 * extends that pattern with a shared hover/tooltip layer, the validated
 * --chart-N palette, and the mark specs from the design system.
 */
export { LineAreaChart, type LineSeries } from "./LineAreaChart"
export { BarChart, type BarSeries } from "./BarChart"
export { HBarChart, type HBarRow } from "./HBarChart"
export { DonutChart, type DonutDatum } from "./DonutChart"
export { SankeyChart, type SankeyNode, type SankeyLink } from "./SankeyChart"
export { Sparkline } from "./Sparkline"
export { Meter } from "./Meter"
export { LiveStats, type LiveStatItem } from "./LiveStats"
export { usePolling, useTimeAgo } from "./hooks"
export { ChartLegend, type LegendItem } from "./ChartLegend"
export { ChartEmpty } from "./ChartEmpty"
export { RangeFilter, type RangeOption } from "./RangeFilter"
export { ChartTooltip, TooltipHeader, TooltipRow } from "./ChartTooltip"
export { slotColor, CHART_SLOTS, STATUS, REFERENCE } from "./palette"
export { formatCompact, formatNumber, axisTicks, niceMax } from "./format"
