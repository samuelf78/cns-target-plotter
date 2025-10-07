from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone
import asyncio
import json
from pyais import decode
from pyais.stream import TCPConnection, UDPReceiver, FileReaderStream
import socket
import serial
import serial.tools.list_ports
import threading

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# WebSocket connections manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass

manager = ConnectionManager()

# Background stream controllers
active_streams = {}

# Models
class VesselPosition(BaseModel):
    mmsi: str
    timestamp: datetime
    lat: float
    lon: float
    speed: Optional[float] = None
    course: Optional[float] = None
    heading: Optional[int] = None
    nav_status: Optional[int] = None

class VesselInfo(BaseModel):
    mmsi: str
    name: Optional[str] = None
    callsign: Optional[str] = None
    imo: Optional[int] = None
    ship_type: Optional[int] = None
    ship_type_text: Optional[str] = None
    dimension_a: Optional[int] = None
    dimension_b: Optional[int] = None
    dimension_c: Optional[int] = None
    dimension_d: Optional[int] = None
    last_seen: Optional[datetime] = None
    destination: Optional[str] = None
    eta: Optional[str] = None

class AISMessage(BaseModel):
    mmsi: str
    timestamp: datetime
    message_type: int
    raw: str
    decoded: Dict[str, Any]

class StreamConfig(BaseModel):
    stream_type: str  # tcp, udp, serial
    host: Optional[str] = None
    port: Optional[int] = None
    serial_port: Optional[str] = None
    baudrate: Optional[int] = 9600

class SearchQuery(BaseModel):
    mmsi: Optional[str] = None
    vessel_name: Optional[str] = None
    ship_type: Optional[int] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None

# Helper functions
def get_ship_type_text(ship_type: int) -> str:
    ship_types = {
        0: "Not available",
        20: "Wing in ground",
        29: "Wing in ground (Hazardous)",
        30: "Fishing",
        31: "Towing",
        32: "Towing: length exceeds 200m",
        33: "Dredging or underwater ops",
        34: "Diving ops",
        35: "Military ops",
        36: "Sailing",
        37: "Pleasure Craft",
        40: "High speed craft",
        41: "High speed craft (Hazardous)",
        50: "Pilot Vessel",
        51: "Search and Rescue vessel",
        52: "Tug",
        53: "Port Tender",
        54: "Anti-pollution equipment",
        55: "Law Enforcement",
        58: "Medical Transport",
        59: "Special Craft",
        60: "Passenger",
        69: "Passenger (Hazardous)",
        70: "Cargo",
        79: "Cargo (Hazardous)",
        80: "Tanker",
        89: "Tanker (Hazardous)",
        90: "Other Type",
    }
    return ship_types.get(ship_type, f"Unknown ({ship_type})")

