import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSMDAData } from '../hooks/useSMDA';
import { ArrowLeft, User, Crosshair, Calendar, Target, Activity, TrendingUp } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

export default function InvestorDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { investors, sells, loading } = useSMDAData();

  const profile = useMemo(() => {
    return investors.find(i => i._id === id);
  }, [investors, id]);

  const clientTrades = useMemo(() => {
    if (!profile || !sells.length) return [];
    return sells
      .filter(s => s.client_id === id)
      .sort((a, b) => new Date(a.sell_date) - new Date(b.sell_date));
  }, [sells, id, profile]);

  const stats = useMemo(() => {
    if (!clientTrades.length) return null;
    let realized = 0;
    let wins = 0;
    
    // Timeline logic
    let cumPnl = 0;
    const timeline = [];

    for (const trade of clientTrades) {
      realized += trade.pnl_amount;
      if (trade.pnl_amount > 0) wins++;
      
      cumPnl += trade.pnl_amount;
      timeline.push({
        date: trade.sell_date?.slice(0, 10),
        pnl: Math.round(cumPnl * 100) / 100
      });
    }

    return {
      firstTrade: clientTrades[0].sell_date?.slice(0, 10),
      lastTrade: clientTrades[clientTrades.length - 1].sell_date?.slice(0, 10),
      realized,
      winRate: (wins / clientTrades.length) * 100,
      trades: clientTrades.length,
      timeline
    };
  }, [clientTrades]);

  if (loading) return <div className="loader-container"><div className="spinner" /></div>;

  if (!profile) {
    return (
      <div className="glass-card text-center text-muted">
        Entity {id} not found in the Smart Money dataset.
      </div>
    );
  }

  const scores = profile.ranking_scores || {};

  return (
    <div>
      <div className="page-header flex items-center justify-between mb-8">
        <div>
          <button className="nav-link text-muted mb-4" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} /> Back to Hub
          </button>
          <h1 className="page-title flex items-center gap-4">
            <User color="var(--accent-blue)" size={36} /> Profile {id}
          </h1>
          <p className="page-subtitle">Deep dive dossier on investor trading patterns.</p>
        </div>
      </div>

      <div className="grid-4 mb-8">
        <div className="glass-card flex flex-col items-start gap-2">
          <span className="text-secondary flex items-center gap-2"><Target size={16}/> Smart Rating</span>
          <span className="page-title text-glow-success">{scores.smart_money_score?.toFixed(1) || '0.0'}</span>
        </div>
        <div className="glass-card flex flex-col items-start gap-2">
          <span className="text-secondary flex items-center gap-2"><Crosshair size={16}/> Conviction</span>
          <span className="page-title">{scores.conviction_score?.toFixed(1) || '0.0'}</span>
        </div>
        <div className="glass-card flex flex-col items-start gap-2">
          <span className="text-secondary flex items-center gap-2"><Activity size={16}/> Consistency</span>
          <span className="page-title">{scores.consistency_score?.toFixed(1) || '0.0'}</span>
        </div>
        <div className="glass-card flex flex-col items-start gap-2">
          <span className="text-secondary flex items-center gap-2"><TrendingUp size={16}/> Risk Mgmt</span>
          <span className="page-title">{scores.risk_management_score?.toFixed(1) || '0.0'}</span>
        </div>
      </div>

      <div className="grid-2 mb-8">
        <div className="glass-card">
          <div className="card-title">Trading Dossier Overview</div>
          <div className="grid-2 mt-4">
            <div>
              <div className="text-sm text-muted mb-1 flex items-center gap-2"><Calendar size={14}/> First Active</div>
              <div className="font-mono">{stats?.firstTrade || 'Unknown'}</div>
            </div>
            <div>
              <div className="text-sm text-muted mb-1 flex items-center gap-2"><Calendar size={14}/> Last Active</div>
              <div className="font-mono">{stats?.lastTrade || 'Unknown'}</div>
            </div>
            <div className="mt-4">
              <div className="text-sm text-muted mb-1 flex items-center gap-2"><ArrowLeft size={14}/> Realized PnL</div>
              <div className={`font-mono font-bold ${(stats?.realized || 0) >= 0 ? 'text-glow-success' : 'text-glow-danger'}`}>
                {(stats?.realized || 0) >= 0 ? '+' : '-'}${Math.abs(stats?.realized || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="mt-4">
              <div className="text-sm text-muted mb-1 flex items-center gap-2"><Crosshair size={14}/> Win Rate</div>
              <div className="font-mono">
                {stats?.winRate?.toFixed(1)}% <span className="text-muted text-sm">({stats?.trades} closed)</span>
              </div>
            </div>
          </div>
        </div>

        <div className="glass-card">
           <div className="card-title">Historical Wealth Trajectory</div>
           <div style={{ height: '220px' }}>
              {stats?.timeline ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={1}>
                  <AreaChart data={stats.timeline}>
                    <defs>
                      <linearGradient id="colorPnLTrait" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--accent-blue)" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="var(--accent-blue)" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" hide />
                    <YAxis width={60} />
                    <Tooltip contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: '8px' }} />
                    <Area type="monotone" dataKey="pnl" stroke="var(--accent-blue)" strokeWidth={2} fillOpacity={1} fill="url(#colorPnLTrait)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted">No historical trace available.</div>
              )}
           </div>
        </div>
      </div>
      
      <div className="glass-card">
        <div className="card-title">Recent Entity Executions</div>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Asset</th>
                <th>Quantity</th>
                <th>Yield (%)</th>
                <th>Action Type</th>
              </tr>
            </thead>
            <tbody>
              {clientTrades.slice().reverse().slice(0, 15).map((t, idx) => (
                <tr key={idx}>
                  <td className="mono text-muted">{t.sell_date?.slice(0, 10)}</td>
                  <td className="font-bold">{t.symbol}</td>
                  <td className="mono">{t.sell_quantity}</td>
                  <td className={(t.pnl_percentage || 0) >= 0 ? "text-glow-success" : "text-glow-danger"}>
                    {(t.pnl_percentage || 0) >= 0 ? '+' : '-'}{Math.abs(t.pnl_percentage || 0).toFixed(2)}%
                  </td>
                  <td><span className="badge badge-info">{t.exit_type}</span></td>
                </tr>
              ))}
              {clientTrades.length === 0 && (
                <tr>
                   <td colSpan="5" className="text-center text-muted" style={{ padding: '2rem' }}>No direct sell orders found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
