import { useState, useEffect } from 'react';
import { ShieldAlert, TrendingUp, Anchor, Activity, Zap, Info, BellRing } from 'lucide-react';
import { formatINR } from '../utils/formatters';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function SignalCommandCenter() {
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('ALL');

  useEffect(() => {
    const fetchSignals = async () => {
      try {
        const response = await fetch(`${API_BASE}/data/signals`);
        if (!response.ok) throw new Error('Failed to fetch signals');
        const json = await response.json();
        
        // Map the backend data to the frontend schema if needed
        const mappedSignals = json.data.map(s => ({
          id: s.signal_id || s._id,
          symbol: s.symbol,
          score: s.strength_score,
          label: s.confidence_label,
          type: s.signal_type || 'BUY',
          timestamp: s.timestamp,
          expert_summary: s.expert_summary.split('Analyst Verdict:')[0].trim(),
          ai_context: s.expert_summary.includes('Analyst Verdict:') 
                        ? s.expert_summary.split('Analyst Verdict:')[1].trim().split('•').filter(b => b.trim() !== '') 
                        : null,
          whale_dna: { hit_ratio: 0.65, sector: 'Unknown' }, // Mocking DNA for now since it's not in the base schema
          sparkline: [100, 102, 105, 103, 108, 110, 115] // Mocking sparkline for now
        }));
        
        setSignals(mappedSignals);
        setError(null);
      } catch (error) {
        console.error("Error fetching signals:", error);
        setError("Could not reach the signal intelligence engine.");
      } finally {
        setLoading(false);
      }
    };
    fetchSignals();
    
    // Optional: Refresh every 30 seconds
    const interval = setInterval(fetchSignals, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleManualTrigger = async () => {
    setTriggering(true);
    try {
      const resp = await fetch(`${API_BASE}/data/signals/generate`, { method: 'POST' });
      if (!resp.ok) throw new Error('Engine unreachable');
      alert("Intelligence Engine Triggered. Scanning latest institutional deals...");
    } catch (err) {
      alert("Failed to start engine: " + err.message);
    } finally {
      setTriggering(false);
    }
  };

  const getLabelColor = (label) => {
    if (label === 'CRITICAL') return 'var(--accent-rose)';
    if (label === 'HIGH') return 'var(--accent-emerald)';
    return 'var(--accent-blue)';
  };

  const filteredSignals = signals.filter(s => {
    if (filter === 'ALL') return true;
    if (filter === 'HERD') return s.expert_summary.includes('Whales entering');
    if (filter === 'CONVICTION') return s.expert_summary.includes('averaging up');
    if (filter === 'VOLUME') return s.expert_summary.includes('Deal value');
    return true;
  });

  return (
    <div className="command-center animate-in">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="page-title flex items-center gap-3">
            <BellRing size={24} color="var(--accent-rose)" />
            Signal Command Center
          </h1>
          <p className="page-subtitle">Real-time, AI-enriched High Conviction Opportunities.</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Pulsing Intelligence Trigger */}
          <button 
            className={`btn btn-sm ${triggering ? 'btn-ghost' : 'btn-primary'}`}
            style={{ 
              background: 'var(--accent-rose)', 
              borderColor: 'var(--accent-rose)',
              boxShadow: '0 0 15px rgba(244, 63, 94, 0.4)',
              animation: triggering ? 'none' : 'pulse-rose 2s infinite'
            }}
            onClick={handleManualTrigger}
            disabled={triggering}
          >
            {triggering ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <Zap size={14} className="mr-1" />}
            {triggering ? 'Analyzing...' : 'Run Intelligence'}
          </button>

          <div className="flex gap-1 bg-slate-900/50 p-1 rounded-full border border-slate-800">
            {['ALL', 'HERD', 'CONVICTION', 'VOLUME'].map(f => (
              <button
                key={f}
                className={`filter-chip ${filter === f ? 'active' : ''}`}
                style={{ fontSize: '0.7rem', padding: '4px 10px' }}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loader-container">
          <div className="spinner" />
          <p className="loader-text">Intercepting Engine Signals...</p>
        </div>
      ) : error ? (
        <div className="status-message status-error mb-lg">
          <span>❌</span> {error}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filteredSignals.map(signal => (
            <div key={signal.id} className="glass-card" style={{ padding: '20px', borderLeft: `4px solid ${getLabelColor(signal.label)}` }}>
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-4">
                  <div style={{
                    background: 'rgba(15, 23, 42, 0.6)', padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--border-light)'
                  }}>
                    <div className="font-mono text-xl font-bold">{signal.symbol}</div>
                    <div className="text-xs text-muted font-mono mt-1">{new Date(signal.timestamp).toLocaleString()}</div>
                  </div>
                  
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="badge" style={{ background: getLabelColor(signal.label) + '22', color: getLabelColor(signal.label), border: `1px solid ${getLabelColor(signal.label)}44` }}>
                        <ShieldAlert size={12} className="mr-1" />
                        {signal.label} {signal.type}
                      </span>
                      <span className="font-mono font-bold" style={{ fontSize: '1.2rem', color: getLabelColor(signal.label) }}>
                        {signal.score.toFixed(1)}
                      </span>
                    </div>
                    
                    {/* Whale DNA Hover (Tooltip simulation) */}
                    <div className="group relative inline-block cursor-help">
                      <div className="text-xs text-muted flex items-center gap-1">
                        <Info size={12} /> View Investor DNA
                      </div>
                      <div className="hidden group-hover:block absolute top-full left-0 mt-2 w-48 p-3 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50">
                        <div className="text-xs font-bold mb-1">Historical Accuracy</div>
                        <div className="flex justify-between font-mono text-sm mb-2">
                          <span>Hit Ratio:</span> <span className="text-emerald-400">{(signal.whale_dna.hit_ratio * 100).toFixed(0)}%</span>
                        </div>
                        <div className="flex justify-between font-mono text-sm">
                          <span>Sector:</span> <span>{signal.whale_dna.sector}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Alpha Sparkline */}
                <div style={{ width: '120px', height: '40px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={signal.sparkline.map((val, i) => ({ val, i }))}>
                      <defs>
                        <linearGradient id={`grad-${signal.id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={getLabelColor(signal.label)} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={getLabelColor(signal.label)} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area type="monotone" dataKey="val" stroke={getLabelColor(signal.label)} fill={`url(#grad-${signal.id})`} strokeWidth={2} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Expert Summary & AI Context */}
              <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
                <p className="text-sm text-slate-300 leading-relaxed mb-4">
                  {signal.expert_summary}
                </p>
                
                {signal.ai_context && (
                  <div className="border-t border-slate-800 pt-3 mt-2">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                      <Zap size={14} className="text-yellow-500" /> Analyst Verdict (AI)
                    </div>
                    <ul className="flex flex-col gap-2">
                      {signal.ai_context.map((bullet, i) => (
                        <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
                          <span className="text-yellow-500 mt-1">•</span> {bullet}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))}
          {filteredSignals.length === 0 && (
            <div className="empty-state">No active signals found for this filter.</div>
          )}
        </div>
      )}
    </div>
  );
}
