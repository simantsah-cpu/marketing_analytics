// Acceptance tests for Executive Summary (brief section 11).
// Fixtures are real BigQuery results for as_of = 2026-09-28 08:30 UTC, captured with
// scripts/profitability/acceptance-sql.ts. They run through the same payload and view-model
// code the edge function and page use, so the asserted strings are what the page renders.
import { assertEquals } from 'jsr:@std/assert@1'
import { executiveSummary, type Runner } from '../../supabase/functions/_shared/profitability/executiveSummary.ts'
import { toCents } from '../../supabase/functions/_shared/profitability/payload.ts'
import type { QueryName } from '../../supabase/functions/_shared/profitability/sql.ts'
import type { PeriodKey } from '../../supabase/functions/_shared/profitability/time.ts'
import {
  header, kpiRow1, kpiRow2, mtdPanel, breakdownTable, monthlyProductChart, monthlyRegionChart, moversChart,
  PRODUCT_LINE_COLORS, REGION_COLORS,
} from '../../src/pages/profitability/model.js'
import { tableMoney, pct, signedPct } from '../../src/pages/profitability/format.js'

const dir = new URL('../../supabase/functions/_shared/profitability/testdata/', import.meta.url)
const YTD = JSON.parse(await Deno.readTextFile(new URL('2026-09-28T08-30Z_ytd.json', dir)))
const OTHER = JSON.parse(await Deno.readTextFile(new URL('2026-09-28T08-30Z_other_periods.json', dir)))
const AS_OF = Date.parse('2026-09-28T08:30:00Z')

/** Replays captured results; queries that only depend on as_of are shared across periods. */
function fixtureRunner(period: PeriodKey): Runner {
  return async (name: QueryName) => {
    if (name === 'mtd_same_days') return YTD.mtd_same_days
    if (period === 'ytd') return YTD[name]
    if (name === 'kpi_totals') return [OTHER.kpi_totals_by_period[period]]
    if (period === 'mtd') return OTHER.mtd[name]
    if (period === 'complete' && name.startsWith('movers')) return YTD[name] // same cc/cp windows as YTD
    return [] // not captured for this period
  }
}
const load = async (period: PeriodKey) => (await executiveSummary(period, AS_OF, fixtureRunner(period), () => {})).data
const cells = (cards: any[]) => cards.map((c) => [c.label, c.value, c.sub, c.delta?.text ?? null])

Deno.test('11.1 company totals by window, to the cent', async () => {
  const ytd = await load('ytd'), ly = await load('last_year'), mtd = await load('mtd'), since = await load('since2025')
  const t = (x: any) => [x.revenue, x.cost, x.revenue - x.cost, x.trips]
  assertEquals(t(ly.kpi.cp), [4178988344, 3203577173, 975411171, 1060422])      // Jan–Dec 2024
  assertEquals(t(ly.kpi.p), [6337792976, 4949391014, 1388401962, 1830099])      // Jan–Dec 2025
  assertEquals(t(ytd.kpi.cp), [4041283908, 3170218756, 871065152, 1078367])     // Jan–Aug 2025
  assertEquals(t(ytd.kpi.cc), [4811871191, 3700551252, 1111319939, 1885101])    // Jan–Aug 2026
  assertEquals(t(mtd.kpi.p), [621092368, 476040108, 145052260, 233327])         // 1–28 Sep 2026
  // All since 2024-01-01 = 2024 + since Jan 2025
  assertEquals(ly.kpi.cp.revenue + since.kpi.p.revenue, 15949744879)
  assertEquals(ly.kpi.cp.cost + since.kpi.p.cost, 12329559547)
  assertEquals(ly.kpi.cp.trips + since.kpi.p.trips, 5008949)
  assertEquals(ytd.warehouse_loaded_at, '2026-09-28T08:14:11Z')
})

