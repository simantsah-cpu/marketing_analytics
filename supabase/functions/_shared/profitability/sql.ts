// Profitability SQL — the single home of the base CTE. Every Profitability query
// on every page is composed from baseCte(); do not copy it elsewhere.
//
// Business rules mirror the Power BI data dictionary "Profit" measure:
//  - revenue = ROUND(elife_amount_usd,2) + ROUND(additional_charge_amount_usd,2), per row
//  - cost    = ROUND(dispatch_amount_net_usd,2), per row, NULL → 0
//  - rows    = ride_stat IN ('Cancelled','Accepted','Pending') AND pickup_datetime < @as_of
//  - dated by pickup_date; region/country from pickup service area; customer group from ordering fleet
// Never use Unpaid rows, elife_amount_usd_by_trip, or dim_service_area.geo.

import { bqTimestampText, type Ymd } from './time.ts'

const P = 'elife-data-warehouse-prod'
export const FACT_TABLE = { project: P, dataset: 'ads', table: 'ads_ride_dispatch_v' }

export const RIDE_HAILING_FLEETS = [70167, 100951, 70168, 5684, 5685, 5809, 5810]

export const REGIONS = [
  'America & LATAM',
  'Europe',
  'Rest of Asia, Africa & Oceania',
  'Southeast Asia & Rest of Italy',
  'Turkey & others',
  'Unmapped',
] as const

export const PRODUCT_LINES = ['Private Transfer', 'Ride Hailing', 'Shared Shuttle', 'Rail'] as const

/**
 * Base CTE `b`. `asOfMs` is a server-resolved, validated instant; it is rendered as a
 * TIMESTAMP literal inside FOR SYSTEM_TIME AS OF (every table in one query must use the
 * same timestamp). The row filter uses the typed @as_of parameter with the same value.
 */
export function baseCte(asOfMs: number): string {
  const ts = `TIMESTAMP '${bqTimestampText(asOfMs)}'`
  return `WITH b AS (
  SELECT
    r.pickup_date                                             AS d,
    DATE_TRUNC(r.pickup_date, MONTH)                          AS m,
    CASE COALESCE(s.region, '')
      WHEN 'America&LATAM'                   THEN 'America & LATAM'
      WHEN 'Europe'                          THEN 'Europe'
      WHEN 'Rest Asia/Africa/Oceania'        THEN 'Rest of Asia, Africa & Oceania'
      WHEN 'Southeast Asia & Rest of Italy'  THEN 'Southeast Asia & Rest of Italy'
      WHEN 'Turkey and Others'               THEN 'Turkey & others'
      ELSE 'Unmapped' END                                     AS region,
    COALESCE(NULLIF(TRIM(s.country), ''), 'Unmapped')         AS country,
    COALESCE(NULLIF(TRIM(c.customer_name), ''), 'Unmapped')   AS customer,
    CASE
      WHEN r.to_fleet_id IN (${RIDE_HAILING_FLEETS.join(', ')})
        OR LOWER(COALESCE(r.partner_name, '')) LIKE '%ride hailing%' THEN 'Ride Hailing'
      WHEN COALESCE(r.vehicle_class_id, 0) < 110                     THEN 'Private Transfer'
      WHEN r.vehicle_class_id = 122                                  THEN 'Rail'
      ELSE 'Shared Shuttle' END                               AS product_line,
    ROUND(COALESCE(r.elife_amount_usd, 0), 2)
      + ROUND(COALESCE(r.additional_charge_amount_usd, 0), 2) AS revenue,
    ROUND(COALESCE(r.dispatch_amount_net_usd, 0), 2)          AS cost,
    r.service_area_id                                         AS sa_id,   -- city = pickup service area
    s.name                                                    AS sa_name,
    TRIM(COALESCE(r.route_name, ''))                          AS route_name,   -- zone route (pickup - drop-off)
    COALESCE(r.pickup_airport_code3, '')                      AS pu_airport,
    COALESCE(r.dropoff_airport_code3, '')                     AS do_airport,
    c.customer_type                                           AS customer_type_raw,
    c.department                                              AS team_raw,
    CAST(c.first_trade_month AS STRING)                       AS first_trade_raw,
    r.etl_time
  FROM \`${P}.ads.ads_ride_dispatch_v\`   AS r FOR SYSTEM_TIME AS OF ${ts}
  LEFT JOIN \`${P}.dim.dim_service_area\` AS s FOR SYSTEM_TIME AS OF ${ts}
         ON r.service_area_id = s.id
  LEFT JOIN \`${P}.dim.dim_fleet_as_customer\` AS c FOR SYSTEM_TIME AS OF ${ts}
         ON r.from_fleet_id_as_customer = c.fleet_id
  WHERE r.pickup_date >= @base_start
    AND r.pickup_datetime < @as_of
    AND r.ride_stat IN ('Cancelled', 'Accepted', 'Pending')
)`
}

// ── Component queries (all return NUMERIC money as exact decimal strings) ─────

