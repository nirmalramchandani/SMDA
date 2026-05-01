import { useState, useCallback } from 'react';
import FileUploader from '../components/FileUploader';
import Checklist from '../components/Checklist';
import TerminalOutput from '../components/TerminalOutput';
import ProgressBar from '../components/ProgressBar';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const PHASE1_CHECKS = [
  ['col_normalize', 'Column names normalized'],
  ['type_clean', 'Data types cleaned (qty, price, date)'],
  ['alias_map', 'Investor name aliases applied'],
  ['symbol_map', 'Stock symbol mappings applied'],
  ['dedup', 'Duplicate rows removed'],
  ['intraday', 'Intraday orders filtered'],
  ['events_clean', 'Corporate events cleaned'],
];

const PHASE2_CHECKS = [
  ['sort', 'Chronological Date Sorting'],
  ['corp_actions', 'Corporate Adjustments (Bonus/Split)'],
  ['fifo', 'FIFO Lot Matching Logic'],
  ['short_guard', 'Short-Sell Guard Check'],
  ['sync_pg', 'PostgreSQL Sink (Immediate Commit)'],
  ['sync_mongo', 'MongoDB Sink (Immediate Sync)'],
  ['snapshots', 'Monthly Snapshot Logic'],
];

function parseSSEStream(response, onData) {
  return new Promise((resolve, reject) => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    function read() {
      reader.read().then(({ done, value }) => {
        if (done) {
          resolve();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          let payload = trimmed;
          if (payload.startsWith('data: ')) payload = payload.slice(6);

          try {
            const data = JSON.parse(payload);
            onData(data);
          } catch {
            // Skip non-JSON lines
          }
        }
        read();
      }).catch(reject);
    }
    read();
  });
}

