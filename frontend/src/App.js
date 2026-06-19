import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
// Safely import marker images for React/Webpack
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
// 🛑 UPDATE THIS TO YOUR RENDER URL BEFORE DEPLOYING!
const API_URL = "https://predictive-incident-management-system.onrender.com"; 

// // Safely import marker images for React/Webpack
// import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
// import markerIcon from 'leaflet/dist/images/marker-icon.png';
// import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

/* ─── design tokens ─────────────────────────────────────── */
const C = {
  bg:       '#0d0f14',
  surface:  '#141720',
  card:     '#1a1e2b',
  border:   '#252a3a',
  borderHi: '#343a52',
  text:     '#e8eaf0',
  muted:    '#7a8099',
  dim:      '#4a5068',
  accent:   '#4f6ef7',
  accentLo: 'rgba(79,110,247,0.12)',
  crit:     '#ef4444',
  critLo:   'rgba(239,68,68,0.12)',
  high:     '#f97316',
  highLo:   'rgba(249,115,22,0.12)',
  med:      '#eab308',
  medLo:    'rgba(234,179,8,0.12)',
  low:      '#22c55e',
  lowLo:    'rgba(34,197,94,0.12)',
  purple:   '#a855f7',
  purpleLo: 'rgba(168,85,247,0.12)',
  teal:     '#14b8a6',
  tealLo:   'rgba(20,184,166,0.12)',
};

const PRIO = {
  Critical: { fg: C.crit,   bg: C.critLo   },
  High:     { fg: C.high,   bg: C.highLo   },
  Medium:   { fg: C.med,    bg: C.medLo    },
  Low:      { fg: C.low,    bg: C.lowLo    },
};