const KPI_TOTALS = `
SELECT
  CAST(SUM(IF(d BETWEEN @p_start  AND @p_end,  revenue, 0)) AS STRING) AS p_revenue,
  CAST(SUM(IF(d BETWEEN @p_start  AND @p_end,  cost,    0)) AS STRING) AS p_cost,
  COUNTIF(d BETWEEN @p_start AND @p_end)                               AS p_trips,
  CAST(SUM(IF(d BETWEEN @cc_start AND @cc_end, revenue, 0)) AS STRING) AS cc_revenue,
  CAST(SUM(IF(d BETWEEN @cc_start AND @cc_end, cost,    0)) AS STRING) AS cc_cost,
  COUNTIF(d BETWEEN @cc_start AND @cc_end)                             AS cc_trips,
  CAST(SUM(IF(d BETWEEN @cp_start AND @cp_end, revenue, 0)) AS STRING) AS cp_revenue,
  CAST(SUM(IF(d BETWEEN @cp_start AND @cp_end, cost,    0)) AS STRING) AS cp_cost,
  COUNTIF(d BETWEEN @cp_start AND @cp_end)                             AS cp_trips,
  FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', MAX(etl_time))                AS warehouse_loaded_at
FROM b`

// Independent of the period selector: same complete days in this month, last month,
// and the same month last year.
const MTD_SAME_DAYS = `
, t AS (
  SELECT DATE_TRUNC(DATE(@as_of), MONTH) AS m0,
         EXTRACT(DAY FROM DATE(@as_of)) - 1 AS days
), w AS (
  SELECT 'this_month' AS win, 1 AS ord, m0 AS ws, DATE_ADD(m0, INTERVAL days - 1 DAY) AS we FROM t
  UNION ALL
  SELECT 'last_month', 2, DATE_SUB(m0, INTERVAL 1 MONTH),
         LEAST(DATE_ADD(DATE_SUB(m0, INTERVAL 1 MONTH), INTERVAL days - 1 DAY), DATE_SUB(m0, INTERVAL 1 DAY)) FROM t
  UNION ALL
  SELECT 'same_month_last_year', 3, DATE_SUB(m0, INTERVAL 12 MONTH),
         LEAST(DATE_ADD(DATE_SUB(m0, INTERVAL 12 MONTH), INTERVAL days - 1 DAY),
               DATE_SUB(DATE_SUB(m0, INTERVAL 11 MONTH), INTERVAL 1 DAY)) FROM t
)
SELECT w.win, CAST(w.ws AS STRING) AS ws, CAST(w.we AS STRING) AS we,
       CAST(COALESCE(SUM(b.revenue), 0) AS STRING) AS revenue,
       CAST(COALESCE(SUM(b.cost), 0) AS STRING)    AS cost,
       COUNT(b.d)                                  AS trips
FROM w LEFT JOIN b ON b.d BETWEEN w.ws AND w.we
WHERE (SELECT days FROM t) > 0
GROUP BY w.win, w.ord, w.ws, w.we
ORDER BY w.ord`

const monthlyBy = (dim: 'product_line' | 'region') => `
SELECT CAST(m AS STRING) AS month, ${dim} AS name,
       CAST(SUM(revenue) AS STRING) AS revenue, CAST(SUM(cost) AS STRING) AS cost, COUNT(*) AS trips
FROM b
WHERE d BETWEEN @p_start AND @p_end
GROUP BY month, name
ORDER BY month, name`

const breakdownBy = (dim: 'product_line' | 'region') => `
SELECT ${dim} AS name,
  CAST(SUM(IF(d BETWEEN @p_start  AND @p_end,  revenue, 0)) AS STRING)        AS p_revenue,
  CAST(SUM(IF(d BETWEEN @p_start  AND @p_end,  cost,    0)) AS STRING)        AS p_cost,
  COUNTIF(d BETWEEN @p_start AND @p_end)                                      AS p_trips,
  CAST(SUM(IF(d BETWEEN @cc_start AND @cc_end, revenue - cost, 0)) AS STRING) AS cc_profit,
  CAST(SUM(IF(d BETWEEN @cp_start AND @cp_end, revenue - cost, 0)) AS STRING) AS cp_profit,
  CAST(SUM(IF(d BETWEEN @cc_start AND @cc_end, revenue, 0)) AS STRING)        AS cc_revenue,
  CAST(SUM(IF(d BETWEEN @cp_start AND @cp_end, revenue, 0)) AS STRING)        AS cp_revenue
FROM b
WHERE d BETWEEN LEAST(@p_start, @cp_start) AND GREATEST(@p_end, @cc_end)
GROUP BY name
HAVING p_trips > 0`

