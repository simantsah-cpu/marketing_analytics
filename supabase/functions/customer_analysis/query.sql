-- ============================================================================
-- customer_analysis — Elife ride dispatch customer & cohort analytics
-- ----------------------------------------------------------------------------
-- Target      : BigQuery Standard SQL, project elife-data-warehouse-prod
-- Parameters  : @start_date DATE, @end_date DATE   (parameterMode: NAMED)
-- Returns     : ONE row, EIGHT STRING columns, each a JSON document.
--               Parse each with JSON.parse() on the client.
-- Scan cost   : ~1 scan of ads_ride_dispatch_v from 2019-01-01 to @end_date.
--               The date selector does NOT reduce scan cost, because cohort
--               assignment requires full history. See "cost" note in the guide.
-- ============================================================================
WITH
params AS (
  SELECT
    @start_date                                                        AS win_start,
    LEAST(@end_date, CURRENT_DATE())                                   AS win_end,
    DATE_TRUNC(@start_date, MONTH)                                     AS win_start_month,
    DATE_SUB(DATE_TRUNC(@start_date, MONTH), INTERVAL 1 MONTH)         AS lag_floor,
    DATE '2019-01-01'                                                  AS history_floor
),

-- ── ONE scan, deduplicated to ride grain ────────────────────────────────────
-- INVARIANT: the source view is one row per TRIP LEG, not per ride.
--   revenue  -> ANY_VALUE  (elife_amount_usd_by_trip is replicated on each leg)
--   cost     -> SUM        (each leg carries a genuinely separate payout)
-- Summing revenue across raw rows overstates it by ~15-20%.
base AS (
  SELECT
    v.ride_id,
    MIN(v.pickup_date)                                     AS pickup_date,
    ANY_VALUE(v.partner_id)                                AS partner_id,
    ANY_VALUE(v.partner_name)                              AS partner_name,
    ANY_VALUE(v.from_fleet_id_as_customer)                 AS account_id,
    ANY_VALUE(v.passenger_id)                              AS passenger_id,
    MAX(IF(v.dispatch_stat = 'At destination', 1, 0))      AS is_completed,
    MAX(IF(v.ride_stat = 'Cancelled', 1, 0))               AS is_cancelled,
    MAX(v.has_complaint)                                   AS has_complaint,
    CAST(ANY_VALUE(v.elife_amount_usd_by_trip) AS FLOAT64) AS revenue,
    CAST(SUM(v.dispatch_amount_net_usd)        AS FLOAT64) AS cost
  FROM `elife-data-warehouse-prod.ads.ads_ride_dispatch_v` v, params p
  WHERE v.pickup_date BETWEEN p.history_floor AND p.win_end
  GROUP BY v.ride_id
),

acct_first AS (
  SELECT account_id, DATE_TRUNC(MIN(pickup_date), MONTH) AS first_month
  FROM base WHERE is_completed = 1 GROUP BY account_id
),
partner_first AS (
  SELECT partner_id, DATE_TRUNC(MIN(pickup_date), MONTH) AS first_month
  FROM base WHERE is_completed = 1 GROUP BY partner_id
),

rides AS (
  SELECT b.* FROM base b, params p
  WHERE b.pickup_date BETWEEN p.win_start AND p.win_end
),
comp AS (SELECT * FROM rides WHERE is_completed = 1),

act_ext AS (
  SELECT b.account_id, DATE_TRUNC(b.pickup_date, MONTH) AS am,
         COUNT(*) AS rides, SUM(b.revenue) AS revenue
  FROM base b, params p
  WHERE b.is_completed = 1 AND b.pickup_date >= p.lag_floor AND b.pickup_date <= p.win_end
  GROUP BY 1, 2
),
acct_activity AS (
  SELECT a.* FROM act_ext a, params p WHERE a.am >= p.win_start_month
),

kpis AS (
  SELECT TO_JSON_STRING(STRUCT(
    COUNT(*)                                                     AS booked_rides,
    COUNTIF(is_completed = 1)                                    AS completed_rides,
    COUNTIF(is_cancelled = 1)                                    AS cancelled_rides,
    ROUND(SUM(IF(is_completed=1, revenue, 0)), 2)                AS revenue,
    ROUND(SUM(IF(is_completed=1, revenue - cost, 0)), 2)         AS margin,
    ROUND(SAFE_DIVIDE(SUM(IF(is_completed=1, revenue-cost, 0)),
                      SUM(IF(is_completed=1, revenue, 0)))*100,2) AS margin_pct,
    ROUND(SAFE_DIVIDE(COUNTIF(is_cancelled=1), COUNT(*))*100, 2) AS cancel_pct,
    ROUND(SAFE_DIVIDE(SUM(IF(is_completed=1, revenue, 0)),
                      COUNTIF(is_completed=1)), 2)               AS aov,
    COUNT(DISTINCT IF(is_completed=1, account_id, NULL))         AS accounts_completed,
    COUNT(DISTINCT account_id)                                   AS accounts_booked,
    COUNT(DISTINCT IF(is_completed=1, partner_id, NULL))         AS partners_completed,
    COUNT(DISTINCT partner_id)                                   AS partners_booked
  )) AS j FROM rides
),