async def process_ais_message(raw_message: str, source: str = "unknown"):
    """Process and store AIS message"""
    try:
        # Decode the message
        decoded = decode(raw_message)
        
        if not decoded:
            return
        
        mmsi = str(decoded.get('mmsi', 'unknown'))
        msg_type = decoded.get('msg_type', 0)
        timestamp = datetime.now(timezone.utc)
        
        # Store raw message
        message_doc = {
            'mmsi': mmsi,
            'timestamp': timestamp.isoformat(),
            'message_type': msg_type,
            'raw': raw_message,
            'decoded': decoded,
            'source': source
        }
        await db.messages.insert_one(message_doc)
        
        # Process based on message type
        if msg_type in [1, 2, 3]:  # Position Report
            position_doc = {
                'mmsi': mmsi,
                'timestamp': timestamp.isoformat(),
                'lat': decoded.get('lat'),
                'lon': decoded.get('lon'),
                'speed': decoded.get('speed'),
                'course': decoded.get('course'),
                'heading': decoded.get('heading'),
                'nav_status': decoded.get('status'),
            }
            await db.positions.insert_one(position_doc)
            
            # Update vessel last position
            await db.vessels.update_one(
                {'mmsi': mmsi},
                {'$set': {'last_position': position_doc, 'last_seen': timestamp.isoformat()}},
                upsert=True
            )
            
            # Broadcast to WebSocket clients
            await manager.broadcast({
                'type': 'position',
                'data': position_doc
            })
        
        elif msg_type == 5:  # Static and Voyage Related Data
            vessel_doc = {
                'mmsi': mmsi,
                'name': decoded.get('shipname', '').strip(),
                'callsign': decoded.get('callsign', '').strip(),
                'imo': decoded.get('imo'),
                'ship_type': decoded.get('shiptype'),
                'ship_type_text': get_ship_type_text(decoded.get('shiptype', 0)),
                'dimension_a': decoded.get('to_bow'),
                'dimension_b': decoded.get('to_stern'),
                'dimension_c': decoded.get('to_port'),
                'dimension_d': decoded.get('to_starboard'),
                'destination': decoded.get('destination', '').strip(),
                'eta': str(decoded.get('eta', '')),
                'last_seen': timestamp.isoformat()
            }
            
            await db.vessels.update_one(
                {'mmsi': mmsi},
                {'$set': vessel_doc},
                upsert=True
            )
            
            # Broadcast to WebSocket clients
            await manager.broadcast({
                'type': 'vessel_info',
                'data': vessel_doc
            })
        
        elif msg_type == 18:  # Standard Class B Position Report
            position_doc = {
                'mmsi': mmsi,
                'timestamp': timestamp.isoformat(),
                'lat': decoded.get('lat'),
                'lon': decoded.get('lon'),
                'speed': decoded.get('speed'),
                'course': decoded.get('course'),
                'heading': decoded.get('heading'),
            }
            await db.positions.insert_one(position_doc)
            
            await db.vessels.update_one(
                {'mmsi': mmsi},
                {'$set': {'last_position': position_doc, 'last_seen': timestamp.isoformat()}},
                upsert=True
            )
            
            await manager.broadcast({
                'type': 'position',
                'data': position_doc
            })
        
        elif msg_type == 24:  # Static Data Report
            vessel_doc = {
                'mmsi': mmsi,
                'last_seen': timestamp.isoformat()
            }
            
            if 'shipname' in decoded:
                vessel_doc['name'] = decoded['shipname'].strip()
            if 'callsign' in decoded:
                vessel_doc['callsign'] = decoded['callsign'].strip()
            if 'shiptype' in decoded:
                vessel_doc['ship_type'] = decoded['shiptype']
                vessel_doc['ship_type_text'] = get_ship_type_text(decoded['shiptype'])
            
            await db.vessels.update_one(
                {'mmsi': mmsi},
                {'$set': vessel_doc},
                upsert=True
            )
            
            await manager.broadcast({
                'type': 'vessel_info',
                'data': vessel_doc
            })
        
        logger.info(f"Processed AIS message type {msg_type} for MMSI {mmsi}")
        
    except Exception as e:
        logger.error(f"Error processing AIS message: {e}")

# Routes
@api_router.get("/")
async def root():
    return {"message": "AIS/NMEA Tracking System API"}