// Biggest changes: top 8 gains then top 8 falls (largest fall last).
const MOVERS = `
, g AS (
  SELECT IF(@dim = 'country', country, customer) AS name,
         SUM(IF(d BETWEEN @cc_start AND @cc_end, revenue - cost, 0)) AS cc_profit,
         SUM(IF(d BETWEEN @cp_start AND @cp_end, revenue - cost, 0)) AS cp_profit
  FROM b
  WHERE d BETWEEN @cp_start AND @cc_end
  GROUP BY name
  HAVING name <> 'Unmapped'
)
, x AS (SELECT name, cc_profit, cp_profit, cc_profit - cp_profit AS change FROM g WHERE cc_profit - cp_profit <> 0)
SELECT name, CAST(cc_profit AS STRING) AS cc_profit, CAST(cp_profit AS STRING) AS cp_profit,
       CAST(change AS STRING) AS change, dir, rk
FROM (
  SELECT *, 'up' AS dir, ROW_NUMBER() OVER (ORDER BY change DESC, name) AS rk FROM x WHERE change > 0
  UNION ALL
  SELECT *, 'down',      ROW_NUMBER() OVER (ORDER BY change ASC, name)  FROM x WHERE change < 0
) WHERE rk <= 8
ORDER BY dir DESC, change DESC, name`

// ── Countries page ───────────────────────────────────────────────────────────

// Region filter over the base rows ('' = all regions). Filters trips, so a country that
// spans regions contributes only its trips in the selected region.
const REGION_FILTER = `
, f AS (
  SELECT * FROM b
  WHERE (@region = '' OR region = @region)
)`

// One row per country. main_region = region with the most period revenue for the country
// (ties broken by name so repeated loads are identical). Countries that only traded in the
// prior window (p_trips = 0, cp_trips > 0) are kept for the "Countries growing" denominator.
const COUNTRY_SUMMARY = REGION_FILTER + `
, per AS (
  SELECT
    country,
    SUM(IF(d BETWEEN @p_start  AND @p_end,  revenue, 0)) AS p_revenue,
    SUM(IF(d BETWEEN @p_start  AND @p_end,  cost,    0)) AS p_cost,
    COUNTIF(d BETWEEN @p_start AND @p_end)               AS p_trips,
    SUM(IF(d BETWEEN @cc_start AND @cc_end, revenue, 0)) AS cc_revenue,
    SUM(IF(d BETWEEN @cc_start AND @cc_end, cost,    0)) AS cc_cost,
    COUNTIF(d BETWEEN @cc_start AND @cc_end)             AS cc_trips,
    SUM(IF(d BETWEEN @cp_start AND @cp_end, revenue, 0)) AS cp_revenue,
    SUM(IF(d BETWEEN @cp_start AND @cp_end, cost,    0)) AS cp_cost,
    COUNTIF(d BETWEEN @cp_start AND @cp_end)             AS cp_trips
  FROM f
  WHERE d BETWEEN LEAST(@p_start, @cp_start) AND GREATEST(@p_end, @cc_end)
  GROUP BY country
)
, dom AS (
  SELECT country,
         ARRAY_AGG(region ORDER BY rv DESC, region LIMIT 1)[OFFSET(0)] AS main_region,
         ARRAY_TO_STRING(ARRAY_AGG(region ORDER BY rv DESC, region), '|') AS all_regions
  FROM (SELECT country, region, SUM(revenue) AS rv
        FROM f WHERE d BETWEEN @p_start AND @p_end
        GROUP BY country, region)
  GROUP BY country
)
SELECT per.country,
  CAST(per.p_revenue AS STRING) AS p_revenue, CAST(per.p_cost AS STRING) AS p_cost, per.p_trips,
  CAST(per.cc_revenue AS STRING) AS cc_revenue, CAST(per.cc_cost AS STRING) AS cc_cost, per.cc_trips,
  CAST(per.cp_revenue AS STRING) AS cp_revenue, CAST(per.cp_cost AS STRING) AS cp_cost, per.cp_trips,
  dom.main_region, dom.all_regions
FROM per LEFT JOIN dom USING (country)
WHERE per.p_trips > 0 OR per.cp_trips > 0
ORDER BY per.p_revenue - per.p_cost DESC, per.country`

const COUNTRY_MONTHLY = REGION_FILTER + `
SELECT CAST(m AS STRING) AS month, country,
       CAST(SUM(revenue) AS STRING) AS revenue, CAST(SUM(cost) AS STRING) AS cost, COUNT(*) AS trips
FROM f
WHERE d BETWEEN @p_start AND @p_end
GROUP BY month, country
ORDER BY country, month`

// ── Cities page ──────────────────────────────────────────────────────────────

// City = pickup service area, keyed by service_area_id (never the name). Trips with no
// service area group under sa_id -1, "(no service area)". A service area has one country
// and one region, so ANY_VALUE is exact.
const CITY_FILTER = `
, f AS (
  SELECT * FROM b
  WHERE (@region  = '' OR region  = @region)
    AND (@country = '' OR country = @country)
)`

