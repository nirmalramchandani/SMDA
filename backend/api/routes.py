import os
import shutil
import uuid
import json
from datetime import datetime
from fastapi import APIRouter, UploadFile, File, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse

from pipeline.runner import run_clean, run_ingest, get_file_hash
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
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload/ingest")
async def ingest_cleaned(
    clean_txn_path: str = Query(...),
    clean_evt_path: str = Query(None),
    resume: bool = Query(False)
):
    """Phase 2: Ingest cleaned data into databases. ACID-compliant."""
    try:
        if not os.path.exists(clean_txn_path):
            raise HTTPException(status_code=400, detail="Cleaned transaction file not found. Run /upload/clean first.")

        return StreamingResponse(
            run_ingest(clean_txn_path, clean_evt_path, resume=resume),
            media_type="text/event-stream"
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"[api] Ingest error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


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
    """Return investor profiles from MongoDB."""
    docs = list(investors_collection.find({}, {"portfolio_state.open_lots": 0})
                .skip(skip).limit(limit))
    
    # Convert ObjectId and dates to strings for JSON serialization
    for doc in docs:
        doc["_id"] = str(doc["_id"])
    
    total = investors_collection.count_documents({})
    return {"total": total, "data": docs}


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
    
    # Filter to last 1 week if user wants max 1 week data, but we can do it softly by limit or strictly by date
    # Let's find the max date in the data
    if transactions:
        max_date_str = transactions[0]["date"]
        if max_date_str:
            max_date = datetime.strptime(max_date_str[:10], "%Y-%m-%d").date()
            from datetime import timedelta
            one_week_ago = max_date - timedelta(days=7)
            transactions = [t for t in transactions if t["date"] and datetime.strptime(t["date"][:10], "%Y-%m-%d").date() >= one_week_ago]
            
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
