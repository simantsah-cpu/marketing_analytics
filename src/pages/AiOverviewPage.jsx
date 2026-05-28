/**
 * AiOverviewPage.jsx — Standalone page for AI Overview Intelligence.
 * Route: /ai-overview
 * Listed under LLM Intelligence in the sidebar.
 *
 * Layout follows the same page-content / kpi-row pattern as ExecutiveSummary
 * so zoom in/out works correctly at all browser zoom levels.
 *
 * Default date: Last 90 days (all other dashboards default to Last 30 days).
 * The preset is set on mount and restored on unmount so navigating away
 * doesn't leave other dashboards stuck on 90 days.
 */
import { useEffect } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, Title, Tooltip, Legend, Filler, ArcElement,
  BubbleController, DoughnutController,
} from 'chart.js'
import { useFilters } from '../context/FiltersContext'
import { useProperty } from '../context/PropertyContext'
import AiOverviewSection from '../components/aiOverview/AiOverviewSection'
import DateRangePill from '../components/DateRangePill'

// Register Chart.js globally for sub-components using window.Chart
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler, ArcElement, BubbleController, DoughnutController)
if (typeof window !== 'undefined') window.Chart = ChartJS

export default function AiOverviewPage() {
  const { filters, actions } = useFilters()
  const { selectedProperty } = useProperty()

  // ── Override preset to last90d for this page, restore last30d on leave ──────
  useEffect(() => {
    actions.setPreset('last90d')
    return () => { actions.setPreset('last30d') }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const compLabel =
    filters.comparison === 'prevYear'   ? 'vs Last Year'   :
    filters.comparison === 'prevPeriod' ? 'vs Prev Period' :
    'Off'

  return (
    <div className="page-content fade-in">

      {/* Date range context pill */}
      <DateRangePill dateRanges={filters.dateRanges} comparison={filters.comparison} />

      {/* ── Main section ── */}
      <AiOverviewSection
        dateRange={filters.dateRanges?.primary}
        comparisonMode={compLabel}
        comparisonDateRange={filters.dateRanges?.comparison ?? null}
        deviceFilter={null}
        propertyId={selectedProperty?.ga4_property_id}
        onDataLoaded={null}
      />
    </div>
  )
}