const CITY_SUMMARY = CITY_FILTER + `
SELECT
  COALESCE(sa_id, -1)                                                  AS sa_id,
  COALESCE(ANY_VALUE(sa_name), '(no service area)')                    AS sa_name,
  ANY_VALUE(country)                                                   AS country,
  ANY_VALUE(region)                                                    AS region,
  CAST(SUM(IF(d BETWEEN @p_start  AND @p_end,  revenue, 0)) AS STRING) AS p_revenue,
  CAST(SUM(IF(d BETWEEN @p_start  AND @p_end,  cost,    0)) AS STRING) AS p_cost,
  COUNTIF(d BETWEEN @p_start AND @p_end)                               AS p_trips,
  CAST(SUM(IF(d BETWEEN @cc_start AND @cc_end, revenue, 0)) AS STRING) AS cc_revenue,
  CAST(SUM(IF(d BETWEEN @cc_start AND @cc_end, cost,    0)) AS STRING) AS cc_cost,
  COUNTIF(d BETWEEN @cc_start AND @cc_end)                             AS cc_trips,
  CAST(SUM(IF(d BETWEEN @cp_start AND @cp_end, revenue, 0)) AS STRING) AS cp_revenue,
  CAST(SUM(IF(d BETWEEN @cp_start AND @cp_end, cost,    0)) AS STRING) AS cp_cost,
  COUNTIF(d BETWEEN @cp_start AND @cp_end)                             AS cp_trips
FROM f
WHERE d BETWEEN LEAST(@p_start, @cp_start) AND GREATEST(@p_end, @cc_end)
GROUP BY 1
HAVING p_trips > 0 OR cp_trips > 0
ORDER BY SUM(IF(d BETWEEN @p_start AND @p_end, revenue - cost, 0)) DESC, sa_id`

// Flat (sa_id, month) rows; the endpoint aligns them to the period's month list.
const CITY_MONTHLY = CITY_FILTER + `
SELECT COALESCE(sa_id, -1) AS sa_id, CAST(m AS STRING) AS month,
       CAST(SUM(revenue) AS STRING) AS revenue, CAST(SUM(cost) AS STRING) AS cost, COUNT(*) AS trips
FROM f
WHERE d BETWEEN @p_start AND @p_end
GROUP BY 1, 2
ORDER BY 1, 2`

// ── Routes page ──────────────────────────────────────────────────────────────

// Route type (covers 100% of trips): 4 Ride hailing, 2 Airport → airport, 0 Airport → city,
// 1 City → airport, 3 City → city. A route is (pickup service area, route key): the zone route
// name as configured (directional — "JFK - X" and "X - JFK" are different routes), or for
// distance-priced transfers (route_name '-' or blank) '~' || pickup airport || '>' || drop-off
// airport. Ride Hailing has no fixed routes.
export const NO_CITY = -999
const ROUTE_FILTER = `
, f AS (
  SELECT *,
    CASE
      WHEN product_line = 'Ride Hailing'         THEN 4
      WHEN pu_airport <> '' AND do_airport <> '' THEN 2
      WHEN pu_airport <> ''                      THEN 0
      WHEN do_airport <> ''                      THEN 1
      ELSE 3 END                                                        AS route_type,
    IF(route_name NOT IN ('-', ''), route_name,
       CONCAT('~', pu_airport, '>', do_airport))                        AS route_key,
    route_name IN ('-', '')                                             AS is_distance_priced
  FROM b
  WHERE (@region  = '' OR region  = @region)
    AND (@country = '' OR country = @country)
    AND (@product = '' OR product_line = @product)
    AND (@city = ${NO_CITY} OR COALESCE(sa_id, -1) = @city)
)`

const ROUTE_TYPES = ROUTE_FILTER + `
SELECT route_type,
  CAST(SUM(IF(d BETWEEN @p_start  AND @p_end,  revenue, 0)) AS STRING) AS p_revenue,
  CAST(SUM(IF(d BETWEEN @p_start  AND @p_end,  cost,    0)) AS STRING) AS p_cost,
  COUNTIF(d BETWEEN @p_start AND @p_end)                               AS p_trips,
  CAST(SUM(IF(d BETWEEN @cc_start AND @cc_end, revenue, 0)) AS STRING) AS cc_revenue,
  CAST(SUM(IF(d BETWEEN @cc_start AND @cc_end, cost,    0)) AS STRING) AS cc_cost,
  CAST(SUM(IF(d BETWEEN @cp_start AND @cp_end, revenue, 0)) AS STRING) AS cp_revenue,
  CAST(SUM(IF(d BETWEEN @cp_start AND @cp_end, cost,    0)) AS STRING) AS cp_cost
FROM f
WHERE d BETWEEN LEAST(@p_start, @cp_start) AND GREATEST(@p_end, @cc_end)
GROUP BY route_type
HAVING p_trips > 0
ORDER BY route_type`

const ROUTE_TYPE_MONTHLY = ROUTE_FILTER + `
SELECT CAST(m AS STRING) AS month, route_type,
       CAST(SUM(revenue) AS STRING) AS revenue, CAST(SUM(cost) AS STRING) AS cost, COUNT(*) AS trips
FROM f
WHERE d BETWEEN @p_start AND @p_end
GROUP BY month, route_type
ORDER BY month, route_type`

