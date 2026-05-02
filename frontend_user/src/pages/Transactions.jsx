import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function Transactions() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/data/transactions?limit=1000`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch transactions');
        return res.json();
      })
      .then(data => {
        setTransactions(data.data || []);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="p-8 text-center" style={{ color: 'var(--text-secondary)'}}>Loading recent activity...</div>;
  }

  if (error) {
    return <div className="p-8 text-center" style={{ color: 'var(--accent-rose)'}}>Error: {error}</div>;
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title flex items-center gap-4">
          <Clock color="var(--accent-blue)" size={36} /> Recent Activity
        </h1>
        <p className="page-subtitle">Last few days of transaction history across all networks (up to 1 week).</p>
      </div>

      <div className="glass-card">
        <div className="card-title mb-4">Latest Buys & Sells</div>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Client ID</th>
                <th>Action</th>
                <th>Symbol</th>
                <th>Quantity</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((txn, i) => (
                <tr key={txn.id || i}>
                  <td>{txn.date || 'N/A'}</td>
                  <td className="mono" style={{ color: 'var(--text-secondary)'}}>{txn.client_id}</td>
                  <td>
                    <span className={txn.type === 'BUY' ? "badge badge-success" : "badge badge-danger"}>
                      {txn.type}
                    </span>
                  </td>
                  <td className="mono font-bold" style={{ color: 'var(--text-primary)'}}>{txn.symbol}</td>
                  <td>{txn.quantity.toLocaleString()}</td>
                  <td className="mono" style={{ color: 'var(--text-secondary)'}}>₹{txn.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
              {transactions.length === 0 && (
                <tr>
                  <td colSpan="6" className="text-center p-4" style={{ color: 'var(--text-secondary)'}}>
                    No recent transactions found.
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