/* ─── global styles injected once ───────────────────────── */
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${C.bg}; color: ${C.text}; font-family: 'Inter', system-ui, sans-serif; }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: ${C.surface}; }
  ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }

  .gp-input {
    width: 100%; padding: 8px 10px; background: ${C.bg}; border: 1px solid ${C.border};
    border-radius: 8px; font-size: 12px; color: ${C.text}; font-family: 'Inter', sans-serif;
    outline: none; transition: border-color .15s;
  }
  .gp-input:focus { border-color: ${C.accent}; }
  .gp-input::placeholder { color: ${C.dim}; }

  .gp-label {
    display: block; font-size: 10px; font-weight: 600; color: ${C.muted};
    letter-spacing: .08em; text-transform: uppercase; margin-bottom: 5px;
  }

  .gp-card {
    background: ${C.card}; border: 1px solid ${C.border};
    border-radius: 14px; padding: 18px;
  }

  .gp-section-title {
    font-size: 11px; font-weight: 600; color: ${C.muted};
    letter-spacing: .08em; text-transform: uppercase;
    margin-bottom: 14px; display: flex; align-items: center; gap: 7px;
  }
  .gp-section-title::before {
    content: ''; width: 3px; height: 12px; border-radius: 2px;
    background: ${C.accent}; flex-shrink: 0;
  }

  .fade-in { animation: fadeUp .3s ease both; }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .pulse-dot {
    width: 7px; height: 7px; border-radius: 50%; background: ${C.low};
    box-shadow: 0 0 0 0 rgba(34,197,94,.4);
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    0%   { box-shadow: 0 0 0 0 rgba(34,197,94,.4); }
    70%  { box-shadow: 0 0 0 6px rgba(34,197,94,0); }
    100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
  }

  .shap-bar-fill { transition: width .6s cubic-bezier(.4,0,.2,1); }

  .sev-ring circle.track { transition: stroke-dashoffset .8s cubic-bezier(.4,0,.2,1); }

  .kpi-card { position: relative; overflow: hidden; }
  .kpi-card::after {
    content: ''; position: absolute; inset: 0; border-radius: 14px;
    background: linear-gradient(135deg, rgba(255,255,255,.03) 0%, transparent 60%);
    pointer-events: none;
  }

  .predict-btn {
    width: 100%; padding: 12px; border: none; border-radius: 10px; cursor: pointer;
    font-size: 13px; font-weight: 600; font-family: 'Inter', sans-serif;
    background: ${C.accent}; color: #fff;
    transition: opacity .15s, transform .1s;
    display: flex; align-items: center; justify-content: center; gap: 8px;
  }
  .predict-btn:hover:not(:disabled) { opacity: .9; }
  .predict-btn:active:not(:disabled) { transform: scale(.98); }
  .predict-btn:disabled { opacity: .45; cursor: not-allowed; }

  .tag {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 10px; font-weight: 600; padding: 3px 8px; border-radius: 99px;
    letter-spacing: .04em;
  }

  .timeline-node {
    width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0;
    border: 2px solid ${C.border}; background: ${C.bg};
    transition: all .3s;
  }
  .timeline-node.done  { background: ${C.low};   border-color: ${C.low}; }
  .timeline-node.active { background: ${C.accent}; border-color: ${C.accent}; box-shadow: 0 0 0 3px rgba(79,110,247,.25); }

  .agree-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 0; border-bottom: 1px solid ${C.border};
    font-size: 12px; color: ${C.muted};
  }
  .agree-row:last-child { border-bottom: none; }

  .health-pill {
    padding: 2px 8px; border-radius: 99px; font-size: 10px; font-weight: 600;
    background: ${C.accentLo}; color: ${C.accent};
  }

  .faiss-card {
    background: ${C.bg}; border: 1px solid ${C.border}; border-radius: 10px;
    padding: 11px 13px; display: flex; justify-content: space-between; align-items: center;
    transition: border-color .15s;
  }
  .faiss-card:hover { border-color: ${C.borderHi}; }

  .rec-item {
    display: flex; align-items: flex-start; gap: 9px;
    padding: 9px 12px; border-radius: 8px; font-size: 12px;
    background: ${C.bg}; border: 1px solid ${C.border};
  }
  .rec-bullet {
    width: 5px; height: 5px; border-radius: 50%; background: ${C.accent};
    flex-shrink: 0; margin-top: 5px;
  }

  .warn-item {
    display: flex; align-items: flex-start; gap: 9px;
    padding: 10px 13px; border-radius: 8px; font-size: 12px;
    background: rgba(234,179,8,.08); border: 1px solid rgba(234,179,8,.25);
    color: #fde68a;
  }

  .mono { font-family: 'JetBrains Mono', monospace; }

  .leaflet-container { background: ${C.bg} !important; }

  .cost-row {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 12px; color: ${C.muted}; padding: 5px 0;
    border-bottom: 1px solid ${C.border};
  }
  .cost-row:last-child { border-bottom: none; }