export default function PipelinePage() {
  // File state
  const [txnFile, setTxnFile] = useState(null);
  const [evtFile, setEvtFile] = useState(null);

  // Phase 1 state
  const [phase1Running, setPhase1Running] = useState(false);
  const [phase1Done, setPhase1Done] = useState(false);
  const [phase1Checks, setPhase1Checks] = useState({});
  const [phase1Logs, setPhase1Logs] = useState([]);
  const [phase1Progress, setPhase1Progress] = useState(0);

  // Clean paths
  const [cleanTxnPath, setCleanTxnPath] = useState(null);
  const [cleanEvtPath, setCleanEvtPath] = useState(null);

  // Phase 2 state
  const [phase2Running, setPhase2Running] = useState(false);
  const [phase2Done, setPhase2Done] = useState(false);
  const [phase2Checks, setPhase2Checks] = useState({});
  const [phase2Logs, setPhase2Logs] = useState([]);
  const [phase2Progress, setPhase2Progress] = useState(0);
  const [telemetry, setTelemetry] = useState('');
  const [isPaused, setIsPaused] = useState(false);

  // Checkpoint
  const [checkpoint, setCheckpoint] = useState(-1);

  // Error + clear
  const [error, setError] = useState(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearStatus, setClearStatus] = useState(null);

  // ─── Phase 1: Clean ──────────────────────────────────────────────
  const runPhase1 = useCallback(async () => {
    if (!txnFile) {
      setError('Transactions CSV is required!');
      return;
    }

    setError(null);
    setPhase1Running(true);
    setPhase1Done(false);
    setPhase1Checks({});
    setPhase1Logs([]);
    setPhase1Progress(0);

    try {
      const formData = new FormData();
      formData.append('transactions', txnFile);
      if (evtFile) formData.append('events', evtFile);

      const resp = await fetch(`${API_BASE}/upload/clean`, {
        method: 'POST',
        body: formData,
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }

      let cleanPaths = null;

      await parseSSEStream(resp, (data) => {
        // Handle CLEAN_PATHS
        if (data.type === 'CLEAN_PATHS') {
          cleanPaths = data;
          return;
        }

        let msg = data.message || '';
        let pct = data.progress || 0;

        // Parse [PROGRESS|nn]
        if (msg.includes('[PROGRESS|')) {
          const parts = msg.split(']', 2);
          pct = parseInt(parts[0].replace('[PROGRESS|', ''));
          msg = parts[1]?.trim() || msg;
        }

        pct = Math.max(0, Math.min(100, pct));
        setPhase1Progress(pct);

        // Checklist
        if (data.type === 'CHECK') {
          setPhase1Checks((prev) => ({
            ...prev,
            [data.check_id]: data.check_status || 'done',
          }));
        }

        // Terminal
        if (msg && !msg.includes('[PROGRESS')) {
          setPhase1Logs((prev) => [...prev.slice(-50), msg]);
        }

        // Error
        if (data.type === 'ERROR') {
          setError(data.message);
        }
      });

      if (cleanPaths) {
        setCleanTxnPath(cleanPaths.clean_txn_path);
        setCleanEvtPath(cleanPaths.clean_evt_path || null);
        setPhase1Done(true);

        // Check checkpoint
        try {
          const cpResp = await fetch(
            `${API_BASE}/upload/checkpoint?clean_txn_path=${encodeURIComponent(cleanPaths.clean_txn_path)}`
          );
          if (cpResp.ok) {
            const cpData = await cpResp.json();
            setCheckpoint(cpData.checkpoint ?? -1);
          }
        } catch {
          // Ignore checkpoint errors
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPhase1Running(false);
    }
  }, [txnFile, evtFile]);

  // ─── Phase 2: Ingest ─────────────────────────────────────────────
  const runPhase2 = useCallback(async (resume = false) => {
    if (!cleanTxnPath) return;

    setError(null);
    setPhase2Running(true);
    setPhase2Done(false);
    setPhase2Checks({});
    setPhase2Logs([]);
    setPhase2Progress(0);
    setTelemetry('');

    try {
      let url = `${API_BASE}/upload/ingest?clean_txn_path=${encodeURIComponent(cleanTxnPath)}&resume=${resume}`;
      if (cleanEvtPath) {
        url += `&clean_evt_path=${encodeURIComponent(cleanEvtPath)}`;
      }

      const resp = await fetch(url, { method: 'POST' });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }

      await parseSSEStream(resp, (data) => {
        let msg = data.message || '';
        let pct = data.progress || 0;

        if (msg.includes('[PROGRESS|')) {
          const parts = msg.split(']', 2);
          pct = parseInt(parts[0].replace('[PROGRESS|', ''));
          const actual = parts[1]?.trim() || '';
          if (actual.includes('|')) {
            setTelemetry(actual);
          }
          msg = actual;
        }

        pct = Math.max(0, Math.min(100, pct));
        setPhase2Progress(pct);

        if (data.type === 'CHECK') {
          setPhase2Checks((prev) => ({
            ...prev,
            [data.check_id]: data.check_status || 'done',
          }));
        }

        if (msg && !msg.includes('[PROGRESS')) {
          setPhase2Logs((prev) => [...prev.slice(-50), msg]);
        }

        if (data.type === 'ERROR') {
          setError(data.message);
        }
      });

      setPhase2Done(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setPhase2Running(false);
      setIsPaused(false);
    }
  }, [cleanTxnPath, cleanEvtPath]);

  const handlePause = async () => {
    try {
      await fetch(`${API_BASE}/upload/pause`, { method: 'POST' });
      setIsPaused(true);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleResume = async () => {
    try {
      await fetch(`${API_BASE}/upload/resume`, { method: 'POST' });
      setIsPaused(false);
    } catch (err) {
      setError(err.message);
    }
  };

  // ─── Clear All Data ──────────────────────────────────────────────
  const clearAllData = useCallback(async () => {
    try {
      setClearStatus('clearing');
      const resp = await fetch(`${API_BASE}/data/clear`, { method: 'POST' });
      if (resp.ok) {
        setClearStatus('success');
        setTimeout(() => {
          setShowClearModal(false);
          setClearStatus(null);
        }, 1500);
      } else {
        setClearStatus('error');
      }
    } catch {
      setClearStatus('error');
    }
  }, []);

  return (
    <>
      {/* Page Header */}
      <div className="page-header">
        <h2>⚙️ Pipeline Control</h2>
        <p className="description">Upload, clean, validate, and ingest financial data into the SMDA engine.</p>
      </div>

      {/* Error */}
      {error && (
        <div className="status-message status-error mb-lg">
          <span>❌</span>
          <span>{error}</span>
          <button
            className="btn btn-sm btn-secondary"
            style={{ marginLeft: 'auto' }}
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ─── File Upload ─────────────────────────────────────────────── */}
      <div className="card mb-lg">
        <div className="card-header">
          <span className="card-title">📁 Data Files</span>
          <button
            className="btn btn-sm btn-danger"
            onClick={() => setShowClearModal(true)}
          >
            🗑️ Clear All Data
          </button>
        </div>
        <div className="upload-grid">
          <FileUploader
            label="Transactions File"
            required
            file={txnFile}
            onFileSelect={setTxnFile}
          />
          <FileUploader
            label="Events File"
            required={false}
            file={evtFile}
            onFileSelect={setEvtFile}
          />
        </div>
        <button
          className="btn btn-primary btn-lg w-full"
          onClick={runPhase1}
          disabled={phase1Running || !txnFile}
        >
          {phase1Running ? (
            <>
              <span className="spinner" />
              Cleaning...
            </>
          ) : (
            '🧹 Step 1: Upload & Clean'
          )}
        </button>
      </div>

      {/* ─── Phase 1 Output ──────────────────────────────────────────── */}
      {(phase1Running || phase1Done) && (
        <div className="card mb-lg phase-section">
          <div className="card-header">
            <span className="card-title">Phase 1 — Cleaning & Validation</span>
            {phase1Done && <span className="badge badge-success">Complete</span>}
            {phase1Running && <span className="badge badge-info">Running</span>}
          </div>
          <ProgressBar percent={phase1Progress} label="Cleaning Pipeline" />
          <div className="phase-content">
            <div>
              <h4 style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-sm)' }}>
                Validation Checklist
              </h4>
              <Checklist checks={PHASE1_CHECKS} completed={phase1Checks} />
            </div>
            <div>
              <h4 style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-sm)' }}>
                Live Terminal
              </h4>
              <TerminalOutput logs={phase1Logs} />
            </div>
          </div>
          {phase1Done && (
            <div className="status-message status-success mt-lg">
              <span>✅</span>
              <span>Cleaning complete! Proceed to Phase 2.</span>
            </div>
          )}
        </div>
      )}

      <hr className="phase-divider" />

      {/* ─── Phase 2 ─────────────────────────────────────────────────── */}
      {cleanTxnPath ? (
        <div className="card mb-lg">
          <div className="card-header">
            <span className="card-title">Phase 2 — Ingestion & Database Write</span>
          </div>

          <div className="status-message status-info mb-md">
            <span>📦</span>
            <span>Cleaned data ready for ingestion</span>
          </div>

          <div className="flex gap-md">
            {checkpoint >= 0 ? (
              <>
                <button
                  className="btn btn-primary btn-lg"
                  onClick={() => runPhase2(true)}
                  disabled={phase2Running}
                  style={{ flex: 1 }}
                >
                  {phase2Running ? (
                    <>
                      <span className="spinner" />
                      Ingesting...
                    </>
                  ) : (
                    `⏯️ Resume Ingest (from row ${checkpoint + 1})`
                  )}
                </button>
                <button
                  className="btn btn-secondary btn-lg"
                  onClick={() => runPhase2(false)}
                  disabled={phase2Running}
                >
                  🔄 Start Over
                </button>
              </>
            ) : (
              <button
                className="btn btn-primary btn-lg w-full"
                onClick={() => runPhase2(false)}
                disabled={phase2Running}
              >
                {phase2Running ? (
                  <>
                    <span className="spinner" />
                    Ingesting...
                  </>
                ) : (
                  '✅ Step 2: Proceed to Ingest (ACID)'
                )}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center text-muted" style={{ padding: 'var(--space-xl)' }}>
          ⬆️ Upload files and run Step 1 first to unlock Step 2.
        </div>
      )}

      {/* ─── Phase 2 Output ──────────────────────────────────────────── */}
      {(phase2Running || phase2Done) && (
        <div className="card mb-lg phase-section">
          <div className="card-header">
            <span className="card-title">Ingestion Progress</span>
            <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
              {phase2Running && !isPaused && (
                <button className="btn btn-sm btn-secondary" onClick={handlePause}>⏸️ Pause</button>
              )}
              {phase2Running && isPaused && (
                <button className="btn btn-sm btn-primary" onClick={handleResume}>▶️ Resume</button>
              )}
              {phase2Done && <span className="badge badge-success">Complete</span>}
              {phase2Running && <span className="badge badge-info">{isPaused ? 'Paused' : 'Running'}</span>}
            </div>
          </div>

          {telemetry && (
            <div className="status-message status-info mb-md">
              <span>🚀</span>
              <strong>{telemetry}</strong>
            </div>
          )}

          <ProgressBar percent={phase2Progress} label="Ingestion Pipeline" />

          <div className="phase-content">
            <div>
              <h4 style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-sm)' }}>
                Ingestion Checklist
              </h4>
              <Checklist checks={PHASE2_CHECKS} completed={phase2Checks} />
            </div>
            <div>
              <h4 style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-sm)' }}>
                Live Terminal & Telemetry
              </h4>
              <TerminalOutput logs={phase2Logs} />
            </div>
          </div>

          {phase2Done && (
            <div className="status-message status-success mt-lg">
              <span>🎉</span>
              <span>Ingestion complete! Data is now in your databases.</span>
            </div>
          )}
        </div>
      )}

      {/* ─── Clear Modal ─────────────────────────────────────────────── */}
      {showClearModal && (
        <div className="modal-overlay" onClick={() => !clearStatus && setShowClearModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>⚠️ Clear All Data</h3>
            <p>
              This will permanently delete <strong>ALL data</strong> from PostgreSQL and MongoDB.
              This action cannot be undone.
            </p>
            {clearStatus === 'success' ? (
              <div className="status-message status-success">
                <span>✅</span> Database purged successfully!
              </div>
            ) : clearStatus === 'error' ? (
              <div className="status-message status-error">
                <span>❌</span> Failed to clear database.
              </div>
            ) : (
              <div className="modal-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowClearModal(false)}
                  disabled={clearStatus === 'clearing'}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-danger"
                  onClick={clearAllData}
                  disabled={clearStatus === 'clearing'}
                >
                  {clearStatus === 'clearing' ? (
                    <>
                      <span className="spinner" />
                      Clearing...
                    </>
                  ) : (
                    '🔥 Yes, Clear Everything'
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