monthly AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(m, booked, completed, cancel_pct,
           complaint_pct, revenue, margin, margin_pct, aov) ORDER BY m)) AS j
  FROM (
    SELECT FORMAT_DATE('%Y-%m', DATE_TRUNC(pickup_date, MONTH)) AS m,
      COUNT(*) AS booked,
      COUNTIF(is_completed=1) AS completed,
      ROUND(SAFE_DIVIDE(COUNTIF(is_cancelled=1), COUNT(*))*100, 2) AS cancel_pct,
      ROUND(SAFE_DIVIDE(COUNTIF(is_completed=1 AND has_complaint=1),
                        COUNTIF(is_completed=1))*100, 2) AS complaint_pct,
      ROUND(SUM(IF(is_completed=1, revenue, 0)), 2) AS revenue,
      ROUND(SUM(IF(is_completed=1, revenue-cost, 0)), 2) AS margin,
      ROUND(SAFE_DIVIDE(SUM(IF(is_completed=1, revenue-cost, 0)),
                        SUM(IF(is_completed=1, revenue, 0)))*100, 2) AS margin_pct,
      ROUND(SAFE_DIVIDE(SUM(IF(is_completed=1, revenue, 0)),
                        COUNTIF(is_completed=1)), 2) AS aov
    FROM rides GROUP BY m
  )
),

account_cohort AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(cohort, mi, accounts, rides, revenue)
           ORDER BY cohort, mi)) AS j
  FROM (
    SELECT
      IF(f.first_month < p.win_start_month, '__PRE__',
         FORMAT_DATE('%Y-%m', f.first_month))                    AS cohort,
      IF(f.first_month < p.win_start_month,
         DATE_DIFF(a.am, p.win_start_month, MONTH),
         DATE_DIFF(a.am, f.first_month, MONTH))                  AS mi,
      COUNT(DISTINCT a.account_id) AS accounts,
      SUM(a.rides)                 AS rides,
      ROUND(SUM(a.revenue), 2)     AS revenue
    FROM acct_activity a JOIN acct_first f USING (account_id), params p
    GROUP BY cohort, mi
    HAVING mi >= 0
  )
),

partner_activity AS (
  SELECT partner_id, DATE_TRUNC(pickup_date, MONTH) AS am,
         COUNT(*) AS rides, SUM(revenue) AS revenue
  FROM comp GROUP BY 1, 2
),
partner_cohort AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(cohort, mi, partners, rides, revenue)
           ORDER BY cohort, mi)) AS j
  FROM (
    SELECT
      IF(f.first_month < p.win_start_month, '__PRE__',
         FORMAT_DATE('%Y-%m', f.first_month))                    AS cohort,
      IF(f.first_month < p.win_start_month,
         DATE_DIFF(a.am, p.win_start_month, MONTH),
         DATE_DIFF(a.am, f.first_month, MONTH))                  AS mi,
      COUNT(DISTINCT a.partner_id) AS partners,
      SUM(a.rides)             AS rides,
      ROUND(SUM(a.revenue), 2) AS revenue
    FROM partner_activity a JOIN partner_first f USING (partner_id), params p
    GROUP BY cohort, mi
    HAVING mi >= 0
  )
),

flow_base AS (
  SELECT a.account_id, a.am, a.revenue, f.first_month,
    LAG(a.revenue) OVER (PARTITION BY a.account_id ORDER BY a.am) AS prev_rev,
    DATE_DIFF(a.am, LAG(a.am) OVER (PARTITION BY a.account_id ORDER BY a.am),
              MONTH)                                              AS gap
  FROM act_ext a JOIN acct_first f USING (account_id)
),
flow AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(m, active, new_accounts, retained,
           reactivated, revenue, new_revenue, expansion, contraction)
           ORDER BY m)) AS j
  FROM (
    SELECT FORMAT_DATE('%Y-%m', fb.am) AS m,
      COUNT(DISTINCT fb.account_id) AS active,
      COUNT(DISTINCT IF(fb.first_month = fb.am, fb.account_id, NULL)) AS new_accounts,
      COUNT(DISTINCT IF(fb.first_month < fb.am AND fb.gap = 1,
                        fb.account_id, NULL)) AS retained,
      COUNT(DISTINCT IF(fb.first_month < fb.am AND (fb.gap > 1 OR fb.gap IS NULL),
                        fb.account_id, NULL)) AS reactivated,
      ROUND(SUM(fb.revenue), 2) AS revenue,
      ROUND(SUM(IF(fb.first_month = fb.am, fb.revenue, 0)), 2) AS new_revenue,
      ROUND(SUM(IF(fb.first_month < fb.am AND fb.gap = 1 AND fb.revenue > fb.prev_rev,
                   fb.revenue - fb.prev_rev, 0)), 2) AS expansion,
      ROUND(SUM(IF(fb.first_month < fb.am AND fb.gap = 1 AND fb.revenue < fb.prev_rev,
                   fb.prev_rev - fb.revenue, 0)), 2) AS contraction
    FROM flow_base fb, params p
    WHERE fb.am >= p.win_start_month
    GROUP BY m
  )
),

