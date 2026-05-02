import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSMDAData } from '../hooks/useSMDA';
import { Trophy, TrendingUp, Calendar, AlertCircle } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const TIME_FILTERS = [
  { label: '15 Days', days: 15 },
  { label: '30 Days', days: 30 },
  { label: '2 Months', days: 60 },
  { label: '1 Year', days: 365 },
  { label: '5 Years', days: 1825 },
  { label: '15 Years', days: 5475 },
];

export default function Dashboard() {
  const { investors, sells, loading, error } = useSMDAData();
  const [daysFilter, setDaysFilter] = useState(365); // default 1 Year
  const navigate = useNavigate();

  // 1. Filter Sells by Time Range
  const filteredSells = useMemo(() => {
    if (!sells.length) return [];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysFilter);

    return sells.filter((s) => {
      const sellDate = new Date(s.sell_date);
      return sellDate >= cutoffDate;
    });
  }, [sells, daysFilter]);

  // 2. Aggregate Top Performers via PnL
  const topPerformers = useMemo(() => {
    if (!filteredSells.length) return [];
    
    const clientPnl = {};
    for (const s of filteredSells) {
      if (!clientPnl[s.client_id]) clientPnl[s.client_id] = 0;
      clientPnl[s.client_id] += (s.pnl_amount || 0);
    }

    // Map scores from investors collection
    const profileMap = {};
    for (const inv of investors) {
      profileMap[inv._id] = inv.ranking_scores?.smart_money_score || 0;
    }

    const sorted = Object.entries(clientPnl)
      .map(([id, pnl]) => ({
        id,
        pnl,
        smartScore: profileMap[id] || 0
      }))
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, 10); // top 10
      
    return sorted;
  }, [filteredSells, investors]);

  // 3. Market Trend (Aggregated PnL over time for chart)
  const marketTrend = useMemo(() => {
    const trendMap = {};
    for (const s of filteredSells) {
      const date = s.sell_date?.slice(0, 10);
      if (!date) continue;
      if (!trendMap[date]) trendMap[date] = 0;
      trendMap[date] += (s.pnl_amount || 0);
    }
    
    // Convert to cumulative series logic over the period
    let cumulative = 0;
    return Object.entries(trendMap)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, amount]) => {
        cumulative += amount;
        return { date, pnl: cumulative };
      });
  }, [filteredSells]);

  if (loading) {
    return (
      <div className="loader-container">
        <div className="spinner" />
        <p>Analyzing Smart Money Data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card flex items-center gap-4 text-glow-danger" style={{ borderColor: 'var(--accent-rose)' }}>
        <AlertCircle size={24} />
        <div>
          <h3>System Error</h3>
          <p className="text-muted">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header flex justify-between items-center">
        <div>
          <h1 className="page-title">Top Performers</h1>
          <p className="page-subtitle">Track the most successful bulk investors.</p>
        </div>

        <div className="flex items-center gap-2">
          <Calendar size={18} color="var(--text-secondary)" />
          <select 
            className="select-filter" 
            value={daysFilter}
            onChange={(e) => setDaysFilter(Number(e.target.value))}
          >
            {TIME_FILTERS.map(f => (
              <option key={f.days} value={f.days}>{f.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid-3 mb-8">
        <div className="glass-card">
          <div className="card-title"><Trophy size={18} color="var(--accent-amber)" /> Elite Entity Count</div>
          <div className="page-title">{topPerformers.length}</div>
          <div className="text-muted text-sm">Active profitable entities in period</div>
        </div>
        <div className="glass-card" style={{ gridColumn: 'span 2' }}>
          <div className="card-title"><TrendingUp size={18} color="var(--accent-emerald)" /> Cumulative Period PnL</div>
          <div style={{ height: "130px", width: "100%" }}>
            {marketTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={1}>
                <AreaChart data={marketTrend}>
                  <defs>
                    <linearGradient id="colorPnl" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-blue)" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="var(--accent-blue)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: 'none', borderRadius: '8px' }} 
                    itemStyle={{ color: 'var(--text-primary)' }}
                  />
                  <Area type="monotone" dataKey="pnl" stroke="var(--accent-blue)" fillOpacity={1} fill="url(#colorPnl)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
               <div className="flex items-center justify-center h-full text-muted">No trend data for period.</div>
            )}
          </div>
        </div>
      </div>

      <div className="glass-card">
        <div className="card-title mb-4">Current Top Performers Rank</div>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Investor ID</th>
                <th>Period PnL</th>
                <th>Global Smart Score</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {topPerformers.length > 0 ? (
                 topPerformers.map((row, index) => (
                  <tr key={row.id}>
                    <td>
                      <span className="badge badge-info" style={{ backgroundColor: index === 0 ? 'rgba(245, 158, 11, 0.2)' : '', color: index === 0 ? 'var(--accent-amber)' : '' }}>
                        #{index + 1}
                      </span>
                    </td>
                    <td className="mono">{row.id}</td>
                    <td className={row.pnl >= 0 ? 'text-glow-success' : 'text-glow-danger'}>
                      {row.pnl >= 0 ? '+' : '-'}₹{Math.abs(row.pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td>{row.smartScore.toFixed(2)}</td>
                    <td className="text-right">
                      <button 
                         className="select-filter" 
                         style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                         onClick={() => navigate(`/investor/${row.id}`)}
                      >
                         Deep Dive →
                      </button>
                    </td>
                  </tr>
                 ))
              ) : (
                 <tr>
                    <td colSpan="5" className="text-center" style={{ padding: '2rem' }}>
                       <span className="text-muted">No profitable trades found in this period.</span>
                    </td>
                 </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
