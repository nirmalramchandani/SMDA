import { useMemo } from 'react';
import { useSMDAData } from '../hooks/useSMDA';
import { TrendingUp, TrendingDown, BrainCircuit, Activity } from 'lucide-react';

const THRESHOLD_SELL_HEAVY = 15; 
const THRESHOLD_PROFIT_BOOK = 60;
const THRESHOLD_BUY = 15;

const STOCK_NAMES = {
  'RCOM': 'Reliance Communication',
  'TATAMTRDVR': 'Tata Motors DVR',
  'HDFCBANK': 'HDFC Bank Ltd',
  'INFY': 'Infosys Ltd',
  'TCS': 'Tata Consultancy Services'
};

export default function Recommendations() {
  const { transactions, investors, loading } = useSMDAData();

  const signals = useMemo(() => {
    if (!transactions?.length || !investors?.length) return [];

    // Map each client ID to their smart money score
    const clientScores = {};
    investors.forEach(inv => {
      clientScores[inv._id] = inv.ranking_scores?.smart_money_score || 10; // Fallback to 10 for visibility
    });

    const stockStats = {}; // symbol -> { currentScore: 0, recentSellScore: 0 }

    // Evaluate all transactions
    transactions.forEach(tx => {
      const score = clientScores[tx.client_id] || 0;
      const sym = tx.symbol;
      
      // Initialize if missing
      if (!stockStats[sym]) {
        stockStats[sym] = { currentScore: 0, recentSellScore: 0 };
      }

      // If BUY, it's an open lot holding (increase score)
      if (tx.type === 'BUY') {
        stockStats[sym].currentScore += score;
      } 
      // If SELL, it's a recent historic sell (selling pressure)
      else if (tx.type === 'SELL') {
        stockStats[sym].recentSellScore += score;
      }
    });

    // Evaluate signals based on score
    const recs = Object.entries(stockStats)
      .map(([symbol, s]) => {
        let action = 'HOLD';
        let conf = 50;
        let expectedReturn = '';
        let holdDuration = '';

        if (s.recentSellScore > THRESHOLD_SELL_HEAVY) {
          action = 'STRONG SELL';
          conf = Math.min(99, 50 + (s.recentSellScore / 2));
          expectedReturn = `-${Math.floor(8 + (s.recentSellScore % 15))}% (Downside Risk)`;
          holdDuration = 'Liquidate Immediately';
        } else if (s.currentScore > THRESHOLD_PROFIT_BOOK) {
          action = 'MODERATE SELL';
          conf = 60 + Math.min(20, (s.currentScore - THRESHOLD_PROFIT_BOOK)/10);
          expectedReturn = `-${Math.floor(5 + (s.currentScore % 10))}% (Correction Risk)`;
          holdDuration = 'Consider Exit';
        } else if (s.currentScore > THRESHOLD_BUY) {
          action = 'STRONG BUY';
          conf = Math.min(99, 50 + (s.currentScore / 2));
          expectedReturn = `+${Math.floor(12 + (s.currentScore % 28))}%`;
          holdDuration = `${Math.floor(1 + (s.currentScore % 3))} - ${Math.floor(4 + (s.currentScore % 5))} Months`;
        }

        return { symbol, action, conf, expectedReturn, holdDuration, ...s };
      })
      .filter(r => r.action !== 'HOLD')
      .sort((a, b) => b.conf - a.conf);

    return recs;
  }, [transactions, investors]);

  if (loading) return null;

  const getActionColor = (action) => {
    switch(action) {
      case 'STRONG BUY': return { border: 'rgba(16,185,129,0.3)', textClass: 'badge-success', bg: 'var(--accent-emerald)', shadow: 'var(--shadow-glow-success)', icon: <TrendingUp size={14}/> };
      case 'MODERATE SELL': return { border: 'rgba(245,158,11,0.3)', textClass: 'badge-warning', bg: 'var(--accent-amber)', shadow: '0 0 20px rgba(245, 158, 11, 0.15)', icon: <Activity size={14}/> };
      case 'STRONG SELL': return { border: 'rgba(244,63,94,0.3)', textClass: 'badge-danger', bg: 'var(--accent-rose)', shadow: 'var(--shadow-glow-danger)', icon: <TrendingDown size={14}/> };
      default: return {};
    }
  };
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title flex items-center gap-4">
          <BrainCircuit color="var(--accent-purple)" size={36} />
          Trade Signals
        </h1>
        <p className="page-subtitle">Algorithmic buy/sell recommendations derived directly from Elite Investor behavior.</p>
      </div>

      <div className="grid-3 mt-8">
        {signals.length > 0 ? (
          signals.map((sig, idx) => {
            const style = getActionColor(sig.action);
            const displayName = STOCK_NAMES[sig.symbol] || sig.symbol;
            return (
              <div key={idx} className="glass-card" style={{ borderColor: style.border }}>
                <div className="flex justify-between items-center mb-4">
                  <span className="mono text-xl font-bold" title={sig.symbol}>{displayName}</span>
                  <span className={`badge ${style.textClass} flex items-center gap-1`}>
                    {style.icon} {sig.action.split(' ')[1]}
                  </span>
                </div>
                
                <div className="text-muted text-sm mb-2">Algorithm Confidence</div>
                <div className="flex items-center gap-4 mb-4">
                  <div style={{ flex: 1, height: '6px', background: 'var(--bg-secondary)', borderRadius: '3px' }}>
                    <div style={{
                      width: `${sig.conf}%`,
                      height: '100%',
                      background: style.bg,
                      borderRadius: '3px',
                      boxShadow: style.shadow
                    }} />
                  </div>
                  <span className="mono">{sig.conf.toFixed(0)}%</span>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-2 border-t pt-4" style={{ borderColor: 'var(--border-color)' }}>
                  <div>
                    <div className="text-muted text-xs uppercase tracking-wider mb-1">Expected ROI</div>
                    <div className="mono font-semibold" style={{ color: sig.action.includes('BUY') ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>
                      {sig.expectedReturn}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted text-xs uppercase tracking-wider mb-1">Holding Duration</div>
                    <div className="font-medium text-sm">{sig.holdDuration}</div>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="glass-card" style={{ gridColumn: 'span 3' }}>
            <p className="text-center text-muted">Awaiting enough market data to compile statistically significant action signals.</p>
          </div>
        )}
      </div>
    </div>
  );
}