`;

/* ─── helpers ────────────────────────────────────────────── */
function MapUpdater({ lat, lng }) {
  const map = useMap();
  useEffect(() => { map.flyTo([lat, lng], 14, { duration: 1.2 }); }, [lat, lng, map]);
  return null;
}

function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin .7s linear infinite' }}>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      <circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,.3)" strokeWidth="2"/>
      <path d="M8 2a6 6 0 0 1 6 6" stroke="white" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

function Tag({ label, color, bg }) {
  return (
    <span className="tag" style={{ background: bg || 'rgba(255,255,255,.06)', color: color || C.muted }}>
      {label}
    </span>
  );
}

function SectionTitle({ children }) {
  return <div className="gp-section-title">{children}</div>;
}

function Field({ label, children }) {
  return (
    <div>
      <label className="gp-label">{label}</label>
      {children}
    </div>
  );
}

/* ─── severity ring SVG ─────────────────────────────────── */
function SevRing({ value, band }) {
  const r = 44, circ = 2 * Math.PI * r;
  const offset = circ * (1 - value / 100);
  const strokeColor = value > 80 ? C.crit : value > 60 ? C.high : value > 30 ? C.med : C.low;
  return (
    <svg width="110" height="110" viewBox="0 0 110 110">
      <circle cx="55" cy="55" r={r} fill="none" stroke={C.border} strokeWidth="9"/>
      <circle
        cx="55" cy="55" r={r} fill="none"
        stroke={strokeColor} strokeWidth="9" strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={offset}
        style={{ transform: 'rotate(-90deg)', transformOrigin: '55px 55px', transition: 'stroke-dashoffset .8s cubic-bezier(.4,0,.2,1), stroke .3s' }}
      />
      <text x="55" y="50" textAnchor="middle" fontSize="22" fontWeight="600" fill={C.text} fontFamily="Inter">{value}</text>
      <text x="55" y="65" textAnchor="middle" fontSize="10" fill={C.muted} fontFamily="Inter">{band}</text>
    </svg>
  );
}

/* ─── main component ─────────────────────────────────────── */
export default function App() {
  const [inputs, setInputs] = useState({
    event_type: 'unplanned',
    event_cause: 'vehicle_breakdown',
    zone: 'Jayanagara',
    junction: 'South End Circle',
    corridor: 'Non-corridor',
    direction: 'Northbound',
    latitude: 12.9250,
    longitude: 77.5938,
    description: 'Bmtc bus off-road blocking left lane',
    reason_breakdown: 'Engine Failure',
  });

  const [result, setResult]   = useState(null);
  const [stats, setStats]     = useState(null);
  const [loading, setLoading] = useState(false);
  const styleRef              = useRef(false);

  /* inject global CSS once */
  useEffect(() => {
    if (styleRef.current) return;
    styleRef.current = true;
    const el = document.createElement('style');
    el.textContent = GLOBAL_CSS;
    document.head.appendChild(el);
  }, []);

  useEffect(() => {
    fetch(`${API_URL}/stats`)
      .then(r => r.json()).then(setStats).catch(() => {});
  }, []);

  const fetchInference = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputs),
      });
      setResult(await res.json());
    } catch (err) { console.error('API Error', err); }
    setLoading(false);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setInputs(prev => ({
      ...prev,
      [name]: ['latitude', 'longitude'].includes(name) ? Number(value) : value,
    }));
  };

  const pc = result ? (PRIO[result.priority] || PRIO.Low) : null;

  /* ── layout ────────────────────────────────────────────── */
  return (
    <div style={{ minHeight: '100vh', background: C.bg, padding: '20px 24px' }}>

      {/* TOP BAR */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: C.accentLo, border: `1px solid ${C.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🚦</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: C.text, lineHeight: 1.2 }}>GridPredict Enterprise</div>
            <div style={{ fontSize: 11, color: C.muted }}>Traffic Incident Intelligence System</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span className="mono" style={{ fontSize: 11, color: C.dim }}>v18.3 · Jun 2026</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div className="pulse-dot"/>
            <span style={{ fontSize: 11, color: C.muted }}>API live</span>
          </div>
        </div>
      </div>

      {/* MODEL HEALTH BAR */}
      {stats && (
        <div className="gp-card fade-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0', marginBottom: '18px', padding: '14px 20px' }}>
          {[
            { label: 'Priority model', val: `F1 ${stats.models.priority_f1}%`, sub: `AUC ${stats.models.priority_roc_auc !== 'N/A' ? stats.models.priority_roc_auc + '%' : 'N/A'}` },
            { label: 'Restriction model', val: `F1 ${stats.models.closure_f1}%`, sub: `AUC ${stats.models.closure_roc_auc !== 'N/A' ? stats.models.closure_roc_auc + '%' : 'N/A'}` },
            { label: 'Resolution model', val: `±${stats.models.resolution_rmse_hours}h RMSE`, sub: 'temporal regressor' },
            { label: 'Data pipeline', val: stats.dataset.raw_records.toLocaleString(), sub: `${stats.dataset.clusters} hotspot clusters` },
          ].map((m, i, arr) => (
            <div key={i} style={{ padding: '0 18px', borderRight: i < arr.length - 1 ? `1px solid ${C.border}` : 'none' }}>
              <div style={{ fontSize: 10, color: C.dim, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>{m.label}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{m.val}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{m.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* EXECUTIVE SUMMARY (shown after prediction) */}
      {result && (
        <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '18px' }}>
          {/* summary block */}
          <div className="gp-card" style={{ gridColumn: 'span 2', borderLeft: `3px solid ${pc.fg}`, display: 'flex', gap: '24px', alignItems: 'stretch' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>Incident summary</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: C.text, marginBottom: 4 }}>
                <span style={{ color: pc.fg }}>{result.priority}</span> · {inputs.event_cause.replace(/_/g, ' ')}
              </div>
              <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>
                {result.closure === 'TRUE' ? '⛔ Traffic restriction required' : '✅ No restriction required'}
                &nbsp;·&nbsp;Est. clearance in {result.resolution_hours > 0 ? `${result.resolution_hours}h ` : ''}{result.resolution_mins}m
              </div>
              {result.model_warnings.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {result.model_warnings.map((w, i) => (
                    <div key={i} className="warn-item">⚠ {w}</div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ width: 1, background: C.border, flexShrink: 0 }}/>
            <div style={{ flex: '0 0 190px' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: C.muted, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>Response cost</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {result.cost_details.map((item, idx) => (
                  <div key={idx} className="cost-row">
                    <span>{item.item}</span>
                    <span className="mono" style={{ color: C.text }}>{item.cost}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 11, color: C.muted }}>Total</span>
                <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: C.low }}>{result.total_cost}</span>
              </div>
            </div>
          </div>

          {/* model agreement */}
          <div className="gp-card">
            <SectionTitle>Model agreement</SectionTitle>
            {[
              ['Priority model', result.model_agreement.model_prio.val, result.model_agreement.model_prio.match],
              ['FAISS analogues', result.model_agreement.faiss_prio.val, result.model_agreement.faiss_prio.match],
              ['Spatial risk', result.model_agreement.spatial_risk.val, result.model_agreement.spatial_risk.match],
            ].map(([lbl, val, match]) => (
              <div key={lbl} className="agree-row">
                <span>{lbl}</span>
                <span style={{ color: match ? C.low : C.crit, fontWeight: 600, fontSize: 12 }}>
                  {val} {match ? '✓' : '⚠'}
                </span>
              </div>
            ))}
            <div style={{
              marginTop: 12, padding: '7px 10px', borderRadius: 8, textAlign: 'center',
              fontSize: 12, fontWeight: 600,
              background: result.model_agreement.confidence === 'STRONG' ? C.lowLo : result.model_agreement.confidence === 'MODERATE' ? C.medLo : C.critLo,
              color: result.model_agreement.confidence === 'STRONG' ? C.low : result.model_agreement.confidence === 'MODERATE' ? C.med : C.crit,
            }}>
              {result.model_agreement.confidence} · {result.model_agreement.score}/3 sources
            </div>
          </div>
        </div>
      )}

      {/* MAIN LAYOUT */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '16px', alignItems: 'start' }}>

        {/* ── LEFT PANEL ──────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', position: 'sticky', top: '20px' }}>
          <div className="gp-card">
            <SectionTitle>Incident context</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Field label="Event type"><input name="event_type" value={inputs.event_type} onChange={handleChange} className="gp-input"/></Field>
                <Field label="Event cause"><input name="event_cause" value={inputs.event_cause} onChange={handleChange} className="gp-input"/></Field>
              </div>
              <Field label="Reason for breakdown"><input name="reason_breakdown" value={inputs.reason_breakdown} onChange={handleChange} className="gp-input"/></Field>
              <Field label="Description (NLP feature)">
                <textarea name="description" value={inputs.description} onChange={handleChange} rows={3} className="gp-input" style={{ resize: 'vertical' }}/>
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Field label="Zone"><input name="zone" value={inputs.zone} onChange={handleChange} className="gp-input"/></Field>
                <Field label="Junction"><input name="junction" value={inputs.junction} onChange={handleChange} className="gp-input"/></Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Field label="Corridor"><input name="corridor" value={inputs.corridor} onChange={handleChange} className="gp-input"/></Field>
                <Field label="Direction"><input name="direction" value={inputs.direction} onChange={handleChange} className="gp-input"/></Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Field label="Latitude"><input type="number" step="0.0001" name="latitude" value={inputs.latitude} onChange={handleChange} className="gp-input mono"/></Field>
                <Field label="Longitude"><input type="number" step="0.0001" name="longitude" value={inputs.longitude} onChange={handleChange} className="gp-input mono"/></Field>
              </div>
              <button className="predict-btn" onClick={fetchInference} disabled={loading}>
                {loading ? <Spinner/> : '⚡'}
                {loading ? 'Running inference…' : 'Predict incident impact'}
              </button>
            </div>
          </div>

          {/* TIMELINE */}
          {result && (
            <div className="gp-card fade-in">
              <SectionTitle>Operational timeline</SectionTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {result.timeline.map((step, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', paddingBottom: idx < result.timeline.length - 1 ? 14 : 0 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 2 }}>
                      <div className={`timeline-node ${idx === 0 ? 'done' : idx === 1 ? 'active' : ''}`}/>
                      {idx < result.timeline.length - 1 && (
                        <div style={{ width: 1, flex: 1, minHeight: 18, background: C.border, marginTop: 3 }}/>
                      )}
                    </div>
                    <div style={{ paddingBottom: idx < result.timeline.length - 1 ? 0 : 0 }}>
                      <div className="mono" style={{ fontSize: 11, fontWeight: 500, color: idx <= 1 ? C.accent : C.dim }}>{step.time}</div>
                      <div style={{ fontSize: 12, color: idx === 0 ? C.text : C.muted, marginTop: 1 }}>{step.event}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* WHAT-IF */}
          {result && result.what_if && (
            <div className="gp-card fade-in" style={{ borderLeft: `3px solid ${C.purple}` }}>
              <SectionTitle>What-if scenario</SectionTitle>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>If: <span style={{ color: C.text, fontWeight: 500 }}>{result.what_if.trigger}</span></div>
              {[
                ['Severity', `${result.what_if.sev_old} → ${result.what_if.sev_new}`],
                ['Est. cost', `${result.what_if.cost_old} → ${result.what_if.cost_new}`],
              ].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', borderBottom: `1px solid ${C.border}`, color: C.muted }}>
                  <span>{l}</span>
                  <span className="mono" style={{ color: C.text, fontWeight: 500 }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── RIGHT PANEL ─────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* KPI GRID */}
          {result && (
            <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '12px' }}>
              {/* Priority */}
              <div className="gp-card kpi-card" style={{ borderTop: `2px solid ${pc.fg}` }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>Priority</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: pc.fg, lineHeight: 1 }}>{result.priority}</div>
                <div style={{ marginTop: 8 }}>
                  <Tag label={`${result.priority_conf}% conf`} color={pc.fg} bg={pc.bg}/>
                </div>
              </div>

              {/* Restriction */}
              <div className="gp-card kpi-card" style={{ borderTop: `2px solid ${result.closure === 'TRUE' ? C.crit : C.low}` }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>Restriction</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: result.closure === 'TRUE' ? C.crit : C.low, lineHeight: 1.2 }}>
                  {result.closure === 'TRUE' ? 'Required' : 'Not required'}
                </div>
                <div style={{ marginTop: 8 }}>
                  {result.override_applied
                    ? <Tag label="Safety override" color="#fde68a" bg="rgba(234,179,8,.1)"/>
                    : <Tag label={`${result.closure_conf}% conf`} color={C.muted} bg={`rgba(122,128,153,.12)`}/>
                  }
                </div>
              </div>

              {/* Resolution */}
              <div className="gp-card kpi-card" style={{ borderTop: `2px solid ${C.teal}` }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>Clearance</div>
                <div className="mono" style={{ fontSize: 26, fontWeight: 700, color: C.teal, lineHeight: 1 }}>
                  {result.resolution_hours > 0 ? `${result.resolution_hours}h ` : ''}{result.resolution_mins}m
                </div>
                <div style={{ marginTop: 8 }}>
                  <Tag label={`±${stats?.models.resolution_rmse_hours}h margin`} color={C.teal} bg={C.tealLo}/>
                </div>
              </div>

              {/* Severity */}
              <div className="gp-card kpi-card" style={{ borderTop: `2px solid ${C.purple}` }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>Severity</div>
                <div className="mono" style={{ fontSize: 26, fontWeight: 700, color: C.purple, lineHeight: 1 }}>
                  {result.operational_severity}<span style={{ fontSize: 13, color: C.dim }}>/100</span>
                </div>
                <div style={{ marginTop: 8 }}>
                  <Tag
                    label={result.severity_band}
                    color={result.operational_severity > 80 ? C.crit : result.operational_severity > 60 ? C.high : result.operational_severity > 30 ? C.med : C.low}
                    bg={result.operational_severity > 80 ? C.critLo : result.operational_severity > 60 ? C.highLo : result.operational_severity > 30 ? C.medLo : C.lowLo}
                  />
                </div>
              </div>
            </div>
          )}

          {/* MAP + SPATIAL */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '14px' }}>
            <div style={{ borderRadius: 14, overflow: 'hidden', border: `1px solid ${C.border}`, height: 280, zIndex: 0 }}>
              <MapContainer center={[inputs.latitude, inputs.longitude]} zoom={14} style={{ height: '100%', width: '100%' }}>
                <TileLayer
                  url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  attribution='&copy; <a href="https://carto.com">CARTO</a>'
                />
                <MapUpdater lat={inputs.latitude} lng={inputs.longitude}/>
                <CircleMarker
                  center={[inputs.latitude, inputs.longitude]}
                  radius={14}
                  pathOptions={{ fillColor: C.crit, color: C.crit, fillOpacity: 0.35, weight: 2 }}
                />
                <CircleMarker
                  center={[inputs.latitude, inputs.longitude]}
                  radius={5}
                  pathOptions={{ fillColor: C.crit, color: 'transparent', fillOpacity: 1 }}
                />
                {result && result.spatial_risk.lat && (
                  <CircleMarker
                    center={[result.spatial_risk.lat, result.spatial_risk.lon]}
                    radius={40}
                    pathOptions={{ fillColor: C.purple, color: C.purple, fillOpacity: 0.1, weight: 1.5, dashArray: '5,4' }}
                  />
                )}
                <Marker position={[inputs.latitude, inputs.longitude]}>
                  <Popup>{inputs.event_cause.replace(/_/g, ' ')}</Popup>
                </Marker>
              </MapContainer>
            </div>

            {result ? (
              <div className="gp-card fade-in">
                <SectionTitle>Spatial intelligence</SectionTitle>
                {[
                  ['Hotspot zone', result.spatial_risk.cluster !== -1 ? 'Yes' : 'No'],
                  ['Nearest hotspot', result.spatial_risk.nearby_m === -1 ? 'N/A' : `${result.spatial_risk.nearby_m} m`],
                  ['Risk band', result.spatial_risk.band],
                  ['Cluster ID', result.spatial_risk.cluster !== -1 ? `#${result.spatial_risk.cluster}` : 'N/A'],
                ].map(([l, v]) => (
                  <div key={l} className="agree-row">
                    <span>{l}</span>
                    <span style={{ fontWeight: 600, color: C.text, fontSize: 12 }}>{v}</span>
                  </div>
                ))}
                <div style={{ marginTop: 12 }}>
                  <Tag
                    label={result.spatial_risk.band}
                    color={result.spatial_risk.band === 'Hotspot' ? C.crit : result.spatial_risk.band === 'Near' ? C.high : result.spatial_risk.band === 'Moderate' ? C.med : C.muted}
                    bg={result.spatial_risk.band === 'Hotspot' ? C.critLo : result.spatial_risk.band === 'Near' ? C.highLo : result.spatial_risk.band === 'Moderate' ? C.medLo : `rgba(122,128,153,.1)`}
                  />
                </div>
              </div>
            ) : (
              <div className="gp-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 280, color: C.dim, fontSize: 12 }}>
                Run prediction to see spatial data
              </div>
            )}
          </div>

          {/* SEVERITY BREAKDOWN + RECOMMENDATIONS */}
          {result && (
            <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: '1fr 1.8fr', gap: '14px' }}>
              {/* severity ring */}
              <div className="gp-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
                <SectionTitle>Severity score</SectionTitle>
                <SevRing value={result.operational_severity} band={result.severity_band}/>
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {Object.entries(result.severity_components).map(([k, v]) => {
                    const compColors = { Priority: C.crit, Closure: C.high, Hotspot: C.purple, Density: C.teal };
                    const maxVal = { Priority: 35, Closure: 30, Hotspot: 20, Density: 15 };
                    return (
                      <div key={k}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.muted, marginBottom: 3 }}>
                          <span>{k}</span><span className="mono">{v}</span>
                        </div>
                        <div style={{ height: 4, background: C.border, borderRadius: 99, overflow: 'hidden' }}>
                          <div className="shap-bar-fill" style={{ height: '100%', width: `${(v / maxVal[k]) * 100}%`, background: compColors[k], borderRadius: 99 }}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* recommendations */}
              <div className="gp-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <SectionTitle>Decision support</SectionTitle>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 99,
                    background: result.has_anomaly ? C.critLo : C.lowLo,
                    color: result.has_anomaly ? C.crit : C.low,
                  }}>
                    {result.has_anomaly ? '⚠ Review needed' : '✓ Consistent'}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {result.recommendations.map((rec, idx) => (
                    <div key={idx} className="rec-item">
                      <div className="rec-bullet"/>
                      <span style={{ color: C.muted }}>{rec}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* SHAP + FAISS */}
          {result && (
            <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: '14px' }}>
              {/* SHAP */}
              <div className="gp-card">
                <SectionTitle>Priority drivers (SHAP)</SectionTitle>
                {result.shap[0].impact > 90 ? (
                  <div style={{ padding: '12px', background: C.critLo, borderRadius: 8, color: C.crit, fontSize: 13, fontWeight: 500 }}>
                    ⚠ Dominant signal: {result.shap[0].feature} ({result.shap[0].impact}%)
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {result.shap.map((feat, idx) => (
                      <div key={idx}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                          <span style={{ color: C.muted }}>{feat.feature}</span>
                          <span className="mono" style={{ color: C.accent, fontWeight: 500 }}>{feat.impact}%</span>
                        </div>
                        <div style={{ height: 5, background: C.border, borderRadius: 99, overflow: 'hidden' }}>
                          <div className="shap-bar-fill" style={{ height: '100%', width: `${feat.impact}%`, background: `linear-gradient(90deg, ${C.accent}, ${C.purple})`, borderRadius: 99 }}/>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: C.dim, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>Why this prediction?</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {result.narrative_reasons.map((r, idx) => (
                      <div key={idx} style={{ fontSize: 11, color: C.muted, display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                        <span style={{ color: C.accent, flexShrink: 0, marginTop: 1 }}>›</span>
                        {r}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* FAISS */}
              <div className="gp-card">
                <SectionTitle>Historical analogues (FAISS)</SectionTitle>
                <div style={{ fontSize: 11, color: C.muted, padding: '7px 10px', background: C.bg, borderRadius: 8, marginBottom: 12, border: `1px solid ${C.border}` }}>
                  {result.faiss_consensus}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {result.similar.map((inc, idx) => {
                    const ip = PRIO[inc.priority] || PRIO.Low;
                    return (
                      <div key={idx} className="faiss-card" style={{ borderLeft: `3px solid ${ip.fg}` }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 3 }}>
                            {inc.event_cause.replace(/_/g, ' ')}
                            <Tag label={inc.priority} color={ip.fg} bg={ip.bg} style={{ marginLeft: 6 }}/>
                          </div>
                          <div style={{ fontSize: 11, color: C.muted }}>
                            Restriction: <span style={{ color: inc.requires_road_closure === 'TRUE' ? C.crit : C.low }}>{inc.requires_road_closure === 'TRUE' ? 'Yes' : 'No'}</span>
                            &nbsp;·&nbsp;Res: <span className="mono">{inc.resolution_minutes}m</span>
                          </div>
                        </div>
                        <div style={{ textAlign: 'center', flexShrink: 0, marginLeft: 10 }}>
                          <div style={{ fontSize: 9, color: C.dim, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>Sim</div>
                          <div className="mono" style={{ fontSize: 15, fontWeight: 600, color: C.accent }}>{inc.similarity}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* FOOTER */}
      <div style={{ textAlign: 'center', marginTop: 36, paddingTop: 18, borderTop: `1px solid ${C.border}`, fontSize: 11, color: C.dim }}>
        CatBoost · SHAP · FAISS · DBSCAN · FastAPI · React · Leaflet
      </div>
    </div>
  );
}