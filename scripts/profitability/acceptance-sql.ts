// Prints the exact Profitability SQL the edge function runs for one pinned as_of, with
// parameters inlined, so acceptance fixtures can be captured from a console that does not
// accept query parameters. The base CTE is declared once and each component body (the text
// componentSql() appends after baseCte()) runs as a subquery over it — the same rows the
// edge function reads.
//
//   deno run scripts/profitability/acceptance-sql.ts <as_of> es <period> [names]
//       → one JSON string per Executive Summary query  (testdata/<as_of>_<period>.json)
//   deno run scripts/profitability/acceptance-sql.ts <as_of> countries <period> [region]
//       → country_summary + country_monthly, compact  (testdata/<as_of>_countries_<period>.json)
//   deno run scripts/profitability/acceptance-sql.ts <as_of> country-invariants <period>
//       → Brief 02 §7.5 invariants 2–5 evaluated inside BigQuery
import { type PeriodKey, parseAsOfSelector, periodSpec } from '../../supabase/functions/_shared/profitability/time.ts'
import { periodQueryParams } from '../../supabase/functions/_shared/profitability/pinned.ts'
import {
  baseCte, componentSql, inlineParams, REGIONS, CUSTOMER_HISTORY_START, type QueryName, type QueryParams,
} from '../../supabase/functions/_shared/profitability/sql.ts'

const [iso = '2026-09-28T08:30:00Z', mode = 'es', period = 'ytd', extra] = Deno.args
const at = parseAsOfSelector(iso)
if (at.kind !== 'exact') throw new Error('pass an exact timestamp')
const asOfMs = Date.parse(at.iso)
const base = periodQueryParams(period as PeriodKey, asOfMs)

/** Component body as a standalone subquery over the shared `b`. */
function body(n: QueryName, p: QueryParams): string {
  const b = baseCte(asOfMs), full = componentSql(n, asOfMs)
  if (!full.startsWith(b)) throw new Error(`${n} is not composed from baseCte()`)
  return inlineParams(full.slice(b.length).trim().replace(/^,/, 'WITH'), p)
}
const head = inlineParams(baseCte(asOfMs), base)

