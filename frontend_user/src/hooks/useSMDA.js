import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

let globalData = null;
let fetchPromise = null;

export function useSMDAData() {
  const [data, setData] = useState(globalData || { investors: [], sells: [], transactions: [] });
  const [loading, setLoading] = useState(!globalData);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (globalData) {
      setData(globalData);
      setLoading(false);
      return;
    }

    setLoading(true);

    if (!fetchPromise) {
      fetchPromise = Promise.all([
        fetch(`${API_BASE}/data/investors?limit=1000`),
        fetch(`${API_BASE}/data/sells?limit=1000`),
        fetch(`${API_BASE}/data/transactions?limit=2000`)
      ])
      .then(async ([invResp, sellResp, txResp]) => {
        if (!invResp.ok || !sellResp.ok || !txResp.ok) throw new Error('API connection failed.');
        const invData = await invResp.json();
        const sellData = await sellResp.json();
        const txData = await txResp.json();
        
        globalData = {
          investors: invData.data || [],
          sells: sellData.data || [],
          transactions: txData.data || []
        };
        return globalData;
      });
    }

    fetchPromise
      .then(res => {
        setData(res);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
        fetchPromise = null; // allow future retries
      });
  }, []);

  return { ...data, loading, error };
}