// Per-route totals, ranks and the listing rule: top 500 by period revenue, or among the 100
// largest loss-makers. Ties are broken by (sa_id, route_key) so repeated loads are identical.
const ROUTE_RANKED = ROUTE_FILTER + `
, per AS (
  SELECT
    COALESCE(sa_id, -1)                                   AS sa_id,
    route_key,
    COALESCE(ANY_VALUE(sa_name), '(no service area)')     AS sa_name,
    ANY_VALUE(country)                                    AS country,
    ANY_VALUE(region)                                     AS region,
    LOGICAL_OR(is_distance_priced)                        AS is_distance_priced,
    SUM(IF(d BETWEEN @p_start  AND @p_end,  revenue, 0))  AS p_revenue,
    SUM(IF(d BETWEEN @p_start  AND @p_end,  cost,    0))  AS p_cost,
    COUNTIF(d BETWEEN @p_start AND @p_end)                AS p_trips,
    SUM(IF(d BETWEEN @cc_start AND @cc_end, revenue, 0))  AS cc_revenue,
    SUM(IF(d BETWEEN @cc_start AND @cc_end, cost,    0))  AS cc_cost,
    SUM(IF(d BETWEEN @cp_start AND @cp_end, revenue, 0))  AS cp_revenue,
    SUM(IF(d BETWEEN @cp_start AND @cp_end, cost,    0))  AS cp_cost
  FROM f
  WHERE route_type <> 4
    AND d BETWEEN LEAST(@p_start, @cp_start) AND GREATEST(@p_end, @cc_end)
  GROUP BY 1, 2
)
, ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (ORDER BY p_revenue DESC, sa_id, route_key)          AS rank_rev,
    ROW_NUMBER() OVER (ORDER BY p_revenue - p_cost ASC, sa_id, route_key)  AS rank_loss,
    ROW_NUMBER() OVER (ORDER BY p_revenue - p_cost DESC, sa_id, route_key) AS rank_p
  FROM per WHERE p_trips > 0
)
, tagged AS (
  SELECT *, (rank_rev <= 500 OR (rank_loss <= 100 AND p_revenue - p_cost < 0)) AS listed
  FROM ranked
)`

const ROUTES_LISTED = ROUTE_RANKED + `
SELECT sa_id, route_key, sa_name, country, region, is_distance_priced,
  CAST(p_revenue AS STRING) AS p_revenue, CAST(p_cost AS STRING) AS p_cost, p_trips,
  CAST(cc_revenue AS STRING) AS cc_revenue, CAST(cc_cost AS STRING) AS cc_cost,
  CAST(cp_revenue AS STRING) AS cp_revenue, CAST(cp_cost AS STRING) AS cp_cost,
  1 AS n_routes
FROM tagged WHERE listed
UNION ALL
SELECT -2, 'All other routes', '', '', '', CAST(NULL AS BOOL),
  CAST(SUM(p_revenue) AS STRING), CAST(SUM(p_cost) AS STRING), SUM(p_trips),
  CAST(SUM(cc_revenue) AS STRING), CAST(SUM(cc_cost) AS STRING),
  CAST(SUM(cp_revenue) AS STRING), CAST(SUM(cp_cost) AS STRING),
  COUNT(*)
FROM tagged WHERE NOT listed
HAVING COUNT(*) > 0`

// Computed over all routes, not only the listed ones.
const ROUTE_KPIS = ROUTE_RANKED + `
SELECT
  COUNT(*)                                                                  AS routes,
  COUNTIF(p_revenue - p_cost < 0)                                           AS loss_routes,
  CAST(COALESCE(SUM(IF(p_revenue - p_cost < 0, p_revenue - p_cost, 0)), 0) AS STRING) AS loss_total,
  CAST(COALESCE(SUM(p_revenue - p_cost), 0) AS STRING)                      AS transfer_profit,
  CAST(COALESCE(SUM(IF(rank_p = 1, p_revenue - p_cost, 0)), 0) AS STRING)   AS top1_profit,
  ARRAY_AGG(IF(rank_p = 1, CONCAT(CAST(sa_id AS STRING), '|', route_key), NULL) IGNORE NULLS LIMIT 1)[SAFE_OFFSET(0)] AS top1_key,
  CAST(COALESCE(SUM(IF(rank_p <= 50, p_revenue - p_cost, 0)), 0) AS STRING) AS top50_profit,
  CAST(COALESCE(SUM(IF(is_distance_priced, p_revenue - p_cost, 0)), 0) AS STRING) AS dp_profit,
  COALESCE(SUM(IF(is_distance_priced, p_trips, 0)), 0)                      AS dp_trips,
  COALESCE(SUM(p_trips), 0)                                                 AS transfer_trips
FROM ranked`

// Flat (sa_id, route_key, month) rows for listed routes; the endpoint aligns them.
const ROUTE_MONTHLY = ROUTE_RANKED + `
, listed AS (SELECT sa_id, route_key FROM tagged WHERE listed)
SELECT COALESCE(f.sa_id, -1) AS sa_id, f.route_key, CAST(f.m AS STRING) AS month,
       CAST(SUM(f.revenue) AS STRING) AS revenue, CAST(SUM(f.cost) AS STRING) AS cost, COUNT(*) AS trips
FROM f JOIN listed ON COALESCE(f.sa_id, -1) = listed.sa_id AND f.route_key = listed.route_key
WHERE f.route_type <> 4 AND f.d BETWEEN @p_start AND @p_end
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3`