Deno.test('11.2 Year to date cards', async () => {
  const d = await load('ytd')
  assertEquals(d.kpi.p.revenue - d.kpi.p.cost, 1256372199) // $12,563,721.99
  assertEquals(d.kpi.p.revenue, 5432963559)
  const sfx = 'vs Jan–Aug 2025 (complete months)'
  assertEquals(cells(kpiRow1(d)), [
    ['Total Profit', '$12.56M', 'Complete revenue $54.33M', '+27.6%'],
    ['Revenue', '$54.33M', 'Cost $41.77M', '+19.1%'],
    ['Profit margin', '23.1%', 'Profit ÷ revenue', '+1.5 pts'],
    ['Trips', '2,118,428', 'Completed trips', '+74.8%'],
    ['Profit per trip', '$5.93', 'Profit ÷ trips', '-27.0%'],
  ])
  assertEquals(kpiRow1(d).map((c) => c.delta.suffix), Array(5).fill(sfx))
  assertEquals(kpiRow1(d).map((c) => c.delta.tone), ['up', 'up', 'up', 'up', 'down'])
  assertEquals(kpiRow2(d).map((c) => [c.label, c.value, c.tone, c.sub]), [
    ['Total Profit vs last year', '+$2,402,548', 'up', '27.6% · LY $8.71M'],
    ['Revenue vs last year', '+$7,705,873', 'up', '19.1% · LY $40.41M'],
    ['Trips vs last year', '+806,734', 'up', '74.8% · LY 1,078,367'],
    ['Profit per trip vs last year', '$-2.18', 'down', '-27.0% · LY $8.08'],
  ])
  assertEquals(header(d), {
    title: 'Executive Summary',
    badge: 'Data as of 2026-09-28',
    badgeTooltip: 'Pinned 2026-09-28 08:30 UTC · warehouse load 2026-09-28 08:14 UTC',
    subtitle: '2026 to date profit, revenue and margin, vs Jan–Aug 2025 (complete months).',
    sectionLabel: '2026 TO DATE — PROFIT, REVENUE AND MARGIN',
  })
})

Deno.test('11.2 Complete months this year', async () => {
  const d = await load('complete')
  assertEquals(kpiRow1(d).map((c) => c.value), ['$11.11M', '$48.12M', '23.1%', '1,885,101', '$5.90'])
  assertEquals(kpiRow1(d).map((c) => c.delta.text), ['+27.6%', '+19.1%', '+1.5 pts', '+74.8%', '-27.0%'])
  assertEquals(kpiRow1(d)[0].delta.suffix, 'vs Jan–Aug 2025')
})

Deno.test('11.2 Month to date', async () => {
  const d = await load('mtd')
  assertEquals(kpiRow1(d).map((c) => c.value), ['$1.45M', '$6.21M', '23.4%', '233,327', '$6.22'])
  assertEquals(kpiRow1(d).every((c) => c.delta === null), true)
  assertEquals(kpiRow2(d).map((c) => [c.label, c.value, c.sub]), [
    ['Total Profit vs last month MTD', '+$27,645', '2.0% · LM $1.41M'],
    ['Revenue vs last month MTD', '+$18,450', '0.3% · LM $6.12M'],
    ['Total Profit vs last year MTD', '+$121,471', '9.3% · LY $1.31M'],
    ['Trips vs last year MTD', '+82,528', '56.0% · LY 147,316'],
  ])
  assertEquals(header(d).subtitle, 'September 2026 to date profit, revenue and margin.')
})

Deno.test('11.2 Last year and Since Jan 2025', async () => {
  const ly = await load('last_year')
  const r1 = kpiRow1(ly)
  assertEquals([r1[0].value, r1[2].value, r1[3].value, r1[4].value], ['$13.88M', '21.9%', '1,830,099', '$7.59'])
  assertEquals(r1[0].delta.text, '+42.3%')
  assertEquals(kpiRow2(ly)[0].value, '+$4,129,908')
  assertEquals(r1[0].delta.suffix, 'vs full year 2024')

  const s = await load('since2025')
  assertEquals(s.kpi.p.revenue, 11770756535)
  assertEquals(s.kpi.p.cost, 9125982374)
  assertEquals(s.kpi.p.revenue - s.kpi.p.cost, 2644774161)
  assertEquals(kpiRow1(s).map((c) => c.value).slice(0, 4), ['$26.45M', '$117.71M', '22.5%', '3,948,527'])
  assertEquals(kpiRow2(s), [])
  assertEquals(moversChart(s, 'country').empty, 'Choose a period with complete months that also exist last year.')
})

Deno.test('11.3 This month so far (1–27 complete days)', async () => {
  const d = await load('ytd')
  const w = Object.fromEntries(d.mtd.rows.map((r: any) => [r.win, r]))
  const t = (x: any) => [x.label, x.revenue, x.cost, x.revenue - x.cost, x.trips]
  assertEquals(t(w.this_month), ['1–27 Sep 2026', 613518360, 470253455, 143264905, 229844])
  assertEquals(t(w.last_month), ['1–27 Aug 2026', 611673345, 471172919, 140500426, 199180])
  assertEquals(t(w.same_month_last_year), ['1–27 Sep 2025', 567380590, 436262792, 131117798, 147316])
  const panel = mtdPanel(d)
  assertEquals(panel.subtitle, 'Same 27 complete days compared')
  assertEquals(panel.note, 'Same 27 complete days in each month, all product lines.')
  assertEquals(panel.rows.map((r: any) => r.margin), ['23.4%', '23.0%', '23.1%'])
  assertEquals(panel.rows[1].vs!.profit.text, '+2.0%')
  assertEquals(panel.rows[1].vs!.margin.text, '+0.4 pts')
  assertEquals(panel.rows[2].vs!.trips.text, '+56.0%')
  // Changing the period never changes this panel.
  for (const p of ['complete', 'mtd', 'last_year', 'since2025'] as PeriodKey[]) {
    assertEquals(mtdPanel(await load(p)), panel)
  }
})