if (mode === 'es') {
  let names: QueryName[] = ['kpi_totals', 'mtd_same_days', 'monthly_by_product_line', 'monthly_by_region',
    'by_product_line', 'by_region']
  if (periodSpec(period as PeriodKey, asOfMs).comparison) names.push('movers_country', 'movers_customer')
  if (extra) names = names.filter((n) => extra.split(',').includes(n))
  const parts = names.map((n) => {
    const p = n === 'movers_country' ? { ...base, dim: 'country' as const }
      : n === 'movers_customer' ? { ...base, dim: 'customer' as const } : base
    return `(SELECT TO_JSON_STRING(ARRAY(SELECT AS STRUCT * FROM (\n${body(n, p)}\n)))) AS ${n}`
  })
  console.log(`${head}\nSELECT\n${parts.join(',\n')}`)
} else if (mode === 'countries') {
  const p = { ...base, region: extra ?? '' }
  // Compact rows (all strings; '' for NULL) — decoded back to query rows by the tests.
  console.log(`${head}
SELECT
(SELECT CONCAT('[', STRING_AGG(TO_JSON_STRING([country, IFNULL(main_region, ''), IFNULL(all_regions, ''),
    p_revenue, p_cost, CAST(p_trips AS STRING), cc_revenue, cc_cost, CAST(cc_trips AS STRING),
    cp_revenue, cp_cost, CAST(cp_trips AS STRING)]), ','), ']') FROM (
${body('country_summary', p)}
)) AS country_summary,
(SELECT CONCAT('[', STRING_AGG(TO_JSON_STRING([SUBSTR(month, 1, 7), country, revenue, cost, CAST(trips AS STRING)]), ','), ']') FROM (
${body('country_monthly', p)}
)) AS country_monthly`)
} else if (mode === 'countries-top') {
  // Top N rows of country_summary plus one '(all others)' row, compact. For checking ranks
  // and shares in periods where the full list is not needed.
  const n = Number(extra ?? 12)
  const p = { ...base, region: '' }
  console.log(`${head}
SELECT (SELECT CONCAT('[', STRING_AGG(TO_JSON_STRING([country, IFNULL(main_region, ''), IFNULL(all_regions, ''),
    p_revenue, p_cost, CAST(p_trips AS STRING), cc_revenue, cc_cost, CAST(cc_trips AS STRING),
    cp_revenue, cp_cost, CAST(cp_trips AS STRING)]), ','), ']') FROM (
  SELECT IF(rk <= ${n}, country, '(all others)') AS country,
    IF(MIN(rk) <= ${n}, ANY_VALUE(main_region), '') AS main_region, IF(MIN(rk) <= ${n}, ANY_VALUE(all_regions), '') AS all_regions,
    CAST(SUM(CAST(p_revenue AS NUMERIC)) AS STRING) AS p_revenue, CAST(SUM(CAST(p_cost AS NUMERIC)) AS STRING) AS p_cost, SUM(p_trips) AS p_trips,
    CAST(SUM(CAST(cc_revenue AS NUMERIC)) AS STRING) AS cc_revenue, CAST(SUM(CAST(cc_cost AS NUMERIC)) AS STRING) AS cc_cost, SUM(cc_trips) AS cc_trips,
    CAST(SUM(CAST(cp_revenue AS NUMERIC)) AS STRING) AS cp_revenue, CAST(SUM(CAST(cp_cost AS NUMERIC)) AS STRING) AS cp_cost, SUM(cp_trips) AS cp_trips
  FROM (SELECT *, ROW_NUMBER() OVER (ORDER BY CAST(p_revenue AS NUMERIC) - CAST(p_cost AS NUMERIC) DESC, country) AS rk FROM (
${body('country_summary', p)}
  )) GROUP BY 1
)) AS ${period}_top`)
} else if (mode === 'country-invariants') {
  const sums = (region: string) => `(SELECT AS STRUCT '${region}' AS region,
      SUM(CAST(p_revenue AS NUMERIC)) AS revenue, SUM(CAST(p_cost AS NUMERIC)) AS cost, SUM(p_trips) AS trips
    FROM (
${body('country_summary', { ...base, region })}
))`
  const monthlyVsSummary = (region: string) => `(SELECT COUNT(*) FROM (
    SELECT s.country FROM (
${body('country_summary', { ...base, region })}
    ) s FULL JOIN (
      SELECT country, SUM(CAST(revenue AS NUMERIC)) rv, SUM(CAST(cost AS NUMERIC)) cs, SUM(trips) n FROM (
${body('country_monthly', { ...base, region })}
      ) GROUP BY country
    ) m USING (country)
    WHERE s.p_trips > 0 AND (m.country IS NULL OR CAST(s.p_revenue AS NUMERIC) <> m.rv
       OR CAST(s.p_cost AS NUMERIC) <> m.cs OR s.p_trips <> m.n)))`
  console.log(`${head}
SELECT
  TO_JSON_STRING(ARRAY[${['', ...REGIONS].map(sums).join(',\n')}]) AS region_totals,
  TO_JSON_STRING(ARRAY(SELECT AS STRUCT * FROM (
${body('by_region', base)}
  ))) AS es_by_region,
  TO_JSON_STRING(ARRAY(SELECT AS STRUCT month, SUM(CAST(revenue AS NUMERIC)) AS revenue,
      SUM(CAST(cost AS NUMERIC)) AS cost, SUM(trips) AS trips FROM (
${body('country_monthly', { ...base, region: '' })}
  ) GROUP BY month ORDER BY month)) AS monthly_all_countries,
  ${monthlyVsSummary('')} AS monthly_mismatch_all,
  ${monthlyVsSummary('Europe')} AS monthly_mismatch_europe,
  (SELECT CONCAT('[', STRING_AGG(TO_JSON_STRING([SUBSTR(month, 1, 7), country, revenue, cost, CAST(trips AS STRING)]), ','), ']') FROM (
${body('country_monthly', { ...base, region: '' })}
  ) WHERE country IN ('United States', 'Spain', 'Italy', 'Thailand', 'Laos')) AS sample_monthly`)
} else if (mode === 'city-invariants') {
  // Brief 03 §7.5 invariants 1–6 plus an independent SQL computation of the KPI cards. Each
  // filtered city_summary is the exact generated query, defined once as a CTE.
  const filters: [string, string, string][] = [['all', '', ''], ['spain', '', 'Spain'],
    ...REGIONS.map((r, i): [string, string, string] => [`r${i}`, r, ''])]
  const ctes = filters.map(([k, r, c]) => `cs_${k} AS (\n${body('city_summary', { ...base, region: r, country: c })}\n)`)
  ctes.push(`cm_all AS (\n${body('city_monthly', { ...base, region: '', country: '' })}\n)`)
  const sums = ([k, r, c]: [string, string, string]) => `(SELECT AS STRUCT '${k}' AS f, '${r}' AS region, '${c}' AS country,
      SUM(CAST(p_revenue AS NUMERIC)) AS revenue, SUM(CAST(p_cost AS NUMERIC)) AS cost, SUM(p_trips) AS trips,
      COUNT(*) AS rows_all, COUNTIF(p_trips > 0) AS rows_listed, COUNT(DISTINCT sa_id) AS distinct_ids FROM cs_${k})`
  console.log(`${head.trimEnd()},
${ctes.join(',\n')}
SELECT
  TO_JSON_STRING(ARRAY[${filters.map(sums).join(',\n')}]) AS city_totals,
  TO_JSON_STRING(ARRAY(SELECT AS STRUCT * FROM (
${body('kpi_totals', base)}
  ))) AS es_kpi,
  TO_JSON_STRING(ARRAY(SELECT AS STRUCT name, p_revenue, p_cost, p_trips FROM (
${body('by_region', base)}
  ))) AS es_by_region,
  TO_JSON_STRING(ARRAY(SELECT AS STRUCT country, p_revenue, p_cost, p_trips FROM (
${body('country_summary', { ...base, region: '' })}
  ) WHERE country = 'Spain')) AS countries_spain,
  (SELECT COUNT(*) FROM cs_all s LEFT JOIN (
      SELECT sa_id, SUM(CAST(revenue AS NUMERIC)) rv, SUM(CAST(cost AS NUMERIC)) cs, SUM(trips) n FROM cm_all GROUP BY sa_id
    ) m USING (sa_id)
    WHERE s.p_trips > 0 AND (m.sa_id IS NULL OR CAST(s.p_revenue AS NUMERIC) <> m.rv OR CAST(s.p_cost AS NUMERIC) <> m.cs OR s.p_trips <> m.n)
  ) AS monthly_mismatch,
  (SELECT COUNT(DISTINCT COALESCE(sa_id, -1)) FROM b WHERE d BETWEEN DATE '${base.p_start}' AND DATE '${base.p_end}') AS distinct_sa_in_base,
  (SELECT TO_JSON_STRING(STRUCT(
      COUNT(*) AS m_cities, COUNT(DISTINCT country) AS k_countries,
      MIN(IF(cum >= 0.8 * tot, rk, NULL)) AS n80, MAX(cum / tot) AS max_cum, ANY_VALUE(tot) AS page_total,
      SUM(IF(rk <= 10, profit, 0)) / ANY_VALUE(tot) AS top10, SUM(IF(rk <= 25, profit, 0)) / ANY_VALUE(tot) AS top25,
      SUM(IF(rk <= 50, profit, 0)) / ANY_VALUE(tot) AS top50,
      COUNTIF(profit < 0 AND rev >= 5000) AS loss_n, SUM(IF(profit < 0 AND rev >= 5000, profit, 0)) AS loss_sum))
    FROM (
      SELECT *, SUM(profit) OVER (ORDER BY profit DESC, sa_id ROWS UNBOUNDED PRECEDING) AS cum,
             ROW_NUMBER() OVER (ORDER BY profit DESC, sa_id) AS rk
      FROM (SELECT sa_id, country, CAST(p_revenue AS NUMERIC) AS rev, CAST(p_revenue AS NUMERIC) - CAST(p_cost AS NUMERIC) AS profit,
                   SUM(CAST(p_revenue AS NUMERIC) - CAST(p_cost AS NUMERIC)) OVER () AS tot
            FROM cs_all WHERE p_trips > 0)
      WHERE sa_id <> -1)) AS kpi_sql,
  (SELECT COUNTIF(cp_trips > 0 AND sa_id <> -1) FROM cs_all) AS last_year_cities`)
} else if (mode === 'cities-fixture') {
  // city_summary rows the Cities page's rankings and charts depend on, compact; every other
  // row is folded into the '(no service area)' row (sa_id -1) so page totals stay exact while
  // it stays out of rankings. Also returns raw names whose cleaned labels could collide.
  const n = Number(extra ?? 110)
  const p = { ...base, region: '', country: '' }
  console.log(`${head.trimEnd()},
cs AS (
${body('city_summary', p)}
),
r AS (
  SELECT *, CAST(p_revenue AS NUMERIC) - CAST(p_cost AS NUMERIC) AS profit,
    ROW_NUMBER() OVER (ORDER BY CAST(p_revenue AS NUMERIC) - CAST(p_cost AS NUMERIC) DESC, sa_id) AS rk_p,
    ROW_NUMBER() OVER (ORDER BY CAST(cc_revenue AS NUMERIC) - CAST(cc_cost AS NUMERIC) DESC, sa_id) AS rk_cc,
    ROW_NUMBER() OVER (ORDER BY IF(CAST(p_revenue AS NUMERIC) >= 50000 AND sa_id <> -1,
      (CAST(p_revenue AS NUMERIC) - CAST(p_cost AS NUMERIC)) / CAST(p_revenue AS NUMERIC), 99), sa_id) AS rk_m
  FROM cs WHERE p_trips > 0 OR cp_trips > 0
),
keep AS (
  SELECT *, (sa_id <> -1 AND p_trips > 0 AND (rk_p <= ${n} OR rk_cc <= 20 OR rk_m <= 15 OR country = 'Spain'
      OR (profit < 0 AND CAST(p_revenue AS NUMERIC) >= 5000)
      OR REGEXP_CONTAINS(sa_name, r'%EF%BC%8C|，|^[A-Z]{3},') OR sa_name IN ('Huntsville, AL, USA', 'Dubai-DWC,United Arab Emirates'))) AS detailed
  FROM r
)
SELECT
  (SELECT CONCAT('[', STRING_AGG(TO_JSON_STRING([CAST(sa_id AS STRING), sa_name, country, region, p_revenue, p_cost, CAST(p_trips AS STRING),
      cc_revenue, cc_cost, CAST(cc_trips AS STRING), cp_revenue, cp_cost, CAST(cp_trips AS STRING)]), ',' ORDER BY rk_p), ']')
    FROM keep WHERE detailed) AS detailed,
  (SELECT TO_JSON_STRING([CAST(SUM(CAST(p_revenue AS NUMERIC)) AS STRING), CAST(SUM(CAST(p_cost AS NUMERIC)) AS STRING), CAST(SUM(p_trips) AS STRING),
      CAST(SUM(CAST(cc_revenue AS NUMERIC)) AS STRING), CAST(SUM(CAST(cc_cost AS NUMERIC)) AS STRING), CAST(SUM(cc_trips) AS STRING),
      CAST(SUM(CAST(cp_revenue AS NUMERIC)) AS STRING), CAST(SUM(CAST(cp_cost AS NUMERIC)) AS STRING), CAST(SUM(cp_trips) AS STRING)])
    FROM keep WHERE NOT detailed) AS folded,
  (SELECT COUNTIF(NOT detailed) FROM keep) AS folded_rows,
  (SELECT SUM(IF(rk_rev <= 50, profit, 0)) / SUM(profit) FROM (
     SELECT profit, sa_id, ROW_NUMBER() OVER (ORDER BY IF(sa_id = -1, -1e18, CAST(p_revenue AS NUMERIC)) DESC) AS rk_rev FROM r WHERE p_trips > 0)) AS top50_by_period_revenue_share`)
} else if (mode === 'cities-top') {
  // Top N cities by period profit (plus any named in the 5th argument), compact, with the
  // rest folded into '(no service area)' so the page total stays exact.
  const n = Number(extra ?? 12)
  const also = (Deno.args[4] ?? '').split('|').filter(Boolean).map((x) => `'${x.replace(/'/g, "\\'")}'`)
  const p = { ...base, region: '', country: '' }
  const pick = `(sa_id <> -1 AND p_trips > 0 AND (rk <= ${n}${also.length ? ` OR sa_name IN (${also.join(', ')})` : ''}))`
  console.log(`${head.trimEnd()},
cs AS (
${body('city_summary', p)}
),
r AS (SELECT *, ROW_NUMBER() OVER (ORDER BY CAST(p_revenue AS NUMERIC) - CAST(p_cost AS NUMERIC) DESC, sa_id) AS rk FROM cs)
SELECT
  (SELECT CONCAT('[', STRING_AGG(TO_JSON_STRING([CAST(sa_id AS STRING), sa_name, country, region, p_revenue, p_cost, CAST(p_trips AS STRING),
      cc_revenue, cc_cost, CAST(cc_trips AS STRING), cp_revenue, cp_cost, CAST(cp_trips AS STRING)]), ',' ORDER BY rk), ']') FROM r WHERE ${pick}) AS detailed,
  (SELECT TO_JSON_STRING([CAST(SUM(CAST(p_revenue AS NUMERIC)) AS STRING), CAST(SUM(CAST(p_cost AS NUMERIC)) AS STRING), CAST(SUM(p_trips) AS STRING),
      CAST(SUM(CAST(cc_revenue AS NUMERIC)) AS STRING), CAST(SUM(CAST(cc_cost AS NUMERIC)) AS STRING), CAST(SUM(cc_trips) AS STRING),
      CAST(SUM(CAST(cp_revenue AS NUMERIC)) AS STRING), CAST(SUM(CAST(cp_cost AS NUMERIC)) AS STRING), CAST(SUM(cp_trips) AS STRING)])
    FROM r WHERE NOT ${pick}) AS folded`)
} else if (mode === 'routes') {
  // Brief 04 §7.6 invariants (inside BigQuery) + a compact fixture for the model tests.
  // Listed routes needed by the page (top 30 by profit, top 20 by comparison profit, every listed
  // loss-maker, the JFK/Manhattan pairs) are kept in full; the rest of the listed routes are
  // folded into the roll-up row, which keeps Σ listed = transfer profit exact.
  const r = (x: Partial<QueryParams>) => ({ ...base, region: '', country: '', product: '', city: -999, ...x })
  const ALL = r({})
  const ctes = [
    `rt_all AS (\n${body('route_types', ALL)}\n)`,
    `rt_spain AS (\n${body('route_types', r({ country: 'Spain' }))}\n)`,
    `rt_c451 AS (\n${body('route_types', r({ city: 451 }))}\n)`,
    `rt_pt AS (\n${body('route_types', r({ product: 'Private Transfer' }))}\n)`,
    `rtm AS (\n${body('route_type_monthly', ALL)}\n)`,
    `rl AS (\n${body('routes_listed', ALL)}\n)`,
    `rk AS (\n${body('route_kpis', ALL)}\n)`,
    `rm AS (\n${body('route_monthly', ALL)}\n)`,
    `es_pl AS (\n${body('by_product_line', base)}\n)`,
    `es_kpi AS (\n${body('kpi_totals', base)}\n)`,
    `c_spain AS (SELECT * FROM (\n${body('country_summary', { ...base, region: '' })}\n) WHERE country = 'Spain')`,
    `ci_451 AS (SELECT * FROM (\n${body('city_summary', { ...base, region: '', country: '' })}\n) WHERE sa_id = 451)`,
  ]
  const tsum = (t: string, where = 'TRUE') => `(SELECT AS STRUCT CAST(SUM(CAST(p_revenue AS NUMERIC)) AS STRING) AS revenue, CAST(SUM(CAST(p_cost AS NUMERIC)) AS STRING) AS cost, SUM(p_trips) AS trips FROM ${t} WHERE ${where})`
  const row = (a: string) => `TO_JSON_STRING([CAST(sa_id AS STRING), route_key, sa_name, country, region, IFNULL(CAST(is_distance_priced AS STRING), ''),
      p_revenue, p_cost, CAST(p_trips AS STRING), cc_revenue, cc_cost, cp_revenue, cp_cost, CAST(n_routes AS STRING)])${a}`
  console.log(`${head.trimEnd()},
${ctes.join(',\n')},
rl_r AS (
  SELECT *, CAST(p_revenue AS NUMERIC) - CAST(p_cost AS NUMERIC) AS profit,
    ROW_NUMBER() OVER (ORDER BY IF(sa_id = -2, -1e18, CAST(p_revenue AS NUMERIC) - CAST(p_cost AS NUMERIC)) DESC, sa_id, route_key) AS rk_p,
    ROW_NUMBER() OVER (ORDER BY IF(sa_id = -2, -1e18, CAST(cc_revenue AS NUMERIC) - CAST(cc_cost AS NUMERIC)) DESC, sa_id, route_key) AS rk_cc
  FROM rl
),
keep AS (
  SELECT *, (sa_id <> -2 AND (rk_p <= 30 OR rk_cc <= 20 OR profit < 0
      OR (sa_id = 40 AND route_key IN ('JFK - 曼哈顿', '曼哈顿 - JFK', 'JFK - 曼哈顿2')))) AS detailed
  FROM rl_r
)
SELECT
  TO_JSON_STRING(STRUCT(
    ${tsum('rt_all')} AS types_all, ${tsum('es_kpi')} AS es_kpi,
    ${tsum('rt_all', 'route_type = 4')} AS types_rh, ${tsum('es_pl', "name = 'Ride Hailing'")} AS es_rh,
    ${tsum('rt_all', 'route_type <> 4')} AS types_transfer, ${tsum('rl')} AS listed_all,
    ${tsum('rt_spain')} AS types_spain, ${tsum('c_spain')} AS countries_spain,
    ${tsum('rt_c451')} AS types_city451, ${tsum('ci_451')} AS cities_451,
    ${tsum('rt_pt')} AS types_pt, ${tsum('es_pl', "name = 'Private Transfer'")} AS es_pt,
    (SELECT AS STRUCT CAST(SUM(CAST(revenue AS NUMERIC)) AS STRING) AS revenue, CAST(SUM(CAST(cost AS NUMERIC)) AS STRING) AS cost, SUM(trips) AS trips FROM rtm) AS type_months,
    (SELECT COUNTIF(sa_id <> -2) FROM rl) AS listed_n,
    (SELECT SUM(n_routes) FROM rl WHERE sa_id = -2) AS rollup_n,
    (SELECT COUNT(*) FROM (SELECT DISTINCT sa_id, route_key FROM rl WHERE sa_id <> -2)) AS listed_distinct,
    (SELECT COUNT(*) FROM rl l LEFT JOIN (SELECT sa_id, route_key, SUM(CAST(revenue AS NUMERIC)) rv, SUM(CAST(cost AS NUMERIC)) cs, SUM(trips) n FROM rm GROUP BY 1, 2) m USING (sa_id, route_key)
      WHERE l.sa_id <> -2 AND (m.sa_id IS NULL OR CAST(l.p_revenue AS NUMERIC) <> m.rv OR CAST(l.p_cost AS NUMERIC) <> m.cs OR l.p_trips <> m.n)) AS monthly_mismatch,
    (SELECT COUNTIF(is_distance_priced <> STARTS_WITH(route_key, '~')) FROM rl WHERE sa_id <> -2) AS dp_flag_mismatch,
    (SELECT COUNT(*) FROM rl WHERE sa_id = 40 AND route_key IN ('JFK - 曼哈顿', '曼哈顿 - JFK')) AS jfk_pair_rows,
    (SELECT COUNT(DISTINCT sa_id) FROM rl WHERE route_key = 'JFK - 曼哈顿2') AS jfk2_service_areas,
    (SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(band, n, CAST(rv AS STRING) AS revenue, CAST(pr AS STRING) AS profit) ORDER BY band)) FROM (
       SELECT CASE WHEN m < 0 THEN 0 WHEN m < 0.1 THEN 1 WHEN m < 0.2 THEN 2 WHEN m < 0.3 THEN 3 ELSE 4 END AS band,
              COUNT(*) AS n, SUM(rv) AS rv, SUM(pr) AS pr
       FROM (SELECT CAST(p_revenue AS NUMERIC) AS rv, CAST(p_revenue AS NUMERIC) - CAST(p_cost AS NUMERIC) AS pr,
                    (CAST(p_revenue AS NUMERIC) - CAST(p_cost AS NUMERIC)) / CAST(p_revenue AS NUMERIC) AS m
             FROM rl WHERE sa_id NOT IN (-1, -2) AND CAST(p_revenue AS NUMERIC) > 0) GROUP BY band)) AS margin_bands
  )) AS invariants,
  (SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(route_type, p_revenue, p_cost, p_trips, cc_revenue, cc_cost, cp_revenue, cp_cost) ORDER BY route_type)) FROM rt_all) AS route_types,
  (SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(month, route_type, revenue, cost, trips) ORDER BY month, route_type)) FROM rtm) AS route_type_monthly,
  (SELECT TO_JSON_STRING(ARRAY_AGG(t)) FROM rk t) AS route_kpis,
  (SELECT CONCAT('[', STRING_AGG(${row('')}, ',' ORDER BY rk_p), ']') FROM keep WHERE detailed) AS detailed,
  (SELECT TO_JSON_STRING([CAST(SUM(CAST(p_revenue AS NUMERIC)) AS STRING), CAST(SUM(CAST(p_cost AS NUMERIC)) AS STRING), CAST(SUM(p_trips) AS STRING),
      CAST(SUM(CAST(cc_revenue AS NUMERIC)) AS STRING), CAST(SUM(CAST(cc_cost AS NUMERIC)) AS STRING),
      CAST(SUM(CAST(cp_revenue AS NUMERIC)) AS STRING), CAST(SUM(CAST(cp_cost AS NUMERIC)) AS STRING), CAST(SUM(n_routes) AS STRING)])
    FROM keep WHERE NOT detailed) AS folded,
  (SELECT CONCAT('[', STRING_AGG(TO_JSON_STRING([CAST(sa_id AS STRING), route_key, month, revenue, cost, CAST(trips AS STRING)]), ',' ORDER BY route_key, month), ']')
    FROM rm WHERE sa_id = 451 AND route_key = 'ALC - 贝尼多姆' OR sa_id = 40 AND route_key = 'JFK - 曼哈顿') AS sample_monthly`)
} else if (mode === 'routes-top') {
  // Brief 04 §7.1/7.4/7.5 for one period: route types, route KPIs, the listed routes' top 5 by
  // profit and 5 largest losses, and a probe of the named loss-makers over ALL routes (with
  // their loss rank and whether the §4.4 listing rule lists them).
  const p = { ...base, region: '', country: '', product: '', city: -999 }
  const listed = body('routes_listed', p)
  const cut = listed.indexOf('\nSELECT sa_id, route_key, sa_name, country, region, is_distance_priced')
  if (cut < 0) throw new Error('routes_listed layout changed')
  const cols = `CAST(sa_id AS STRING), route_key, sa_name, CAST(p_revenue AS STRING), CAST(p_cost AS STRING), CAST(p_trips AS STRING),
      CAST(cc_revenue AS STRING), CAST(cc_cost AS STRING), CAST(cp_revenue AS STRING), CAST(cp_cost AS STRING)`
  console.log(`${head}
SELECT
  (SELECT TO_JSON_STRING(ARRAY_AGG(t ORDER BY route_type)) FROM (\n${body('route_types', p)}\n) t) AS route_types,
  (SELECT TO_JSON_STRING(ARRAY_AGG(t)) FROM (\n${body('route_kpis', p)}\n) t) AS route_kpis,
  (SELECT AS STRUCT * FROM (
${listed.slice(0, cut)}
SELECT
  (SELECT COUNTIF(listed) FROM tagged) AS listed_n,
  (SELECT CONCAT('[', STRING_AGG(TO_JSON_STRING([${cols}]), ',' ORDER BY rank_p), ']') FROM tagged WHERE listed AND rank_p <= 5) AS top5,
  (SELECT CONCAT('[', STRING_AGG(TO_JSON_STRING([${cols}]), ',' ORDER BY rank_loss), ']') FROM tagged WHERE listed AND rank_loss <= 5 AND p_revenue - p_cost < 0) AS loss5,
  (SELECT CONCAT('[', STRING_AGG(TO_JSON_STRING([${cols}, CAST(rank_loss AS STRING), CAST(rank_rev AS STRING), CAST(listed AS STRING)]), ',' ORDER BY rank_loss), ']')
     FROM tagged WHERE p_revenue - p_cost < 0 AND (route_key LIKE 'SID - %' OR route_key LIKE 'INN - Lech%' OR route_key LIKE '%- SGN'
       OR route_key LIKE 'PMI - Cala d%' OR route_key = 'FRA - Strasbourg')) AS probe
)).*`)
} else if (mode === 'customers' || mode === 'customers-top') {
  // Brief 05. 'customers' (YTD): §7.6 invariants inside BigQuery + every customer row, teams,
  // grid, new/existing months, attributes and three sample monthly series. 'customers-top'
  // (other periods): top 12 customers + folded rest, teams, grid, KPI totals.
  const cq = (x: Partial<QueryParams> = {}) => ({ ...base, base_start: CUSTOMER_HISTORY_START, region: '', country: '', product: '', team: '', ctype: '', ...x })
  const hd = inlineParams(baseCte(asOfMs), { ...base, base_start: CUSTOMER_HISTORY_START })
  const tsum = (t: string, where = 'TRUE') => `(SELECT AS STRUCT CAST(SUM(CAST(p_revenue AS NUMERIC)) AS STRING) AS revenue, CAST(SUM(CAST(p_cost AS NUMERIC)) AS STRING) AS cost, SUM(p_trips) AS trips FROM ${t} WHERE ${where})`
  const rsum = (t: string, where = 'TRUE') => `(SELECT AS STRUCT CAST(SUM(CAST(revenue AS NUMERIC)) AS STRING) AS revenue, CAST(SUM(CAST(cost AS NUMERIC)) AS STRING) AS cost, SUM(trips) AS trips FROM ${t} WHERE ${where})`
  const crow = `TO_JSON_STRING([customer, customer_type, team, IFNULL(first_trade_month, ''), p_revenue, p_cost, CAST(p_trips AS STRING), p_new_profit,
      cc_revenue, cc_cost, cp_revenue, cp_cost, CAST(cp_trips AS STRING)])`
  const agg = (expr: string, from: string, order: string) => `(SELECT CONCAT('[', STRING_AGG(${expr}, ',' ORDER BY ${order}), ']') FROM ${from})`
  const common = [
    `cs AS (\n${body('customer_summary', cq())}\n)`,
    `ts AS (\n${body('team_summary', cq())}\n)`,
    `cg AS (\n${body('customer_country_grid', cq())}\n)`,
    `ne AS (\n${body('new_existing_monthly', cq())}\n)`,
    `es_kpi AS (\n${body('kpi_totals', base)}\n)`,
    `csr AS (SELECT *, ROW_NUMBER() OVER (ORDER BY IF(customer = 'Unmapped', 1, 0), CAST(p_revenue AS NUMERIC) - CAST(p_cost AS NUMERIC) DESC, customer) AS rk FROM cs)`,
  ]
  const tables = `
  ${agg(`TO_JSON_STRING([team, CAST(customers AS STRING), p_revenue, p_cost, CAST(p_trips AS STRING), cc_revenue, cc_cost, cp_revenue, cp_cost])`, 'ts', 'team')} AS teams,
  ${agg(`TO_JSON_STRING([CAST(ki AS STRING), CAST(ci AS STRING), customer, country, revenue, cost, CAST(trips AS STRING)])`, 'cg', 'ki, ci')} AS grid,
  ${agg(`TO_JSON_STRING([month, CAST(is_new AS STRING), revenue, cost, CAST(trips AS STRING), CAST(customers AS STRING)])`, 'ne', 'month, is_new')} AS new_existing`
  if (mode === 'customers') {
    const ly = periodQueryParams('last_year', asOfMs)
    const ctes = [...common,
      `cm AS (\n${body('customer_monthly', cq())}\n)`,
      `atr AS (\n${body('customer_attrs', cq())}\n)`,
      `atr_ly AS (\n${body('customer_attrs', { ...cq(), ...ly, base_start: CUSTOMER_HISTORY_START })}\n)`,
      `cs_chris AS (\n${body('customer_summary', cq({ team: 'EAM Chris' }))}\n)`,
      `cs_partner AS (\n${body('customer_summary', cq({ ctype: 'partner' }))}\n)`,
      `cs_spain AS (\n${body('customer_summary', cq({ country: 'Spain' }))}\n)`,
      `cs_pt AS (\n${body('customer_summary', cq({ product: 'Private Transfer' }))}\n)`,
      `es_pl AS (\n${body('by_product_line', base)}\n)`,
      `c_spain AS (SELECT * FROM (\n${body('country_summary', { ...base, region: '' })}\n) WHERE country = 'Spain')`,
    ]
    console.log(`${hd.trimEnd()},
${ctes.join(',\n')}
SELECT
  TO_JSON_STRING(STRUCT(
    ${tsum('cs')} AS customers, ${tsum('ts')} AS teams, ${rsum('cg')} AS grid, ${rsum('ne')} AS new_existing, ${tsum('es_kpi')} AS es_kpi,
    ${tsum('cs_chris')} AS team_chris_page, ${tsum('ts', "team = 'EAM Chris'")} AS team_chris_row,
    ${tsum('cs_partner')} AS ctype_partner_page, ${tsum('cs', "customer_type = 'partner'")} AS ctype_partner_rows,
    ${tsum('cs_spain')} AS spain_page, ${tsum('c_spain')} AS spain_country_row,
    ${tsum('cs_pt')} AS pt_page, ${tsum('es_pl', "name = 'Private Transfer'")} AS pt_es_row,
    (SELECT CAST(SUM(CAST(p_new_profit AS NUMERIC)) AS STRING) FROM cs) AS new_profit_customers,
    (SELECT CAST(SUM(CAST(revenue AS NUMERIC) - CAST(cost AS NUMERIC)) AS STRING) FROM ne WHERE is_new) AS new_profit_months,
    (SELECT COUNT(*) FROM cs c LEFT JOIN (SELECT customer, SUM(CAST(revenue AS NUMERIC)) rv, SUM(CAST(cost AS NUMERIC)) co, SUM(trips) n FROM cm GROUP BY 1) m USING (customer)
      WHERE c.p_trips > 0 AND (m.customer IS NULL OR CAST(c.p_revenue AS NUMERIC) <> m.rv OR CAST(c.p_cost AS NUMERIC) <> m.co OR c.p_trips <> m.n)) AS monthly_mismatch,
    (SELECT COUNTIF(first_trade_month > first_seen_month) FROM atr) AS first_trade_after_seen,
    (SELECT COUNT(*) FROM atr a JOIN atr_ly l USING (customer) WHERE a.customer_type <> l.customer_type OR a.team <> l.team OR a.first_trade_month <> l.first_trade_month) AS attrs_differ_ly,
    (SELECT COUNT(*) FROM cs) AS summary_rows, (SELECT COUNT(DISTINCT customer) FROM cs) AS summary_distinct
  )) AS invariants,
  ${agg(crow, 'csr', 'rk')} AS customers,
  ${agg(`TO_JSON_STRING([customer, customer_type, team, IFNULL(first_trade_month, ''), IFNULL(first_seen_month, ''), IFNULL(dim_first_trade, ''), CAST(p_trips AS STRING)])`, 'atr', 'customer')} AS attrs,
  (SELECT ANY_VALUE(customer_groups) FROM atr) AS customer_groups,${tables},
  ${agg(`TO_JSON_STRING([customer, month, revenue, cost, CAST(trips AS STRING)])`, "cm WHERE customer IN ('Booking.com', '6 Tour', 'hoppa_Resorthoppa Direct')", 'customer, month')} AS sample_monthly`)
  } else {
    const n = Number(extra ?? 12)
    console.log(`${hd.trimEnd()},
${common.join(',\n')}
SELECT
  ${tsum('es_kpi')} AS es_kpi,
  ${agg(crow, `csr WHERE rk <= ${n}`, 'rk')} AS top,
  (SELECT TO_JSON_STRING([CAST(SUM(CAST(p_revenue AS NUMERIC)) AS STRING), CAST(SUM(CAST(p_cost AS NUMERIC)) AS STRING), CAST(SUM(p_trips) AS STRING),
      CAST(SUM(CAST(p_new_profit AS NUMERIC)) AS STRING), CAST(SUM(CAST(cc_revenue AS NUMERIC)) AS STRING), CAST(SUM(CAST(cc_cost AS NUMERIC)) AS STRING),
      CAST(SUM(CAST(cp_revenue AS NUMERIC)) AS STRING), CAST(SUM(CAST(cp_cost AS NUMERIC)) AS STRING), CAST(SUM(cp_trips) AS STRING), CAST(COUNT(*) AS STRING)])
    FROM csr WHERE rk > ${n}) AS folded,${tables}`)
  }
} else {
  throw new Error(`Unknown mode ${mode}`)
}