// City chip: the selected service area's name and country (from the same pinned rows).
const CITY_INFO = `
SELECT ANY_VALUE(sa_name) AS sa_name, ANY_VALUE(country) AS country
FROM b WHERE COALESCE(sa_id, -1) = @city`

// ── Customers page ───────────────────────────────────────────────────────────

// Customer = customer group of the ordering fleet. Attributes are resolved per group on the
// UNFILTERED base (which for this page always starts at CUSTOMER_HISTORY_START), from the
// (type, team, first trade) combination with the most revenue, so they never change with
// filters or period. First trade = LEAST(COALESCE(dim, first seen), first seen); a trip is
// "new" when its month is within 12 months of that.
export const CUSTOMER_HISTORY_START: Ymd = '2024-01-01'
const CUSTOMER_ATTR = `
, cust_attr AS (
  SELECT customer,
    ARRAY_AGG(COALESCE(NULLIF(TRIM(customer_type_raw), ''), 'Unassigned')
      ORDER BY rv DESC, customer_type_raw, team_raw, first_trade_raw LIMIT 1)[OFFSET(0)] AS customer_type,
    ARRAY_AGG(COALESCE(NULLIF(TRIM(team_raw), ''), 'Unassigned')
      ORDER BY rv DESC, customer_type_raw, team_raw, first_trade_raw LIMIT 1)[OFFSET(0)] AS team,
    MIN(SAFE.PARSE_DATE('%Y%m', first_trade_raw))                                  AS dim_first_trade
  FROM (SELECT customer, customer_type_raw, team_raw, first_trade_raw, SUM(revenue) AS rv
        FROM b GROUP BY 1, 2, 3, 4)
  GROUP BY customer
)
, first_seen AS (SELECT customer, MIN(m) AS first_seen_month FROM b GROUP BY customer)
, ca AS (
  SELECT a.customer, a.customer_type, a.team,
         LEAST(COALESCE(a.dim_first_trade, s.first_seen_month), s.first_seen_month) AS first_trade_month
  FROM cust_attr a JOIN first_seen s USING (customer)
)`
const CUSTOMER_FILTER = CUSTOMER_ATTR + `
, f AS (
  SELECT b.*, ca.customer_type, ca.team, ca.first_trade_month,
         DATE_DIFF(b.m, ca.first_trade_month, MONTH) BETWEEN 0 AND 11 AS is_new
  FROM b JOIN ca USING (customer)
  WHERE (@region  = '' OR b.region       = @region)
    AND (@country = '' OR b.country      = @country)
    AND (@product = '' OR b.product_line = @product)
    AND (@team    = '' OR ca.team          = @team)
    AND (@ctype   = '' OR ca.customer_type = @ctype)
)`

const CUSTOMER_SUMMARY = CUSTOMER_FILTER + `
SELECT customer,
  ANY_VALUE(customer_type)                                                           AS customer_type,
  ANY_VALUE(team)                                                                    AS team,
  CAST(ANY_VALUE(first_trade_month) AS STRING)                                       AS first_trade_month,
  CAST(SUM(IF(d BETWEEN @p_start  AND @p_end,  revenue, 0)) AS STRING)               AS p_revenue,
  CAST(SUM(IF(d BETWEEN @p_start  AND @p_end,  cost,    0)) AS STRING)               AS p_cost,
  COUNTIF(d BETWEEN @p_start AND @p_end)                                             AS p_trips,
  CAST(SUM(IF(d BETWEEN @p_start  AND @p_end AND is_new, revenue - cost, 0)) AS STRING) AS p_new_profit,
  CAST(SUM(IF(d BETWEEN @cc_start AND @cc_end, revenue, 0)) AS STRING)               AS cc_revenue,
  CAST(SUM(IF(d BETWEEN @cc_start AND @cc_end, cost,    0)) AS STRING)               AS cc_cost,
  CAST(SUM(IF(d BETWEEN @cp_start AND @cp_end, revenue, 0)) AS STRING)               AS cp_revenue,
  CAST(SUM(IF(d BETWEEN @cp_start AND @cp_end, cost,    0)) AS STRING)               AS cp_cost,
  COUNTIF(d BETWEEN @cp_start AND @cp_end)                                           AS cp_trips
FROM f
WHERE d BETWEEN LEAST(@p_start, @cp_start) AND GREATEST(@p_end, @cc_end)
GROUP BY customer
HAVING p_trips > 0 OR cp_trips > 0
ORDER BY SUM(IF(d BETWEEN @p_start AND @p_end, revenue - cost, 0)) DESC, customer`

// Flat (customer, month) rows; the server aligns them to the period's month list.
const CUSTOMER_MONTHLY = CUSTOMER_FILTER + `
SELECT customer, CAST(m AS STRING) AS month,
       CAST(SUM(revenue) AS STRING) AS revenue, CAST(SUM(cost) AS STRING) AS cost, COUNT(*) AS trips
FROM f WHERE d BETWEEN @p_start AND @p_end
GROUP BY 1, 2
ORDER BY 1, 2`

