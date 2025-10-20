"""
SQLite Backend with MarineISA Integration - Test Version
Runs on port 8002 alongside MongoDB backend on port 8001
"""
import asyncio
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any
import uuid

from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import aiosqlite

from marinesia_client import MarineISAClient

# Load environment
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Paths
DATA_DIR = Path('/app/backend-sqlite/data')
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / 'ais_tracker.db'

logger.info(f"SQLite Database: {DB_PATH}")

# Initialize MarineISA
MARINESIA_ENABLED = os.getenv('MARINESIA_ENABLED', 'true').lower() == 'true'
MARINESIA_API_KEY = os.getenv('MARINESIA_API_KEY')
marinesia_client = None

if MARINESIA_ENABLED and MARINESIA_API_KEY:
    marinesia_client = MarineISAClient(MARINESIA_API_KEY)
    logger.info("✅ MarineISA integration enabled")
else:
    logger.warning("⚠️  MarineISA integration disabled")

# FastAPI
app = FastAPI(title="AIS SQLite Backend with MarineISA (Port 8002)")
api_router = APIRouter(prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Background enrichment
enrichment_queue = asyncio.Queue()

async def enrichment_worker():
    """Background worker to enrich vessels"""
    logger.info("🔄 Enrichment worker started")
    while True:
        try:
            mmsi = await enrichment_queue.get()
            
            if not marinesia_client:
                continue
            
            # Check if already enriched recently
            async with aiosqlite.connect(DB_PATH) as db:
                async with db.execute(
                    "SELECT enriched_at FROM vessel_enrichment WHERE mmsi = ?",
                    (mmsi,)
                ) as cursor:
                    row = await cursor.fetchone()
                    if row:
                        # Already enriched, skip
                        continue
            
            logger.info(f"🔍 Enriching vessel MMSI: {mmsi}")
            enriched_data = await marinesia_client.enrich_vessel(mmsi)
            
            if enriched_data.get('enriched'):
                # Store enrichment
                async with aiosqlite.connect(DB_PATH) as db:
                    await db.execute("""
                        INSERT OR REPLACE INTO vessel_enrichment 
                        (mmsi, profile_data, image_url, enriched_at)
                        VALUES (?, ?, ?, ?)
                    """, (
                        mmsi,
                        json.dumps(enriched_data.get('profile')),
                        enriched_data.get('image_url'),
                        enriched_data.get('enriched_at')
                    ))
                    await db.commit()
                logger.info(f"✅ Enriched vessel {mmsi}")
            else:
                logger.debug(f"ℹ️  No enrichment data for {mmsi}")
                
        except Exception as e:
            logger.error(f"❌ Enrichment error: {e}")
        
        await asyncio.sleep(0.1)

async def init_db():
    """Initialize SQLite database"""
    async with aiosqlite.connect(DB_PATH) as db:
        # Vessels table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS vessels (
                mmsi TEXT PRIMARY KEY,
                name TEXT,
                country TEXT,
                ship_type INTEGER,
                ship_type_text TEXT,
                last_seen TEXT,
                position_count INTEGER DEFAULT 0,
                lat REAL,
                lon REAL
            )
        """)
        
        # Vessel enrichment table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS vessel_enrichment (
                mmsi TEXT PRIMARY KEY,
                profile_data TEXT,
                image_url TEXT,
                enriched_at TEXT
            )
        """)
        
        await db.commit()
    logger.info("✅ Database initialized")

@app.on_event("startup")
async def startup():
    await init_db()
    # Start enrichment worker
    asyncio.create_task(enrichment_worker())
    logger.info("🚀 SQLite backend started on port 8002")

@app.get("/")
async def root():
    return {
        "message": "AIS SQLite Backend with MarineISA Integration",
        "port": 8002,
        "database": str(DB_PATH),
        "marinesia_enabled": MARINESIA_ENABLED
    }

@api_router.get("/vessels")
async def get_vessels():
    """Get all vessels with enrichment data"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        
        # Join vessels with enrichment
        async with db.execute("""
            SELECT 
                v.*,
                e.profile_data,
                e.image_url,
                e.enriched_at
            FROM vessels v
            LEFT JOIN vessel_enrichment e ON v.mmsi = e.mmsi
        """) as cursor:
            vessels = []
            async for row in cursor:
                vessel = dict(row)
                # Parse JSON profile
                if vessel.get('profile_data'):
                    try:
                        vessel['marinesia_profile'] = json.loads(vessel['profile_data'])
                        del vessel['profile_data']
                    except:
                        pass
                vessels.append(vessel)
            
            return {"vessels": vessels, "count": len(vessels)}

@api_router.post("/test-vessel")
async def test_vessel(mmsi: str):
    """Test endpoint: add a vessel and enrich it"""
    # Insert test vessel
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT OR REPLACE INTO vessels 
            (mmsi, name, country, last_seen, position_count, lat, lon)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (mmsi, f"Test Vessel {mmsi}", "Unknown", 
              datetime.now(timezone.utc).isoformat(), 1, 0.0, 0.0))
        await db.commit()
    
    # Queue for enrichment
    await enrichment_queue.put(mmsi)
    
    return {
        "message": f"Vessel {mmsi} added and queued for enrichment",
        "check_after": "Wait 2-3 seconds then call GET /api/vessels"
    }

@api_router.get("/vessel/{mmsi}")
async def get_vessel(mmsi: str):
    """Get specific vessel with enrichment"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT 
                v.*,
                e.profile_data,
                e.image_url,
                e.enriched_at
            FROM vessels v
            LEFT JOIN vessel_enrichment e ON v.mmsi = e.mmsi
            WHERE v.mmsi = ?
        """, (mmsi,)) as cursor:
            row = await cursor.fetchone()
            if row:
                vessel = dict(row)
                if vessel.get('profile_data'):
                    try:
                        vessel['marinesia_profile'] = json.loads(vessel['profile_data'])
                        del vessel['profile_data']
                    except:
                        pass
                return vessel
            raise HTTPException(status_code=404, detail="Vessel not found")

@api_router.get("/enrichment-status")
async def enrichment_status():
    """Get enrichment statistics"""
    async with aiosqlite.connect(DB_PATH) as db:
        # Total vessels
        async with db.execute("SELECT COUNT(*) FROM vessels") as cursor:
            total = (await cursor.fetchone())[0]
        
        # Enriched vessels
        async with db.execute("SELECT COUNT(*) FROM vessel_enrichment") as cursor:
            enriched = (await cursor.fetchone())[0]
        
        # Queue size
        queue_size = enrichment_queue.qsize()
        
        return {
            "total_vessels": total,
            "enriched_vessels": enriched,
            "enrichment_queue": queue_size,
            "enrichment_percentage": round((enriched / total * 100) if total > 0 else 0, 1),
            "marinesia_enabled": MARINESIA_ENABLED
        }

app.include_router(api_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