Deno.test('11.4 product line and region tables', async () => {
  const d = await load('ytd')
  const pl = breakdownTable(d, d.by_pl, { colors: PRODUCT_LINE_COLORS })
  assertEquals(pl.rows.map((r: any) => [r.name, r.trips, r.revenue, r.cost, r.profit, pct(r.margin), signedPct(r.yoy).text]), [
    ['Private Transfer', 1381489, 5094418674, 3892053454, 1202365220, '23.6%', '+23.2%'],
    ['Shared Shuttle', 47915, 137794081, 92371028, 45423053, '33.0%', '+639.4%'],
    ['Ride Hailing', 689020, 200743310, 192159908, 8583402, '4.3%', '+658.6%'],
    ['Rail', 4, 7494, 6970, 524, '7.0%', '-97.1%'],
  ])
  assertEquals([tableMoney(pl.total.profit), pct(pl.total.margin), pct(pl.total.share), signedPct(pl.total.yoy).text],
    ['$12,563,722', '23.1%', '100.0%', '+27.6%'])
  assertEquals(pl.rows.map((r: any) => pct(r.share)), ['95.7%', '3.6%', '0.7%', '0.0%'])

  const rg = breakdownTable(d, d.by_region, { colors: REGION_COLORS, marginVsLy: true })
  assertEquals(rg.rows.map((r: any) => [r.name, r.trips, r.revenue, r.cost, r.profit, signedPct(r.yoy).text]), [
    ['Rest of Asia, Africa & Oceania', 439153, 1309810962, 985154622, 324656340, '+39.5%'],
    ['America & LATAM', 337810, 1420641993, 1101610955, 319031038, '+9.8%'],
    ['Europe', 197792, 1224971683, 919018371, 305953312, '+36.7%'],
    ['Southeast Asia & Rest of Italy', 1003102, 887735540, 721527894, 166207646, '+33.8%'],
    ['Turkey & others', 139799, 587986049, 447722990, 140263059, '+24.6%'],
    ['Unmapped', 772, 1817332, 1556528, 260804, '-36.4%'],
  ])
  assertEquals(rg.rows.map((r: any) => (r.mpts * 100).toFixed(1)), ['1.0', '0.6', '6.5', '-4.6', '2.0', '3.5'])
  assertEquals(rg.showMarginVsLy, true)
})

