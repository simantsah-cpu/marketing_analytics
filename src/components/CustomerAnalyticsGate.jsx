/**
 * CustomerAnalyticsGate
 * Password gate for the Customer Analytics tab.
 * Verifies via SHA-256 hash — plaintext never stored in source.
 * Auth persists in sessionStorage (clears on browser close).
 */
import { useState } from 'react'

const CORRECT_HASH = 'c124d5e75c4650b60423b78116354e8d97ae08437eee0ba6ac78bef2d6e4cb0a'
const SESSION_KEY  = 'ca_auth_v1'

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export default function CustomerAnalyticsGate({ children }) {
  const [authed,  setAuthed]  = useState(() => sessionStorage.getItem(SESSION_KEY) === '1')
  const [value,   setValue]   = useState('')
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const [visible, setVisible] = useState(false)
  const [shaking, setShaking] = useState(false)

  if (authed) return children

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!value.trim()) return
    setLoading(true)
    setError('')
    const hash = await sha256(value)
    setLoading(false)
    if (hash === CORRECT_HASH) {
      sessionStorage.setItem(SESSION_KEY, '1')
      setAuthed(true)
    } else {
      setError('Incorrect password. Please try again.')
      setValue('')
      setShaking(true)
      setTimeout(() => setShaking(false), 600)
    }
  }

  return (
    <>
      <style>{`
        @keyframes ca-gate-shake {
          0%,100%{ transform:translateX(0) }
          20%    { transform:translateX(-8px) }
          40%    { transform:translateX(8px) }
          60%    { transform:translateX(-6px) }
          80%    { transform:translateX(6px) }
        }
        @keyframes ca-gate-in {
          from { opacity:0; transform:translateY(14px) }
          to   { opacity:1; transform:translateY(0) }
        }
        @keyframes ca-spin { to { transform:rotate(360deg) } }
        .ca-gate-card        { animation: ca-gate-in 0.35s ease both }
        .ca-gate-card.shake  { animation: ca-gate-shake 0.55s ease }
        .ca-gate-input:focus { outline:none; border-color:#2563eb !important; box-shadow:0 0 0 3px rgba(37,99,235,.15) !important }
        .ca-gate-btn:hover:not(:disabled) { background:#1d4ed8 !important }
        .ca-gate-eye:hover   { color:#374151 !important }
      `}</style>

      <div style={{
        position:'fixed', inset:0, zIndex:9999,
        background:'linear-gradient(135deg,#f0f4ff 0%,#e8edf8 50%,#f5f0ff 100%)',
        display:'flex', alignItems:'center', justifyContent:'center',
        fontFamily:"'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      }}>
        {/* Blobs */}
        <div style={{position:'absolute',top:'10%',left:'5%',width:320,height:320,borderRadius:'50%',background:'radial-gradient(circle,rgba(37,99,235,.08) 0%,transparent 70%)',filter:'blur(40px)',pointerEvents:'none'}}/>
        <div style={{position:'absolute',bottom:'10%',right:'5%',width:280,height:280,borderRadius:'50%',background:'radial-gradient(circle,rgba(124,58,237,.07) 0%,transparent 70%)',filter:'blur(40px)',pointerEvents:'none'}}/>

        <div className={`ca-gate-card${shaking?' shake':''}`} style={{
          background:'#fff', borderRadius:20,
          boxShadow:'0 20px 60px rgba(0,0,0,.10),0 4px 16px rgba(0,0,0,.06)',
          padding:'48px 44px 40px', width:'100%', maxWidth:420,
        }}>
          {/* Icon */}
          <div style={{display:'flex',justifyContent:'center',marginBottom:28}}>
            <div style={{
              width:64,height:64,borderRadius:18,
              background:'linear-gradient(135deg,#2563eb 0%,#7c3aed 100%)',
              display:'flex',alignItems:'center',justifyContent:'center',
              boxShadow:'0 8px 24px rgba(37,99,235,.30)',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
          </div>

          {/* Heading */}
          <div style={{textAlign:'center',marginBottom:8}}>
            <div style={{fontSize:22,fontWeight:700,color:'#111827',letterSpacing:'-0.3px'}}>Customer Analytics</div>
            <div style={{fontSize:14,color:'#6b7280',marginTop:6,lineHeight:1.5}}>
              This section is protected. Enter the access password to continue.
            </div>
          </div>

          <div style={{height:1,background:'#f3f4f6',margin:'24px 0'}}/>

          <form onSubmit={handleSubmit}>
            <label style={{fontSize:12.5,fontWeight:600,color:'#374151',textTransform:'uppercase',letterSpacing:'0.06em',display:'block',marginBottom:8}}>
              Password
            </label>

            <div style={{position:'relative'}}>
              <input
                className="ca-gate-input"
                type={visible?'text':'password'}
                value={value}
                onChange={e=>{setValue(e.target.value);setError('')}}
                placeholder="Enter access password"
                autoFocus
                autoComplete="current-password"
                style={{
                  width:'100%',boxSizing:'border-box',
                  padding:'12px 44px 12px 14px',
                  border:`1.5px solid ${error?'#ef4444':'#e5e7eb'}`,
                  borderRadius:10,fontSize:14.5,
                  background:'#fafafa',color:'#111827',
                  fontFamily:'inherit',transition:'border-color .15s,box-shadow .15s',
                }}
              />
              <button type="button" className="ca-gate-eye"
                onClick={()=>setVisible(v=>!v)}
                tabIndex={-1}
                style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',
                  background:'none',border:'none',cursor:'pointer',padding:4,
                  color:'#9ca3af',transition:'color .15s',lineHeight:0}}
              >
                {visible?(
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ):(
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>

            {error&&(
              <div style={{display:'flex',alignItems:'center',gap:6,marginTop:8,fontSize:13,color:'#ef4444',fontWeight:500}}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
              </div>
            )}

            <button type="submit" className="ca-gate-btn" disabled={loading||!value.trim()} style={{
              marginTop:20,width:'100%',padding:'12px 0',borderRadius:10,
              background:loading||!value.trim()?'#93c5fd':'#2563eb',
              color:'#fff',border:'none',cursor:loading||!value.trim()?'not-allowed':'pointer',
              fontSize:15,fontWeight:700,fontFamily:'inherit',transition:'background .15s',
              display:'flex',alignItems:'center',justifyContent:'center',gap:8,
            }}>
              {loading?(
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                    style={{animation:'ca-spin .8s linear infinite'}}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                  Verifying…
                </>
              ):'Unlock Dashboard'}
            </button>
          </form>

          <div style={{textAlign:'center',marginTop:20,fontSize:12,color:'#9ca3af'}}>
            🔒 Session only — access clears on browser close
          </div>
        </div>
      </div>
    </>
  )
}