@api_router.post("/upload")
async def upload_file(file: UploadFile = File(...), background_tasks: BackgroundTasks = None):
    """Upload and process AIS log file"""
    try:
        content = await file.read()
        lines = content.decode('utf-8', errors='ignore').split('\n')
        
        processed = 0
        errors = 0
        
        for line in lines:
            line = line.strip()
            if line and (line.startswith('!') or line.startswith('$')):
                try:
                    await process_ais_message(line, source='upload')
                    processed += 1
                except Exception as e:
                    errors += 1
                    logger.error(f"Error processing line: {e}")
        
        return {
            'status': 'success',
            'filename': file.filename,
            'processed': processed,
            'errors': errors
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/stream/start")
async def start_stream(config: StreamConfig, background_tasks: BackgroundTasks):
    """Start TCP/UDP/Serial stream"""
    stream_id = str(uuid.uuid4())
    
    def tcp_stream_handler():
        try:
            conn = TCPConnection(config.host, port=config.port)
            for msg in conn:
                if stream_id not in active_streams:
                    break
                try:
                    asyncio.create_task(process_ais_message(msg.decode(), source='tcp'))
                except Exception as e:
                    logger.error(f"Error processing TCP message: {e}")
        except Exception as e:
            logger.error(f"TCP stream error: {e}")
    
    def udp_stream_handler():
        try:
            receiver = UDPReceiver(config.host, port=config.port)
            for msg in receiver:
                if stream_id not in active_streams:
                    break
                try:
                    asyncio.create_task(process_ais_message(msg.decode(), source='udp'))
                except Exception as e:
                    logger.error(f"Error processing UDP message: {e}")
        except Exception as e:
            logger.error(f"UDP stream error: {e}")
    
    def serial_stream_handler():
        try:
            ser = serial.Serial(config.serial_port, config.baudrate, timeout=1)
            while stream_id in active_streams:
                try:
                    line = ser.readline().decode('utf-8', errors='ignore').strip()
                    if line:
                        asyncio.create_task(process_ais_message(line, source='serial'))
                except Exception as e:
                    logger.error(f"Serial read error: {e}")
            ser.close()
        except Exception as e:
            logger.error(f"Serial stream error: {e}")
    
    # Start appropriate stream
    if config.stream_type == 'tcp':
        active_streams[stream_id] = 'tcp'
        background_tasks.add_task(tcp_stream_handler)
    elif config.stream_type == 'udp':
        active_streams[stream_id] = 'udp'
        background_tasks.add_task(udp_stream_handler)
    elif config.stream_type == 'serial':
        active_streams[stream_id] = 'serial'
        thread = threading.Thread(target=serial_stream_handler, daemon=True)
        thread.start()
    
    return {'status': 'started', 'stream_id': stream_id}

@api_router.post("/stream/stop/{stream_id}")
async def stop_stream(stream_id: str):
    """Stop active stream"""
    if stream_id in active_streams:
        del active_streams[stream_id]
        return {'status': 'stopped'}
    return {'status': 'not_found'}

@api_router.get("/stream/active")
async def get_active_streams():
    """Get list of active streams"""
    return {'streams': active_streams}

@api_router.get("/serial/ports")
async def list_serial_ports():
    """List available serial ports"""
    ports = serial.tools.list_ports.comports()
    return {'ports': [{'device': p.device, 'description': p.description} for p in ports]}

@api_router.get("/vessels")
async def get_vessels(limit: int = 100):
    """Get all vessels"""
    vessels = await db.vessels.find().sort('last_seen', -1).limit(limit).to_list(limit)
    for v in vessels:
        v['_id'] = str(v['_id'])
    return {'vessels': vessels}

@api_router.get("/vessel/{mmsi}")
async def get_vessel(mmsi: str):
    """Get vessel details by MMSI"""
    vessel = await db.vessels.find_one({'mmsi': mmsi})
    if vessel:
        vessel['_id'] = str(vessel['_id'])
        
        # Get recent positions
        positions = await db.positions.find({'mmsi': mmsi}).sort('timestamp', -1).limit(100).to_list(100)
        for p in positions:
            p['_id'] = str(p['_id'])
        
        vessel['track'] = positions
        return vessel
    raise HTTPException(status_code=404, detail="Vessel not found")

@api_router.post("/search")
async def search_vessels(query: SearchQuery):
    """Search vessels"""
    filter_query = {}
    
    if query.mmsi:
        filter_query['mmsi'] = {'$regex': query.mmsi, '$options': 'i'}
    if query.vessel_name:
        filter_query['name'] = {'$regex': query.vessel_name, '$options': 'i'}
    if query.ship_type is not None:
        filter_query['ship_type'] = query.ship_type
    
    vessels = await db.vessels.find(filter_query).limit(100).to_list(100)
    for v in vessels:
        v['_id'] = str(v['_id'])
    
    return {'vessels': vessels}

@api_router.get("/positions/recent")
async def get_recent_positions(limit: int = 100):
    """Get recent positions for all vessels"""
    # Get unique MMSIs with their latest position
    pipeline = [
        {'$sort': {'timestamp': -1}},
        {'$group': {
            '_id': '$mmsi',
            'latest': {'$first': '$$ROOT'}
        }},
        {'$limit': limit}
    ]
    
    results = await db.positions.aggregate(pipeline).to_list(limit)
    positions = [r['latest'] for r in results]
    
    for p in positions:
        p['_id'] = str(p['_id'])
    
    return {'positions': positions}

@api_router.get("/track/{mmsi}")
async def get_vessel_track(mmsi: str, limit: int = 1000):
    """Get vessel track history"""
    positions = await db.positions.find({'mmsi': mmsi}).sort('timestamp', -1).limit(limit).to_list(limit)
    for p in positions:
        p['_id'] = str(p['_id'])
    return {'mmsi': mmsi, 'track': positions}

@api_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket for real-time updates"""
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Keep connection alive
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
