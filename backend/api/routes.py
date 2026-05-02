import os
import shutil
import uuid
import json
from datetime import datetime
from fastapi import APIRouter, UploadFile, File, HTTPException, Query, BackgroundTasks
from fastapi.responses import JSONResponse, StreamingResponse

from pipeline.runner import run_clean, run_ingest, get_file_hash
from pipeline.task_manager import TaskManager
from pipeline.notifier import notify_error
from ingestion.processor import IngestProcessor
from db.postgres import get_connection
from db.mongo import investors_collection, investor_metrics_collection

router = APIRouter()

UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


@router.post("/upload/clean")
async def upload_and_clean(
    transactions: UploadFile = File(...),
    events: UploadFile = File(None),
):
    """Phase 1: Upload files and run cleaning/validation. No DB writes."""
    try:
        if not transactions.filename.endswith(".csv"):
            raise HTTPException(status_code=400, detail="Transactions must be a CSV")

        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        uid = uuid.uuid4().hex

        txn_path = os.path.join(UPLOAD_FOLDER, f"{ts}_{uid}_transactions.csv")
        with open(txn_path, "wb") as f:
            shutil.copyfileobj(transactions.file, f)

        events_path = None
        if events:
            if not events.filename.endswith(".csv"):
                raise HTTPException(status_code=400, detail="Events must be a CSV")
            events_path = os.path.join(UPLOAD_FOLDER, f"{ts}_{uid}_events.csv")
            with open(events_path, "wb") as f:
                shutil.copyfileobj(events.file, f)

        return StreamingResponse(
            run_clean(txn_path, events_path),
            media_type="text/event-stream"
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"[api] Clean error: {str(e)}")
        notify_error("Clean Pipeline Error", e, context="Single-file /upload/clean")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload/clean-batch")
async def upload_and_clean_batch(
    transactions: list[UploadFile] = File(...),
    events: list[UploadFile] = File(None),
    txn_order: str = Query(""),
    evt_order: str = Query(""),
):
    """
    Phase 1 (Batch): Accept multiple bulk-deal CSVs and corporate-action CSVs.

    The frontend sends files in order. Optionally, txn_order / evt_order are
    comma-separated original filenames giving the exact merge order.

    All transaction files are concatenated into one CSV, all event files into
    another, then the existing run_clean pipeline processes them.
    """
    import pandas as pd

    try:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        uid = uuid.uuid4().hex

        # ── 1. Validate & save individual transaction files ──────────
        if not transactions or len(transactions) == 0:
            raise HTTPException(status_code=400, detail="At least one transactions CSV is required")

        txn_temp_paths = []  # list of (key, path) to preserve duplicate filenames
        for i, f in enumerate(transactions):
            if not f.filename.endswith(".csv"):
                raise HTTPException(status_code=400, detail=f"File '{f.filename}' is not a CSV")
            temp_path = os.path.join(UPLOAD_FOLDER, f"{ts}_{uid}_batch_{i}_{f.filename}")
            with open(temp_path, "wb") as out:
                shutil.copyfileobj(f.file, out)
            txn_temp_paths.append((f.filename, temp_path))

        # ── 2. Determine merge order for transactions ────────────────
        #    Build lookup: filename → list of paths (handles duplicates)
        txn_lookup = {}
        for name, path in txn_temp_paths:
            txn_lookup.setdefault(name, []).append(path)

        if txn_order:
            ordered_names = [n.strip() for n in txn_order.split(",") if n.strip()]
        else:
            ordered_names = [name for name, _ in txn_temp_paths]

        txn_frames = []
        used_counts = {}  # track which duplicate index to use per name
        for name in ordered_names:
            paths = txn_lookup.get(name, [])
            idx = used_counts.get(name, 0)
            if idx < len(paths):
                df = pd.read_csv(paths[idx])
                txn_frames.append(df)
                used_counts[name] = idx + 1

        if not txn_frames:
            raise HTTPException(status_code=400, detail="No valid transaction files after ordering")

        merged_txn = pd.concat(txn_frames, ignore_index=True)
        merged_txn_path = os.path.join(UPLOAD_FOLDER, f"{ts}_{uid}_transactions.csv")
        merged_txn.to_csv(merged_txn_path, index=False)

        # Clean up temp transaction files
        for _, p in txn_temp_paths:
            try:
                os.remove(p)
            except OSError:
                pass

        # ── 3. Handle event files (optional) ─────────────────────────
        merged_evt_path = None
        if events and len(events) > 0 and events[0].filename:
            evt_temp_paths = []
            for i, f in enumerate(events):
                if not f.filename or not f.filename.endswith(".csv"):
                    continue
                temp_path = os.path.join(UPLOAD_FOLDER, f"{ts}_{uid}_batch_{i}_{f.filename}")
                with open(temp_path, "wb") as out:
                    shutil.copyfileobj(f.file, out)
                evt_temp_paths.append((f.filename, temp_path))

            if evt_temp_paths:
                evt_lookup = {}
                for name, path in evt_temp_paths:
                    evt_lookup.setdefault(name, []).append(path)

                if evt_order:
                    evt_ordered = [n.strip() for n in evt_order.split(",") if n.strip()]
                else:
                    evt_ordered = [name for name, _ in evt_temp_paths]

                evt_frames = []
                evt_used = {}
                for name in evt_ordered:
                    paths = evt_lookup.get(name, [])
                    idx = evt_used.get(name, 0)
                    if idx < len(paths):
                        df = pd.read_csv(paths[idx])
                        evt_frames.append(df)
                        evt_used[name] = idx + 1

                if evt_frames:
                    merged_evt = pd.concat(evt_frames, ignore_index=True)
                    merged_evt_path = os.path.join(UPLOAD_FOLDER, f"{ts}_{uid}_events.csv")
                    merged_evt.to_csv(merged_evt_path, index=False)

                # Clean up temp event files
                for _, p in evt_temp_paths:
                    try:
                        os.remove(p)
                    except OSError:
                        pass

        # ── 4. Delegate to existing clean pipeline ───────────────────
        return StreamingResponse(
            run_clean(merged_txn_path, merged_evt_path),
            media_type="text/event-stream"
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"[api] Batch clean error: {str(e)}")
        notify_error("Batch Clean Error", e, context="Multi-file /upload/clean-batch")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload/ingest", status_code=202)
