// Profitability charts (Chart.js). Options are set per chart — never on Chart.defaults —
// so other Orbit pages are unaffected. The datalabels plugin that Leadership registers
// globally is switched off here; bar end labels come from the local endLabels plugin.
import {
  Chart as ChartJS, BarController, LineController, BubbleController, BarElement, LineElement, PointElement,
  CategoryScale, LinearScale, LogarithmicScale, Tooltip, Legend, Filler,
} from 'chart.js'
import { Chart } from 'react-chartjs-2'
import { moneyTick, barLabel, tooltipMoney, signedMoney } from './format.js'
import { MARGIN_COLOR, GAIN_COLOR, FALL_COLOR } from './model.js'

ChartJS.register(BarController, LineController, BubbleController, BarElement, LineElement, PointElement,
  CategoryScale, LinearScale, LogarithmicScale, Tooltip, Legend, Filler)

const PRIMARY = '#2D5BA6'
const COMPARE_GREY = '#E0E0E0'
const MUTED = '#5F6B7A'

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif"
const TICK = '#666'
const GRID = '#E6E6E6'
const font = (size = 12, weight) => ({ family: FONT, size, ...(weight ? { weight } : {}) })

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
function merge(a, b) {
  const out = { ...a }
  for (const [k, v] of Object.entries(b ?? {})) out[k] = isObj(v) && isObj(a?.[k]) ? merge(a[k], v) : v
  return out
}

function baseOpts(extra) {
  return merge({
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      datalabels: { display: false },
      legend: {
        position: 'bottom',
        labels: { boxWidth: 12, boxHeight: 12, padding: 18, color: TICK, font: font(13) },
      },
      tooltip: {
        padding: 10, boxPadding: 4, backgroundColor: 'rgba(27,36,51,.92)',
        titleFont: font(12, '600'), bodyFont: font(12),
      },
    },
  }, extra)
}

const axis = (extra) => merge({ border: { display: false }, ticks: { color: TICK, font: font(12) } }, extra)

function hexToRgba(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

// Value labels at the end of horizontal bars (Orbit Leadership style).
const endLabels = (fmt) => ({
  id: 'pfEndLabels',
  afterDatasetsDraw(c) {
    const { ctx } = c
    ctx.save()
    ctx.font = `600 12px ${FONT}`
    ctx.fillStyle = '#333'
    ctx.textBaseline = 'middle'
    c.data.datasets.forEach((ds, di) => {
      const meta = c.getDatasetMeta(di)
      if (ds.type === 'line' || meta.hidden) return
      meta.data.forEach((el, i) => {
        const v = ds.data[i]
        if (v == null) return
        const neg = v < 0
        ctx.textAlign = neg ? 'right' : 'left'
        ctx.fillText(fmt(v), el.x + (neg ? -8 : 8), el.y)
      })
    })
    ctx.restore()
  },
})

// Widen the value axis so bold end labels (e.g. "-$266k") never run into the category
// labels or off the chart, at any panel width. Solves pad/(range + 2·pad) · areaWidth ≥ LABEL_PX.
const LABEL_PX = 64
const roomForEndLabels = (labels) => (scale) => {
  const longest = Math.max(0, ...labels.map((l) => String(l).length))
  const area = Math.max(160, scale.chart.width - (longest * 7.5 + 24))
  const range = (scale.max - scale.min) || 1
  const pad = (range * LABEL_PX) / Math.max(area - 2 * LABEL_PX, 40)
  if (scale.min < 0) scale.min -= pad
  if (scale.max > 0) scale.max += pad
}

// Round-number ticks through $0 inside the padded bounds (about five steps).
function roundTicks(scale) {
  const raw = (scale.max - scale.min) / 5
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw)
  const ticks = []
  const snap = (v) => (step >= 1 ? Math.round(v) : Math.round(v / step) * step)
  for (let v = Math.ceil(scale.min / step) * step; v <= scale.max + step * 1e-9; v += step) ticks.push({ value: snap(v) })
  scale.ticks = ticks
}

