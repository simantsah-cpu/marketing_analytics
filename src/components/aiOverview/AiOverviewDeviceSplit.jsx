/**
 * AiOverviewDeviceSplit.jsx — Section C: Device split bars.
 * Three horizontal bars (text / table / price snippets) showing mobile vs desktop share.
 * Data-driven callout when desktop share of table snippets is significantly higher than text.
 */

function SplitBar({ label, mobilePct, desktopPct, total }) {
  const tealColor  = '#1D9E75'
  const blueColor  = '#378ADD'
  const otherColor = '#E2E8F0'
  const otherPct   = 100 - mobilePct - desktopPct

  if (total === 0) {
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 6 }}>{label} — no data</div>
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#0A2540' }}>{label}</span>
        <span style={{ fontSize: 10, color: '#94A3B8' }}>{mobilePct}% mobile · {desktopPct}% desktop</span>
      </div>
      <div style={{ display: 'flex', height: 20, borderRadius: 6, overflow: 'hidden', background: '#F8FAFC' }}>
        {mobilePct > 0 && (
          <div style={{ width: `${mobilePct}%`, background: tealColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {mobilePct >= 12 && <span style={{ fontSize: 9, fontWeight: 700, color: '#fff' }}>{mobilePct}%</span>}
          </div>
        )}
        {desktopPct > 0 && (
          <div style={{ width: `${desktopPct}%`, background: blueColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {desktopPct >= 12 && <span style={{ fontSize: 9, fontWeight: 700, color: '#fff' }}>{desktopPct}%</span>}
          </div>
        )}
        {otherPct > 0 && (
          <div style={{ width: `${otherPct}%`, background: otherColor }} />
        )}
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 4 }}>
        <span style={{ fontSize: 10, color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: tealColor, display: 'inline-block' }} />
          Mobile
        </span>
        <span style={{ fontSize: 10, color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: blueColor, display: 'inline-block' }} />
          Desktop
        </span>
        {otherPct > 0 && (
          <span style={{ fontSize: 10, color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: otherColor, display: 'inline-block' }} />
            Tablet
          </span>
        )}
      </div>
    </div>
  )
}

export default function AiOverviewDeviceSplit({ deviceData }) {
  const { text, table, price } = deviceData || {}

  // Show callout when desktop share of table snippets is > 15pp higher than text snippets
  const textDesktopPct  = text?.desktopPct  ?? 0
  const tableDesktopPct = table?.desktopPct ?? 0
  const showCallout = table?.total > 0 && (tableDesktopPct - textDesktopPct) > 15

  return (
    <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '18px 22px', marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#0A2540', marginBottom: 2 }}>Device Split by Snippet Type</div>
        <div style={{ fontSize: 10, color: '#94A3B8' }}>Mobile vs desktop breakdown for each content type</div>
      </div>

      <SplitBar
        label="Text snippets"
        mobilePct={text?.mobilePct ?? 0}
        desktopPct={text?.desktopPct ?? 0}
        total={text?.total ?? 0}
      />
      <SplitBar
        label="Table snippets"
        mobilePct={table?.mobilePct ?? 0}
        desktopPct={table?.desktopPct ?? 0}
        total={table?.total ?? 0}
      />
      <SplitBar
        label="Price snippets"
        mobilePct={price?.mobilePct ?? 0}
        desktopPct={price?.desktopPct ?? 0}
        total={price?.total ?? 0}
      />

      {showCallout && (
        <div style={{
          marginTop: 8,
          padding: '12px 14px',
          background: '#EFF6FF',
          border: '1px solid #BFDBFE',
          borderLeft: '3px solid #378ADD',
          borderRadius: 8,
          fontSize: 12,
          color: '#1e40af',
          lineHeight: 1.55,
        }}>
          <strong>📊 Desktop insight:</strong>{' '}
          Desktop users are <strong>{tableDesktopPct}%</strong> of table snippet clicks — {Math.round(tableDesktopPct - textDesktopPct)}pp higher than their share for text snippets.
          Build transport comparison tables for wider desktop layouts with more pricing columns.
        </div>
      )}
    </div>
  )
}