async def ingest_cleaned(
    background_tasks: BackgroundTasks,
    clean_txn_path: str = Query(...),
    clean_evt_path: str = Query(None),
    resume: bool = Query(False)
):
    """
    Phase 2: Launch ingestion as a background task.
    
    Returns a task_id immediately (202 Accepted). The actual processing runs in a background
    thread that survives browser disconnects. Use /upload/ingest/stream to
    watch progress, or /upload/task/status to poll.
    """
    try:
        if not os.path.exists(clean_txn_path):
            raise HTTPException(status_code=400, detail="Cleaned transaction file not found. Run /upload/clean first.")

        # Check if an ingestion is already running
        existing = TaskManager.get_latest("ingest")
        if existing and existing.status.value == "running":
            # Return the existing task so frontend can reconnect
            return JSONResponse({
                "task_id": existing.task_id,
                "status": "already_running",
                "message": "An ingestion is already in progress. Reconnecting.",
            })

        # Start background task using fastapi BackgroundTasks
        task = TaskManager.create_task(
            name="ingest",
            generator_fn=run_ingest,
            args=(clean_txn_path, clean_evt_path),
            kwargs={"resume": resume},
        )
        task.start()
        background_tasks.add_task(task._run)

        TaskManager.cleanup_old()

        return JSONResponse({
            "task_id": task.task_id,
            "status": "started",
            "message": "Ingestion started in background. Use /upload/ingest/stream to watch progress.",
        }, status_code=202)

    except HTTPException:
        raise
    except Exception as e:
        print(f"[api] Ingest error: {str(e)}")
        notify_error("Ingest Launch Failed", e, context=f"File: {clean_txn_path}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/upload/ingest/stream")
async def stream_ingest(task_id: str = Query(...)):
    """
    SSE stream that reads from a running background task's buffer.
    
    If the browser closes and reopens, just call this again with the same
    task_id to reconnect — the background task keeps running regardless.
    """
    task = TaskManager.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found.")

    return StreamingResponse(
        task.stream(),
        media_type="text/event-stream"
    )


@router.get("/upload/task/status")
async def task_status(task_id: str = Query(None), name: str = Query(None)):
    """
    Check the status of a background task by task_id or by name (e.g. 'ingest').
    Returns status, progress, error info, and timestamps.
    """
    task = None
    if task_id:
        task = TaskManager.get(task_id)
    elif name:
        task = TaskManager.get_latest(name)

    if not task:
        return {"status": "none", "message": "No task found."}

    return task.to_dict()



@router.get("/upload/checkpoint")
async def check_checkpoint(clean_txn_path: str = Query(...)):
    """Check if a checkpoint exists for the given file."""
    if not os.path.exists(clean_txn_path):
        return {"checkpoint": -1}
    
    file_hash = get_file_hash(clean_txn_path)
    checkpoint = IngestProcessor.get_checkpoint(file_hash)
    return {"checkpoint": checkpoint, "file_hash": file_hash}


@router.post("/upload/pause")
async def pause_ingestion():
    """Pause the running ingestion process."""
    IngestProcessor.PAUSED = True
    return {"status": "paused"}


@router.post("/upload/resume")
async def resume_ingestion():
    """Resume the running ingestion process."""
    IngestProcessor.PAUSED = False
    return {"status": "resumed"}


# ─── Data Viewer Endpoints ────────────────────────────────────────────────────

@router.get("/data/investors")
async def get_investors(limit: int = Query(50), skip: int = Query(0)):
    """Return investor profiles from MongoDB, sorted by smart money score."""
    docs = list(investors_collection.find({}, {"portfolio_state.open_lots": 0})
                .sort("ranking_scores.smart_money_score", -1)
                .skip(skip).limit(limit))
    
    # Convert ObjectId and dates to strings for JSON serialization
    for doc in docs:
        doc["_id"] = str(doc["_id"])
    
    total = investors_collection.count_documents({})
    return {"total": total, "data": docs}