const NEW_EXISTING_MONTHLY = CUSTOMER_FILTER + `
SELECT CAST(m AS STRING) AS month, is_new,
       CAST(SUM(revenue) AS STRING) AS revenue, CAST(SUM(cost) AS STRING) AS cost, COUNT(*) AS trips,
       COUNT(DISTINCT customer) AS customers
FROM f
WHERE d BETWEEN @p_start AND @p_end
GROUP BY month, is_new
ORDER BY month, is_new`

const TEAM_SUMMARY = CUSTOMER_FILTER + `
SELECT team,
  COUNT(DISTINCT IF(d BETWEEN @p_start AND @p_end AND customer <> 'Unmapped', customer, NULL)) AS customers,
  CAST(SUM(IF(d BETWEEN @p_start  AND @p_end,  revenue, 0)) AS STRING) AS p_revenue,
  CAST(SUM(IF(d BETWEEN @p_start  AND @p_end,  cost,    0)) AS STRING) AS p_cost,
  COUNTIF(d BETWEEN @p_start AND @p_end)                               AS p_trips,
  CAST(SUM(IF(d BETWEEN @cc_start AND @cc_end, revenue, 0)) AS STRING) AS cc_revenue,
  CAST(SUM(IF(d BETWEEN @cc_start AND @cc_end, cost,    0)) AS STRING) AS cc_cost,
  CAST(SUM(IF(d BETWEEN @cp_start AND @cp_end, revenue, 0)) AS STRING) AS cp_revenue,
  CAST(SUM(IF(d BETWEEN @cp_start AND @cp_end, cost,    0)) AS STRING) AS cp_cost
FROM f
WHERE d BETWEEN LEAST(@p_start, @cp_start) AND GREATEST(@p_end, @cc_end)
GROUP BY team
HAVING p_trips > 0
ORDER BY team`

// Top 8 customers × top 8 countries (period profit), the rest in "All other …". Unmapped
// customer/country have no rank and fall into "all other", so the grid sums to the page total.
const CUSTOMER_COUNTRY_GRID = CUSTOMER_FILTER + `
, per AS (SELECT * FROM f WHERE d BETWEEN @p_start AND @p_end)
, tk  AS (SELECT customer, ROW_NUMBER() OVER (ORDER BY SUM(revenue - cost) DESC, customer) AS ki
          FROM per WHERE customer <> 'Unmapped' GROUP BY customer)
, tc  AS (SELECT country,  ROW_NUMBER() OVER (ORDER BY SUM(revenue - cost) DESC, country) AS ci
          FROM per WHERE country  <> 'Unmapped' GROUP BY country)
SELECT
  IF(tk.ki <= 8, tk.ki, 9)                                   AS ki,
  IF(tc.ci <= 8, tc.ci, 9)                                   AS ci,
  IF(tk.ki <= 8, per.customer, 'All other customers')        AS customer,
  IF(tc.ci <= 8, per.country,  'All other countries')        AS country,
  CAST(SUM(revenue) AS STRING) AS revenue, CAST(SUM(cost) AS STRING) AS cost, COUNT(*) AS trips
FROM per LEFT JOIN tk USING (customer) LEFT JOIN tc USING (country)
GROUP BY 1, 2, 3, 4
ORDER BY ki, ci`

// Every customer group's resolved attributes (unfiltered), whether it has trips in the period
// under the geography/product filters (for the Team and Type dropdowns), and the number of
// customer groups in the dimension.
const customerAttrs = (asOfMs: number) => CUSTOMER_ATTR + `
, fx AS (
  SELECT customer, COUNTIF(d BETWEEN @p_start AND @p_end) AS p_trips FROM b
  WHERE (@region = '' OR region = @region) AND (@country = '' OR country = @country)
    AND (@product = '' OR product_line = @product)
  GROUP BY customer
)
SELECT ca.customer, ca.customer_type, ca.team,
  CAST(ca.first_trade_month AS STRING) AS first_trade_month,
  CAST(s.first_seen_month AS STRING)   AS first_seen_month,
  CAST(a.dim_first_trade AS STRING)    AS dim_first_trade,
  COALESCE(fx.p_trips, 0)              AS p_trips,
  (SELECT COUNT(DISTINCT customer_name)
     FROM \`${P}.dim.dim_fleet_as_customer\` FOR SYSTEM_TIME AS OF TIMESTAMP '${bqTimestampText(asOfMs)}') AS customer_groups
FROM ca JOIN first_seen s USING (customer) JOIN cust_attr a USING (customer) LEFT JOIN fx USING (customer)
ORDER BY ca.customer`

export type QueryName =
  | 'kpi_totals' | 'mtd_same_days' | 'monthly_by_product_line' | 'monthly_by_region'
  | 'by_product_line' | 'by_region' | 'movers_country' | 'movers_customer'
  | 'country_summary' | 'country_monthly'
  | 'city_summary' | 'city_monthly'
  | 'route_types' | 'route_type_monthly' | 'routes_listed' | 'route_kpis' | 'route_monthly' | 'city_info'
  | 'customer_summary' | 'customer_monthly' | 'new_existing_monthly' | 'team_summary' | 'customer_country_grid'
  | 'customer_attrs'