/** Index of the clicked data point, or null. */
const clickedIndex = (chart, evt, mode, opts) => {
  const hit = chart.getElementsAtEventForMode(evt, mode, opts, true)[0]
  return hit ? hit.index : null
}

export function MonthlyProductChart({ model }) {
  const data = {
    labels: model.labels,
    datasets: [
      ...model.lines.map((l) => ({
        type: 'bar', label: l.name, data: l.data, stack: 'p', yAxisID: 'y',
        backgroundColor: model.current.map((cur) => (cur ? hexToRgba(l.color, 0.45) : l.color)),
        borderRadius: 0, maxBarThickness: 46,
      })),
      {
        type: 'line', label: 'Margin', data: model.marginPct, yAxisID: 'y1',
        borderColor: MARGIN_COLOR, backgroundColor: MARGIN_COLOR, borderWidth: 2, pointRadius: 3, tension: 0.3,
      },
    ],
  }
  const options = baseOpts({
    plugins: {
      tooltip: {
        callbacks: {
          label: (c) => (c.dataset.yAxisID === 'y1'
            ? `Margin ${c.raw == null ? '—' : c.raw.toFixed(1) + '%'}`
            : `${c.dataset.label} ${tooltipMoney(c.raw)}`),
        },
      },
    },
    scales: {
      x: axis({ stacked: true, grid: { display: false } }),
      y: axis({ stacked: true, grid: { color: GRID }, ticks: { callback: moneyTick } }),
      y1: axis({ position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: (v) => `${v}%` } }),
    },
  })
  return <div className="pf-ch tall"><Chart type="bar" data={data} options={options} /></div>
}