@router.get("/data/investors/{investor_id}")
async def get_investor(investor_id: str):
    """Return a single investor profile from MongoDB."""
    doc = investors_collection.find_one({"_id": investor_id}, {"portfolio_state.open_lots": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Investor not found")
    
    doc["_id"] = str(doc["_id"])
    return {"data": doc}


@router.get("/data/sells")
async def get_sell_transactions(limit: int = Query(50), skip: int = Query(0)):
    """Return recent sell transactions from PostgreSQL."""
    query = """
        SELECT client_id, symbol, sell_date, sell_quantity, sell_price,
               pnl_amount, pnl_percentage, exit_type, entry_type
        FROM sell_transactions
        ORDER BY sell_date DESC
        LIMIT %s OFFSET %s
    """
    count_query = "SELECT COUNT(*) FROM sell_transactions"
    
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(count_query)
            total = cur.fetchone()[0]
            
            cur.execute(query, (limit, skip))
            rows = cur.fetchall()
            columns = [desc[0] for desc in cur.description]
    
    data = [dict(zip(columns, row)) for row in rows]
    # Convert dates to strings
    for row in data:
        for k, v in row.items():
            if hasattr(v, 'isoformat'):
                row[k] = v.isoformat()
            elif isinstance(v, float):
                row[k] = round(v, 4)
    
    return {"total": total, "data": data}


@router.get("/data/transactions")
async def get_transactions(limit: int = Query(500)):
    """Return recent buy/sell transactions combined.
    Sells from PostgreSQL, Buys from active open lots in MongoDB.
    Sorted by date descending.
    """
    import uuid
    transactions = []
    
    # 1. Fetch Sells from PG
    query = """
        SELECT client_id, symbol, sell_date, sell_quantity, sell_price
        FROM sell_transactions
        ORDER BY sell_date DESC
        LIMIT %s
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, (limit,))
            rows = cur.fetchall()
            for row in rows:
                transactions.append({
                    "id": str(uuid.uuid4()),
                    "client_id": row[0],
                    "symbol": row[1],
                    "date": row[2].isoformat() if hasattr(row[2], 'isoformat') else row[2],
                    "quantity": row[3],
                    "price": float(row[4]) if row[4] is not None else 0.0,
                    "type": "SELL"
                })
    
    # 2. Fetch Buys from Mongo open lots
    investors = investors_collection.find({}, {"_id": 1, "portfolio_state.open_lots": 1})
    for inv in investors:
        client_id = str(inv["_id"])
        lots = inv.get("portfolio_state", {}).get("open_lots", [])
        for lot in lots:
            transactions.append({
                "id": str(uuid.uuid4()),
                "client_id": client_id,
                "symbol": lot.get("symbol"),
                "date": lot.get("buy_date")[:10] if lot.get("buy_date") else None,
                "quantity": lot.get("qty"),
                "price": lot.get("price"),
                "type": "BUY"
            })
            
    # Sort all by date descending and take top 'limit'
    transactions.sort(key=lambda x: x["date"] or "", reverse=True)
    
    # Filter to exactly the LAST working day of data available in the system
    # If the max date in the data is Monday, we only return Monday's data.
    if transactions:
        max_date_str = transactions[0]["date"]
        if max_date_str:
            max_date = max_date_str[:10]  # Exact date string e.g., "2025-09-30"
            transactions = [t for t in transactions if t["date"] and t["date"][:10] == max_date]
            
    return {"total": len(transactions), "data": transactions[:limit]}


@router.get("/data/snapshots")
async def get_snapshots(limit: int = Query(50), skip: int = Query(0)):
    """Return investor snapshots from PostgreSQL."""
    query = """
        SELECT investor_id, snapshot_date, smart_money_score, active_positions,
               entry_style, exit_style
        FROM investor_snapshots
        ORDER BY snapshot_date DESC
        LIMIT %s OFFSET %s
    """
    count_query = "SELECT COUNT(*) FROM investor_snapshots"
    
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(count_query)
            total = cur.fetchone()[0]
            
            cur.execute(query, (limit, skip))
            rows = cur.fetchall()
            columns = [desc[0] for desc in cur.description]
    
    data = [dict(zip(columns, row)) for row in rows]
    for row in data:
        for k, v in row.items():
            if hasattr(v, 'isoformat'):
                row[k] = v.isoformat()
    
    return {"total": total, "data": data}


@router.post("/data/clear")
async def clear_database():
    """Purge all data from PostgreSQL and MongoDB."""
    try:
        # --- PostgreSQL ---
        # Using a single connection for atomicity
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("TRUNCATE TABLE sell_transactions RESTART IDENTITY CASCADE;")
                cur.execute("TRUNCATE TABLE investor_snapshots RESTART IDENTITY CASCADE;")
            conn.commit()

        # --- MongoDB ---
        # Delete all documents in relevant collections
        investors_collection.delete_many({})
        investor_metrics_collection.delete_many({})

        return {"status": "success", "message": "All database tables and collections have been purged."}
    except Exception as e:
        print(f"[api] Error clearing database: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