export function componentSql(name: QueryName, asOfMs: number): string {
  const b = baseCte(asOfMs)
  switch (name) {
    case 'kpi_totals':              return b + KPI_TOTALS
    case 'mtd_same_days':           return b + MTD_SAME_DAYS
    case 'monthly_by_product_line': return b + monthlyBy('product_line')
    case 'monthly_by_region':       return b + monthlyBy('region')
    case 'by_product_line':         return b + breakdownBy('product_line')
    case 'by_region':               return b + breakdownBy('region')
    case 'movers_country':
    case 'movers_customer':         return b + MOVERS
    case 'country_summary':         return b + COUNTRY_SUMMARY
    case 'country_monthly':         return b + COUNTRY_MONTHLY
    case 'city_summary':            return b + CITY_SUMMARY
    case 'city_monthly':            return b + CITY_MONTHLY
    case 'route_types':             return b + ROUTE_TYPES
    case 'route_type_monthly':      return b + ROUTE_TYPE_MONTHLY
    case 'routes_listed':           return b + ROUTES_LISTED
    case 'route_kpis':              return b + ROUTE_KPIS
    case 'route_monthly':           return b + ROUTE_MONTHLY
    case 'city_info':               return b + CITY_INFO
    case 'customer_summary':        return b + CUSTOMER_SUMMARY
    case 'customer_monthly':        return b + CUSTOMER_MONTHLY
    case 'new_existing_monthly':    return b + NEW_EXISTING_MONTHLY
    case 'team_summary':            return b + TEAM_SUMMARY
    case 'customer_country_grid':   return b + CUSTOMER_COUNTRY_GRID
    case 'customer_attrs':          return b + customerAttrs(asOfMs)
  }
}

// ── Typed parameters ──────────────────────────────────────────────────────────

export type QueryParams = {
  as_of_ms: number
  base_start: Ymd
  p_start: Ymd; p_end: Ymd
  cc_start: Ymd; cc_end: Ymd
  cp_start: Ymd; cp_end: Ymd
  dim?: 'country' | 'customer'
  region?: string // '' = all regions; otherwise a display label from REGIONS
  country?: string // '' = all countries (Cities page)
  product?: string // '' = all product lines (Routes page)
  city?: number    // service-area id; NO_CITY = no city filter (Routes page)
  team?: string    // '' = all teams (Customers page)
  ctype?: string   // '' = all customer types (Customers page)
}

type BqParam = { name: string; parameterType: { type: string }; parameterValue: { value: string } }

export function bqParams(p: QueryParams): BqParam[] {
  const date = (name: string, value: Ymd): BqParam =>
    ({ name, parameterType: { type: 'DATE' }, parameterValue: { value } })
  const out: BqParam[] = [
    { name: 'as_of', parameterType: { type: 'TIMESTAMP' }, parameterValue: { value: bqTimestampText(p.as_of_ms) } },
    date('base_start', p.base_start),
    date('p_start', p.p_start), date('p_end', p.p_end),
    date('cc_start', p.cc_start), date('cc_end', p.cc_end),
    date('cp_start', p.cp_start), date('cp_end', p.cp_end),
  ]
  if (p.dim) out.push({ name: 'dim', parameterType: { type: 'STRING' }, parameterValue: { value: p.dim } })
  if (p.region !== undefined) out.push({ name: 'region', parameterType: { type: 'STRING' }, parameterValue: { value: p.region } })
  if (p.country !== undefined) out.push({ name: 'country', parameterType: { type: 'STRING' }, parameterValue: { value: p.country } })
  if (p.product !== undefined) out.push({ name: 'product', parameterType: { type: 'STRING' }, parameterValue: { value: p.product } })
  if (p.team !== undefined) out.push({ name: 'team', parameterType: { type: 'STRING' }, parameterValue: { value: p.team } })
  if (p.ctype !== undefined) out.push({ name: 'ctype', parameterType: { type: 'STRING' }, parameterValue: { value: p.ctype } })
  if (p.city !== undefined) out.push({ name: 'city', parameterType: { type: 'INT64' }, parameterValue: { value: String(p.city) } })
  return out
}

/**
 * Test-only: replaces @params with literals so a query can be run in a console that
 * does not accept query parameters. Never used by the edge function.
 */
export function inlineParams(sql: string, p: QueryParams): string {
  const map: Record<string, string> = {}
  for (const x of bqParams(p)) {
    const v = x.parameterValue.value
    map[x.name] = x.parameterType.type === 'INT64' ? v
      : x.parameterType.type === 'DATE' ? `DATE '${v}'`
      : x.parameterType.type === 'TIMESTAMP' ? `TIMESTAMP '${v}'` : `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  }
  return sql.replace(/@([a-z_]+)/g, (m, k) => map[k] ?? m)
}
