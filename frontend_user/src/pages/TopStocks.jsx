import { useMemo } from 'react';
import { useSMDAData } from '../hooks/useSMDA';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { TrendingUp } from 'lucide-react';
import { getStockName } from '../utils/stockMap';

export default function TopStocks() {
  const { sells, loading } = useSMDAData();

  const stockPerformance = useMemo(() => {
    if (!sells.length) return [];
    
    const agg = {};
    for (const s of sells) {
      const sym = s.symbol;
      if (!agg[sym]) agg[sym] = { symbol: sym, pnl: 0, volume: 0, winCount: 0, tradeCount: 0 };
      
      agg[sym].pnl += (s.pnl_amount || 0);
      agg[sym].volume += (s.sell_quantity || 0);
      agg[sym].tradeCount += 1;
      if (s.pnl_amount > 0) agg[sym].winCount += 1;
    }

    return Object.values(agg)
      .map(item => ({
        ...item,
        winRate: (item.winCount / item.tradeCount) * 100
      }))
      .sort((a, b) => b.pnl - a.pnl);
  }, [sells]);

  const top10 = stockPerformance.slice(0, 10);

  if (loading) return null;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title flex items-center gap-4">
          <TrendingUp color="var(--accent-emerald)" size={36} /> Top Stocks
        </h1>
        <p className="page-subtitle">Highest returned symbols aggregated across the entire network.</p>
      </div>

      <div className="grid-2 mb-8">
        <div className="glass-card">
          <div className="card-title">Cumulative PnL Leaders</div>
          <div style={{ height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={1}>
              <BarChart data={top10.map(item => ({...item, displayName: getStockName(item.symbol)}))} layout="vertical" margin={{ top: 0, right: 0, left: 30, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" />
                <YAxis dataKey="displayName" type="category" width={100} />
                <Tooltip cursor={{fill: 'rgba(255,255,255,0.05)'}} />
                <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
                  {top10.map((entry, index) => (
                    <Cell key={index} fill={entry.pnl >= 0 ? "var(--accent-emerald)" : "var(--accent-rose)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-card">
          <div className="card-title">Trade Volume Matrix</div>
          <div style={{ height: '300px' }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={1}>
              <BarChart data={top10.map(item => ({...item, displayName: getStockName(item.symbol)}))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="displayName" />
                <YAxis />
                <Tooltip cursor={{fill: 'rgba(255,255,255,0.05)'}} />
                <Bar dataKey="volume" fill="var(--accent-blue)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="glass-card">
        <div className="card-title mb-4">Stock Hall of Fame</div>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Global PnL</th>
                <th>Total Volume Traded</th>
                <th>Win Rate</th>
              </tr>
            </thead>
            <tbody>
              {stockPerformance.map(stock => (
                <tr key={stock.symbol}>
                  <td className="font-bold" style={{ color: 'var(--text-primary)'}} title={stock.symbol}>
                    {getStockName(stock.symbol)}
                  </td>
                  <td className={stock.pnl >= 0 ? "text-glow-success" : "text-glow-danger"}>
                    {stock.pnl >= 0 ? '+' : '-'}₹{Math.abs(stock.pnl).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td>{stock.volume.toLocaleString()}</td>
                  <td>
                    <span className={stock.winRate > 60 ? "badge badge-success" : (stock.winRate < 40 ? "badge badge-danger" : "badge badge-warning")}>
                      {stock.winRate.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