export function RegionTrendChart({ model }) {
  const data = {
    labels: model.labels,
    datasets: model.lines.map((l) => ({
      label: l.name, data: l.data, borderColor: l.color, backgroundColor: l.color,
      borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.35,
    })),
  }
  const options = baseOpts({
    plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label} ${tooltipMoney(c.raw)}` } } },
    scales: {
      y: axis({ grid: { color: GRID }, ticks: { callback: moneyTick } }),
      x: axis({ grid: { display: false } }),
    },
  })
  return <div className="pf-ch"><Chart type="line" data={data} options={options} /></div>
}

/** Biggest changes in profit. onSelect(row), when given, makes the bars clickable. */
export function MoversChart({ rows, onSelect }) {
  const data = {
    labels: rows.map((r) => (r.name.length > 34 ? r.name.slice(0, 33) + '…' : r.name)),
    datasets: [{
      label: 'Change in profit', data: rows.map((r) => r.change / 100),
      backgroundColor: rows.map((r) => (r.change < 0 ? FALL_COLOR : GAIN_COLOR)),
      borderRadius: 0, maxBarThickness: 18,
    }],
  }
  const options = baseOpts({
    indexAxis: 'y',
    interaction: { mode: 'nearest', axis: 'y', intersect: true },
    ...(onSelect ? {
      onClick: (evt, _els, chart) => {
        const i = clickedIndex(chart, evt, 'index', { axis: 'y', intersect: false })
        if (i != null) onSelect(rows[i])
      },
      onHover: (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default' },
    } : {}),
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (c) => rows[c[0].dataIndex].name,
          label: (c) => {
            const r = rows[c.dataIndex]
            return [`Change in profit ${signedMoney(r.change)}`,
              `This year ${tooltipMoney(r.cc_profit / 100)}`, `Last year ${tooltipMoney(r.cp_profit / 100)}`]
          },
        },
      },
    },
    scales: {
      x: axis({ grid: { color: GRID }, bounds: 'data', ticks: { callback: moneyTick }, afterDataLimits: roomForEndLabels(data.labels), afterBuildTicks: roundTicks }),
      y: axis({ grid: { display: false }, ticks: { autoSkip: false, color: '#333', font: font(13) } }),
    },
  })
  return <div className="pf-ch"><Chart type="bar" data={data} options={options} plugins={[endLabels(barLabel)]} /></div>
}

// ── Countries page ───────────────────────────────────────────────────────────


/**
 * Top 15 bars (Countries, Cities): blue period/comparison bars with a grey same-months-last-year
 * bar under each. onSelect receives the clicked bar's index into model.rows.
 */
export function Top15Chart({ model, onSelect, maxLabel = 34, size = 'xl' }) {
  const data = {
    labels: model.labels.map((l) => (l.length > maxLabel ? l.slice(0, maxLabel - 1) + '…' : l)),
    datasets: model.datasets.map((ds) => ({
      label: ds.label, data: ds.values,
      backgroundColor: ds.key === 'cp' ? COMPARE_GREY : ds.values.map((v) => (v < 0 ? FALL_COLOR : PRIMARY)),
      borderRadius: 0, maxBarThickness: 18, categoryPercentage: 0.8, barPercentage: 0.9,
    })),
  }
  const options = baseOpts({
    indexAxis: 'y',
    interaction: { mode: 'index', axis: 'y', intersect: false },
    onClick: (evt, _els, chart) => {
      const i = clickedIndex(chart, evt, 'index', { axis: 'y', intersect: false })
      if (i != null) onSelect(i)
    },
    onHover: (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default' },
    plugins: {
      // One tooltip per country: "Total Profit …", "Same months last year …", "Change …".
      tooltip: {
        filter: (item) => item.datasetIndex === 0, displayColors: false,
        callbacks: { title: (c) => (model.titles ?? model.labels)[c[0].dataIndex], label: (c) => model.tooltip(c.dataIndex) },
      },
    },
    scales: {
      x: axis({ grid: { color: GRID }, bounds: 'data', ticks: { callback: moneyTick }, afterDataLimits: roomForEndLabels(data.labels), afterBuildTicks: roundTicks }),
      y: axis({ grid: { display: false }, ticks: { autoSkip: false, color: '#333', font: font(13) } }),
    },
  })
  return <div className={`pf-ch ${size}`}><Chart type="bar" data={data} options={options} plugins={[endLabels(barLabel)]} /></div>
}

const isPow10 = (v) => { const l = Math.log10(v); return Math.abs(l - Math.round(l)) < 1e-9 }

// Dashed median guides with corner captions for the size-vs-margin chart.
const quadrants = (mx, my) => ({
  id: 'pfQuadrants',
  afterDraw(c) {
    if (mx == null || my == null) return
    const { ctx, chartArea: a, scales: { x, y } } = c
    ctx.save()
    ctx.strokeStyle = MUTED; ctx.lineWidth = 1; ctx.setLineDash([4, 4])
    const px = x.getPixelForValue(mx), py = y.getPixelForValue(my)
    if (px > a.left && px < a.right) { ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke() }
    if (py > a.top && py < a.bottom) { ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke() }
    ctx.setLineDash([])
    ctx.fillStyle = MUTED; ctx.font = `12px ${FONT}`
    ctx.textAlign = 'right'
    ctx.fillText('Large and high margin', a.right - 6, a.top + 14)
    ctx.fillText('Large and low margin', a.right - 6, a.bottom - 8)
    ctx.textAlign = 'left'
    ctx.fillText('Small and high margin', a.left + 6, a.top + 14)
    ctx.fillText('Small and low margin', a.left + 6, a.bottom - 8)
    ctx.restore()
  },
})

export function BubbleChart({ model, onSelect }) {
  const pts = model.points
  const data = {
    datasets: [{
      label: 'Countries',
      data: pts.map((p) => ({ x: p.x, y: p.y, r: p.r })),
      backgroundColor: pts.map((p) => hexToRgba(p.color, 0.55)),
      borderColor: pts.map((p) => p.color), borderWidth: 1,
    }],
  }
  const options = baseOpts({
    interaction: { mode: 'nearest', intersect: true },
    onClick: (evt, _els, chart) => {
      const i = clickedIndex(chart, evt, 'nearest', { intersect: true })
      if (i != null) onSelect(pts[i].country)
    },
    onHover: (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default' },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { title: (c) => pts[c[0].dataIndex].country, label: (c) => pts[c.dataIndex].tooltip } },
    },
    scales: {
      x: axis({
        type: 'logarithmic', grid: { color: GRID },
        title: { display: true, text: 'Revenue (log scale)', color: TICK, font: font(12) },
        ticks: { callback: (v) => (isPow10(v) ? moneyTick(v) : ''), autoSkip: false, maxRotation: 0 },
      }),
      y: axis({
        grid: { color: GRID },
        title: { display: true, text: 'Margin', color: TICK, font: font(12) },
        ticks: { callback: (v) => `${v}%` },
      }),
    },
  })
  return (
    <>
      <div className="pf-ch xl"><Chart type="bubble" data={data} options={options} plugins={[quadrants(model.medianX, model.medianY)]} /></div>
      <div className="pf-legend">
        {model.legend.map((l) => <span key={l.name}><i style={{ background: l.color }} />{l.name}</span>)}
        <span className="pf-legend-note">Bubble size = trips. Dashed lines = median.</span>
      </div>
    </>
  )
}

/** Monthly trend (Countries, Cities): Revenue and Total Profit bars side by side + margin line. */
export function TrendChart({ model }) {
  const alpha = (hex, cur) => (cur ? hexToRgba(hex, 0.45) : hex)
  const data = {
    labels: model.labels,
    datasets: [
      {
        type: 'bar', label: 'Revenue', data: model.revenue, yAxisID: 'y', order: 2,
        backgroundColor: model.current.map((cur) => `rgba(45,91,166,${cur ? 0.18 * 0.45 : 0.18})`),
        borderRadius: 0, maxBarThickness: 28,
      },
      {
        type: 'bar', label: 'Total Profit', data: model.profit, yAxisID: 'y', order: 1,
        backgroundColor: model.profit.map((v, i) => alpha(v < 0 ? FALL_COLOR : PRIMARY, model.current[i])),
        borderRadius: 0, maxBarThickness: 28,
      },
      {
        type: 'line', label: 'Margin', data: model.marginPct, yAxisID: 'y1', order: 0,
        borderColor: MARGIN_COLOR, backgroundColor: MARGIN_COLOR, borderWidth: 2, pointRadius: 3, tension: 0.3,
      },
    ],
  }
  const options = baseOpts({
    plugins: {
      // Keep the legend and tooltip in dataset order (Revenue, Total Profit, Margin), not draw order.
      legend: { labels: { sort: (a, b) => a.datasetIndex - b.datasetIndex } },
      tooltip: {
        itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
        callbacks: {
          label: (c) => (c.dataset.yAxisID === 'y1'
            ? `Margin ${c.raw == null ? '—' : c.raw.toFixed(1) + '%'}`
            : `${c.dataset.label} ${tooltipMoney(c.raw)}`),
        },
      },
    },
    scales: {
      x: axis({ grid: { display: false } }),
      y: axis({ grid: { color: GRID }, ticks: { callback: moneyTick } }),
      y1: axis({ position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: (v) => `${v}%` } }),
    },
  })
  return <div className="pf-ch"><Chart type="bar" data={data} options={options} /></div>
}

// ── Cities page ──────────────────────────────────────────────────────────────

/** Lowest-margin cities: horizontal margin bars with 1-decimal % end labels. */
export function MarginBars({ model, onSelect, size = 'xl' }) {
  const data = {
    labels: model.labels.map((l) => (l.length > 34 ? l.slice(0, 33) + '…' : l)),
    datasets: [{
      label: 'Margin', data: model.values,
      backgroundColor: model.values.map((v) => (v < 0 ? FALL_COLOR : PRIMARY)),
      borderRadius: 0, maxBarThickness: 18, categoryPercentage: 0.8, barPercentage: 0.9,
    }],
  }
  const options = baseOpts({
    indexAxis: 'y',
    interaction: { mode: 'nearest', axis: 'y', intersect: true },
    onClick: (evt, _els, chart) => {
      const i = clickedIndex(chart, evt, 'index', { axis: 'y', intersect: false })
      if (i != null) onSelect(i)
    },
    onHover: (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default' },
    plugins: {
      legend: { display: false },
      tooltip: { displayColors: false, callbacks: { title: (c) => model.labels[c[0].dataIndex], label: (c) => model.tooltip(c.dataIndex) } },
    },
    scales: {
      x: axis({ grid: { color: GRID }, bounds: 'data', ticks: { callback: (v) => `${v}%` }, afterDataLimits: roomForEndLabels(data.labels), afterBuildTicks: roundTicks }),
      y: axis({ grid: { display: false }, ticks: { autoSkip: false, color: '#333', font: font(13) } }),
    },
  })
  return <div className={`pf-ch ${size}`}><Chart type="bar" data={data} options={options} plugins={[endLabels((v) => `${v.toFixed(1)}%`)]} /></div>
}

// Dashed guides at x = N and y = 80% with the "{N} cities = 80% of profit" caption.
const eightyMarker = (n, label) => ({
  id: 'pfEighty',
  afterDatasetsDraw(c) {
    if (n == null) return
    const { ctx, chartArea: a, scales: { x, y } } = c
    const px = x.getPixelForValue(n), py = y.getPixelForValue(80)
    ctx.save()
    ctx.strokeStyle = MUTED; ctx.lineWidth = 1; ctx.setLineDash([4, 4])
    ctx.beginPath(); ctx.moveTo(px, a.bottom); ctx.lineTo(px, py); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(px, py); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = MUTED; ctx.font = `12px ${FONT}`
    const right = px + 8 + ctx.measureText(label).width < a.right
    ctx.textAlign = right ? 'left' : 'right'
    ctx.fillText(label, right ? px + 8 : px - 8, py + 16)
    ctx.restore()
  },
})

export function ParetoChart({ model }) {
  const data = {
    datasets: [{
      label: 'Cumulative share of Total Profit', data: model.points,
      borderColor: PRIMARY, backgroundColor: 'rgba(45,91,166,0.10)', fill: true,
      borderWidth: 2, pointRadius: model.pointRadius ?? 0, pointBackgroundColor: PRIMARY, pointHoverRadius: 3, tension: 0,
    }],
  }
  const options = baseOpts({
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        callbacks: { title: (c) => `Top ${c[0].raw.x} ${model.unit ?? 'cities'}`, label: (c) => `${c.raw.y.toFixed(2)}% of Total Profit` },
      },
    },
    scales: {
      x: axis({
        type: 'linear', min: 1, max: model.M, grid: { display: false },
        title: { display: true, text: `Number of ${model.unit ?? 'cities'}, highest profit first`, color: TICK, font: font(12) },
        ticks: { precision: 0 },
      }),
      y: axis({ min: model.yMin, max: model.yMax, grid: { color: GRID }, ticks: { callback: (v) => `${v}%` } }),
    },
  })
  return <div className="pf-ch"><Chart type="line" data={data} options={options} plugins={[eightyMarker(model.N, model.markerLabel)]} /></div>
}

// ── Routes page ──────────────────────────────────────────────────────────────

/** Route types: profit bars (left money axis) with margin diamonds (right % axis). */
export function RouteTypeCombo({ model }) {
  const data = {
    labels: model.labels,
    datasets: [
      {
        type: 'bar', label: 'Total Profit', data: model.profit, yAxisID: 'y', order: 1,
        backgroundColor: model.profit.map((v) => (v < 0 ? FALL_COLOR : PRIMARY)), borderRadius: 0, maxBarThickness: 46,
      },
      {
        type: 'line', label: 'Margin', data: model.marginPct, yAxisID: 'y1', order: 0, showLine: false,
        pointStyle: 'rectRot', pointRadius: 6, pointHoverRadius: 7, borderColor: MARGIN_COLOR, backgroundColor: MARGIN_COLOR,
      },
    ],
  }
  const options = baseOpts({
    plugins: {
      legend: { labels: { sort: (a, b) => a.datasetIndex - b.datasetIndex } },
      tooltip: {
        displayColors: false,
        filter: (item) => item.datasetIndex === 0,
        callbacks: { label: (c) => model.tooltip(c.dataIndex) },
      },
    },
    scales: {
      x: axis({ grid: { display: false }, ticks: { maxRotation: 0, autoSkip: false } }),
      y: axis({ grid: { color: GRID }, ticks: { callback: moneyTick } }),
      y1: axis({ position: 'right', grid: { display: false, drawOnChartArea: false }, ticks: { callback: (v) => `${v}%` } }),
    },
  })
  return <div className="pf-ch"><Chart type="bar" data={data} options={options} /></div>
}

/** Monthly Total Profit stacked by route type (stack order = model.lines order, bottom → top). */
export function RouteTypeMonthlyChart({ model }) {
  const data = {
    labels: model.labels,
    datasets: model.lines.map((l) => ({
      type: 'bar', label: l.name, data: l.data, stack: 'p',
      backgroundColor: model.current.map((cur) => (cur ? hexToRgba(l.color, 0.45) : l.color)),
      borderRadius: 0, maxBarThickness: 46,
    })),
  }
  const options = baseOpts({
    plugins: {
      legend: { labels: { sort: (a, b) => a.datasetIndex - b.datasetIndex } },
      tooltip: { itemSort: (a, b) => b.datasetIndex - a.datasetIndex, callbacks: { label: (c) => `${c.dataset.label} ${tooltipMoney(c.raw)}` } },
    },
    scales: {
      x: axis({ stacked: true, grid: { display: false } }),
      y: axis({ stacked: true, grid: { color: GRID }, ticks: { callback: moneyTick } }),
    },
  })
  return <div className="pf-ch"><Chart type="bar" data={data} options={options} /></div>
}

const BAND_ALPHA = [1, 0.45, 0.6, 0.75, 0.9]

/** Number of listed routes per margin band; the Loss band is red. */
export function MarginBandChart({ model }) {
  const data = {
    labels: model.bands.map((b) => b.name),
    datasets: [{
      label: 'Routes', data: model.bands.map((b) => b.n),
      backgroundColor: model.bands.map((_, i) => (i === 0 ? FALL_COLOR : hexToRgba(PRIMARY, BAND_ALPHA[i]))),
      borderRadius: 0, maxBarThickness: 46,
    }],
  }
  const options = baseOpts({
    plugins: {
      legend: { display: false },
      tooltip: { displayColors: false, callbacks: { label: (c) => model.tooltip(c.dataIndex) } },
    },
    scales: {
      x: axis({ grid: { display: false }, title: { display: true, text: 'Route margin', color: TICK, font: font(12) } }),
      y: axis({
        grid: { color: GRID }, beginAtZero: true, ticks: { precision: 0 },
        title: { display: true, text: 'Number of routes', color: TICK, font: font(12) },
      }),
    },
  })
  return <div className="pf-ch"><Chart type="bar" data={data} options={options} /></div>
}

// ── Customers page ───────────────────────────────────────────────────────────

/** Monthly Total Profit stacked: existing customers (bottom) and new customers (top). */
export function NewExistingChart({ model }) {
  const data = {
    labels: model.labels,
    datasets: model.lines.map((l) => ({
      type: 'bar', label: l.name, data: l.data, stack: 'p',
      backgroundColor: model.current.map((cur) => (cur ? hexToRgba(l.color, 0.45) : l.color)),
      borderRadius: 0, maxBarThickness: 46,
    })),
  }
  const options = baseOpts({
    plugins: {
      legend: { labels: { sort: (a, b) => a.datasetIndex - b.datasetIndex } },
      tooltip: {
        itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
        callbacks: {
          label: (c) => `${c.dataset.label} ${tooltipMoney(c.raw)}`,
          afterLabel: (c) => {
            const n = model.lines[c.datasetIndex].customers[c.dataIndex]
            return `${n.toLocaleString('en-US')} ${n === 1 ? 'customer' : 'customers'}`
          },
        },
      },
    },
    scales: {
      x: axis({ stacked: true, grid: { display: false } }),
      y: axis({ stacked: true, grid: { color: GRID }, ticks: { callback: moneyTick } }),
    },
  })
  return <div className="pf-ch"><Chart type="bar" data={data} options={options} /></div>
}