Deno.test('11.5 monthly series and movers', async () => {
  const d = await load('ytd')
  const byMonth = new Map<string, number[]>()
  for (const r of d.monthly_pl) {
    const a = byMonth.get(r.month) ?? [0, 0, 0]
    byMonth.set(r.month, [a[0] + r.revenue, a[1] + r.cost, a[2] + r.trips])
  }
  assertEquals([...byMonth.entries()].map(([m, [r, c, n]]) => [m.slice(0, 7), r, c, r - c, n]), [
    ['2026-01', 485211612, 375237962, 109973650, 240474],
    ['2026-02', 530156040, 412236643, 117919397, 363525],
    ['2026-03', 546521546, 420689207, 125832339, 234167],
    ['2026-04', 599924160, 460556642, 139367518, 220255],
    ['2026-05', 657866470, 504566156, 153300314, 212518],
    ['2026-06', 621009841, 473412473, 147597368, 176553],
    ['2026-07', 672141393, 515971726, 156169667, 211965],
    ['2026-08', 699040129, 537880443, 161159686, 225644],
    ['2026-09', 621092368, 476040108, 145052260, 233327],
  ])
  const chart = monthlyProductChart(d)
  assertEquals(chart.labels.at(-1), "Sep '26 (to date)")
  assertEquals(chart.labels[0], "Jan '26")
  assertEquals(chart.lines.map((l: any) => l.name), ['Private Transfer', 'Ride Hailing', 'Shared Shuttle', 'Rail'])
  assertEquals(chart.marginPct.map((m: number | null) => m!.toFixed(2)), ['22.67', '22.24', '23.02', '23.23', '23.30', '23.77', '23.23', '23.05', '23.35'])
  assertEquals(chart.subtitle, 'Stacked profit with margin line. Lighter bars: September 2026 to date.')
  assertEquals(monthlyRegionChart(d).lines.map((l: any) => l.name).includes('Unmapped'), false)

  const mc = moversChart(d, 'country')
  assertEquals(mc.subtitle, 'Change in profit, Jan–Aug 2026 vs Jan–Aug 2025.')
  assertEquals(mc.rows.slice(0, 8).map((r: any) => [r.name, Math.round(r.change / 100)]), [
    ['Spain', 675105], ['Italy', 271844], ['Egypt', 250224], ['Mexico', 169763],
    ['Australia', 152526], ['United Kingdom', 130538], ['Turkey', 104108], ['Malaysia', 98194],
  ])
  // Falls: largest last. Brief lists falls among the top-50 countries; the full query also
  // surfaces smaller countries (Qatar, Mauritius, …), which the brief allows.
  const falls = mc.rows.slice(8).map((r: any) => [r.name, Math.round(r.change / 100)])
  assertEquals(falls.at(-1), ['United States', -159804])
  assertEquals(falls.at(-2), ['France', -105245])
  assertEquals(falls.at(-3), ['United Arab Emirates', -93194])
  assertEquals(falls.find((f: any) => f[0] === 'Indonesia'), ['Indonesia', -13277])

  const cu = moversChart(d, 'customer').rows.map((r: any) => [r.name, Math.round(r.change / 100)])
  assertEquals(cu, [
    ['Booking.com', 972754], ['hoppa_Resorthoppa Direct', 895044], ['ETG', 622633], ['City Airport Taxi', 260867],
    ['Getyourguide', 245756], ['China Ctrip API', 88468], ['hoppa_Sembo', 68907], ['Gaode - Ride Hailing', 55841],
    ['淘宝-elife', -41355], ['hoppa_Veturis', -47316], ['小红书', -64562], ['Corporates', -96107],
    ['Book Taxi', -129639], ['Other', -129824], ['hoppa_Tier 4', -161538], ['Mozio', -265913],
  ])
})

Deno.test('11.6 invariants: every breakdown adds back to the KPI totals', async () => {
  for (const p of ['ytd', 'mtd'] as PeriodKey[]) {
    const d = await load(p)
    assertEquals(d.checks.map((c: any) => c.ok), [true, true, true, true], p)
  }
})

Deno.test('11.6 same as_of → identical payloads', async () => {
  assertEquals(await load('ytd'), await load('ytd'))
})

Deno.test('retry: empty warehouse read retries once 25 minutes earlier', async () => {
  const seen: number[] = []
  const good = fixtureRunner('ytd')
  const flaky: Runner = async (name, sql, params, p) => {
    seen.push(p.as_of_ms)
    if (p.as_of_ms === AS_OF) {
      if (name === 'kpi_totals') return [{ ...YTD.kpi_totals[0], p_revenue: '0', p_cost: '0', p_trips: '0' }]
      return []
    }
    return good(name, sql, params, p)
  }
  const r = await executiveSummary('ytd', AS_OF, flaky, () => {})
  assertEquals(r.status, 'ok')
  assertEquals(r.retried, true)
  assertEquals(r.data.as_of, '2026-09-28T08:05:00Z')
  assertEquals(r.data.as_of_requested, '2026-09-28T08:30:00Z')
  assertEquals(new Set(seen).size, 2)

  const alwaysEmpty: Runner = async (name) => (name === 'kpi_totals' ? [{ p_trips: '0' }] : [])
  assertEquals((await executiveSummary('ytd', AS_OF, alwaysEmpty, () => {})).status, 'reloading')
})

Deno.test('retry: inconsistent breakdown is flagged, not hidden', async () => {
  const good = fixtureRunner('ytd')
  const broken: Runner = async (name, sql, params, p) =>
    name === 'by_region' ? YTD.by_region.slice(1) : good(name, sql, params, p)
  const r = await executiveSummary('ytd', AS_OF, broken, () => {})
  assertEquals(r.status, 'inconsistent')
  assertEquals(r.data.checks.find((c: any) => !c.ok)?.name, 'regions = KPI totals')
})

Deno.test('toCents parses NUMERIC strings exactly', () => {
  assertEquals(toCents('41789883.44'), 4178988344)
  assertEquals(toCents('41765913.6'), 4176591360)
  assertEquals(toCents('-93193.99'), -9319399)
  assertEquals(toCents('-0.5'), -50)
  assertEquals(toCents('0'), 0)
  assertEquals(toCents(null), 0)
  assertEquals(toCents('159497448.79'), 15949744879)
})