acct_totals AS (
  SELECT c.account_id,
    COUNT(*) AS rides,
    SUM(c.revenue) AS revenue,
    COUNT(DISTINCT DATE_TRUNC(c.pickup_date, MONTH)) AS months_active,
    DATE_DIFF((SELECT win_end FROM params), MAX(c.pickup_date), DAY) AS recency_days
  FROM comp c GROUP BY c.account_id
),
tiers AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(tier, accounts, revenue, pct_revenue,
           rides, avg_months_active, dormant_90d) ORDER BY tier)) AS j
  FROM (
    SELECT
      CASE WHEN revenue >= 1000000 THEN 'A. $1M+'
           WHEN revenue >=  100000 THEN 'B. $100k-1M'
           WHEN revenue >=   10000 THEN 'C. $10k-100k'
           WHEN revenue >=    1000 THEN 'D. $1k-10k'
           ELSE                         'E. <$1k' END AS tier,
      COUNT(*)                 AS accounts,
      ROUND(SUM(revenue), 2)   AS revenue,
      ROUND(SUM(revenue) / SUM(SUM(revenue)) OVER () * 100, 2) AS pct_revenue,
      SUM(rides)               AS rides,
      ROUND(AVG(months_active), 1) AS avg_months_active,
      COUNTIF(recency_days > 90)   AS dormant_90d
    FROM acct_totals GROUP BY tier
  )
),

partners AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(partner_name, accounts, booked, completed,
           cancelled, cancel_pct, complaint_pct, aov, revenue, margin, margin_pct)
           ORDER BY revenue DESC)) AS j
  FROM (
    SELECT partner_name,
      COUNT(DISTINCT account_id) AS accounts,
      COUNT(*)                   AS booked,
      COUNTIF(is_completed = 1)  AS completed,
      COUNTIF(is_cancelled = 1)  AS cancelled,
      ROUND(SAFE_DIVIDE(COUNTIF(is_cancelled=1), COUNT(*))*100, 2) AS cancel_pct,
      ROUND(SAFE_DIVIDE(COUNTIF(is_completed=1 AND has_complaint=1),
                        COUNTIF(is_completed=1))*100, 2) AS complaint_pct,
      ROUND(SAFE_DIVIDE(SUM(IF(is_completed=1, revenue, 0)),
                        COUNTIF(is_completed=1)), 2) AS aov,
      ROUND(SUM(IF(is_completed=1, revenue, 0)), 2) AS revenue,
      ROUND(SUM(IF(is_completed=1, revenue - cost, 0)), 2) AS margin,
      ROUND(SAFE_DIVIDE(SUM(IF(is_completed=1, revenue-cost, 0)),
                        SUM(IF(is_completed=1, revenue, 0)))*100, 2) AS margin_pct
    FROM rides GROUP BY partner_name
    ORDER BY revenue DESC LIMIT 25
  )
),

person AS (
  SELECT cu.person_id, COUNT(*) AS n, SUM(c.revenue) AS revenue
  FROM comp c
  JOIN `elife-data-warehouse-prod.ods.ride_customer` cu ON c.passenger_id = cu.id
  WHERE cu.person_id IS NOT NULL
  GROUP BY cu.person_id
),
passengers AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(bucket, customers, pct_customers,
           rides, revenue, pct_revenue, avg_ltv) ORDER BY sort_key)) AS j
  FROM (
    SELECT
      CASE WHEN n = 1 THEN '1 ride'    WHEN n = 2 THEN '2 rides'
           WHEN n <= 4 THEN '3-4 rides' WHEN n <= 9 THEN '5-9 rides'
           ELSE '10+ rides' END AS bucket,
      MIN(n)   AS sort_key,
      COUNT(*) AS customers,
      ROUND(COUNT(*) / SUM(COUNT(*)) OVER () * 100, 3) AS pct_customers,
      SUM(n)   AS rides,
      ROUND(SUM(revenue), 2) AS revenue,
      ROUND(SUM(revenue) / SUM(SUM(revenue)) OVER () * 100, 2) AS pct_revenue,
      ROUND(AVG(revenue), 2) AS avg_ltv
    FROM person GROUP BY bucket
  )
)

SELECT
  (SELECT j FROM kpis)           AS kpis,
  (SELECT j FROM monthly)        AS monthly,
  (SELECT j FROM account_cohort) AS account_cohort,
  (SELECT j FROM partner_cohort) AS partner_cohort,
  (SELECT j FROM flow)           AS flow,
  (SELECT j FROM tiers)          AS tiers,
  (SELECT j FROM partners)       AS partners,
  (SELECT j FROM passengers)     AS passengers
