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
from bson import ObjectId

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
main_event_loop = None

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

class DataSource(BaseModel):
    source_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    source_type: str  # tcp, udp, serial, file
    name: str
    config: Dict[str, Any]
    status: str = "active"  # active, inactive
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_message: Optional[datetime] = None
    message_count: int = 0
    spoof_limit_km: float = 500.0  # Default 500km spoof limit

# Helper functions
def serialize_doc(doc):
    """Convert MongoDB document to JSON-serializable dict"""
    if doc is None:
        return None
    
    if isinstance(doc, list):
        return [serialize_doc(item) for item in doc]
    
    if isinstance(doc, dict):
        serialized = {}
        for key, value in doc.items():
            if isinstance(value, ObjectId):
                serialized[key] = str(value)
            elif isinstance(value, dict):
                serialized[key] = serialize_doc(value)
            elif isinstance(value, list):
                serialized[key] = [serialize_doc(item) if isinstance(item, dict) else item for item in value]
            else:
                serialized[key] = value
        return serialized
    
    return doc

def get_mmsi_country(mmsi: str) -> str:
    """Get country from MMSI based on MID (Maritime Identification Digits)"""
    if not mmsi or len(mmsi) < 3:
        return "Unknown"
    
    # Extract MID (first 3 digits)
    mid = mmsi[:3]
    
    # Comprehensive MID to country mapping
    mid_countries = {
        "201": "Albania", "202": "Andorra", "203": "Austria", "204": "Azores",
        "205": "Belgium", "206": "Belarus", "207": "Bulgaria", "208": "Vatican",
        "209": "Cyprus", "210": "Cyprus", "211": "Germany", "212": "Cyprus",
        "213": "Georgia", "214": "Moldova", "215": "Malta", "216": "Armenia",
        "218": "Germany", "219": "Denmark", "220": "Denmark", "224": "Spain",
        "225": "Spain", "226": "France", "227": "France", "228": "France",
        "229": "Malta", "230": "Finland", "231": "Faroe Islands", "232": "United Kingdom",
        "233": "United Kingdom", "234": "United Kingdom", "235": "United Kingdom",
        "236": "Gibraltar", "237": "Greece", "238": "Croatia", "239": "Greece",
        "240": "Greece", "241": "Greece", "242": "Morocco", "243": "Hungary",
        "244": "Netherlands", "245": "Netherlands", "246": "Netherlands", "247": "Italy",
        "248": "Malta", "249": "Malta", "250": "Ireland", "251": "Iceland",
        "252": "Liechtenstein", "253": "Luxembourg", "254": "Monaco", "255": "Madeira",
        "256": "Malta", "257": "Norway", "258": "Norway", "259": "Norway",
        "261": "Poland", "262": "Montenegro", "263": "Portugal", "264": "Romania",
        "265": "Sweden", "266": "Sweden", "267": "Slovak Republic", "268": "San Marino",
        "269": "Switzerland", "270": "Czech Republic", "271": "Turkey", "272": "Ukraine",
        "273": "Russia", "274": "North Macedonia", "275": "Latvia", "276": "Estonia",
        "277": "Lithuania", "278": "Slovenia", "279": "Serbia", "301": "Anguilla",
        "303": "USA", "304": "Antigua and Barbuda", "305": "Antigua and Barbuda",
        "306": "Curaçao", "307": "Aruba", "308": "Bahamas", "309": "Bahamas",
        "310": "Bermuda", "311": "Bahamas", "312": "Belize", "314": "Barbados",
        "316": "Canada", "319": "Cayman Islands", "321": "Costa Rica", "323": "Cuba",
        "325": "Dominica", "327": "Dominican Republic", "329": "Guadeloupe",
        "330": "Grenada", "331": "Greenland", "332": "Guatemala", "334": "Honduras",
        "336": "Haiti", "338": "USA", "339": "Jamaica", "341": "St Kitts and Nevis",
        "343": "St Lucia", "345": "Mexico", "347": "Martinique", "348": "Montserrat",
        "350": "Nicaragua", "351": "Panama", "352": "Panama", "353": "Panama",
        "354": "Panama", "355": "Panama", "356": "Panama", "357": "Panama",
        "358": "Puerto Rico", "359": "El Salvador", "361": "St Pierre and Miquelon",
        "362": "Trinidad and Tobago", "364": "Turks and Caicos Islands",
        "366": "USA", "367": "USA", "368": "USA", "369": "USA",
        "370": "Panama", "371": "Panama", "372": "Panama", "373": "Panama",
        "374": "Panama", "375": "St Vincent and Grenadines", "376": "St Vincent and Grenadines",
        "377": "St Vincent and Grenadines", "378": "British Virgin Islands",
        "379": "US Virgin Islands", "401": "Afghanistan", "403": "Saudi Arabia",
        "405": "Bangladesh", "408": "Bahrain", "410": "Bhutan", "412": "China",
        "413": "China", "414": "China", "416": "Taiwan", "417": "Sri Lanka",
        "419": "India", "422": "Iran", "423": "Azerbaijan", "425": "Iraq",
        "428": "Israel", "431": "Japan", "432": "Japan", "434": "Turkmenistan",
        "436": "Kazakhstan", "437": "Uzbekistan", "438": "Jordan", "440": "South Korea",
        "441": "South Korea", "443": "Palestine", "445": "North Korea", "447": "Kuwait",
        "450": "Lebanon", "451": "Kyrgyzstan", "453": "Macao", "455": "Maldives",
        "457": "Mongolia", "459": "Nepal", "461": "Oman", "463": "Pakistan",
        "466": "Qatar", "468": "Syria", "470": "UAE", "471": "UAE",
        "472": "Tajikistan", "473": "Yemen", "475": "Yemen", "477": "Hong Kong",
        "478": "Bosnia and Herzegovina", "501": "Antarctica", "503": "Australia",
        "506": "Myanmar", "508": "Brunei", "510": "Micronesia", "511": "Palau",
        "512": "New Zealand", "514": "Cambodia", "515": "Cambodia", "516": "Christmas Island",
        "518": "Cook Islands", "520": "Fiji", "523": "Cocos Islands", "525": "Indonesia",
        "529": "Kiribati", "531": "Laos", "533": "Malaysia", "536": "Northern Mariana Islands",
        "538": "Marshall Islands", "540": "New Caledonia", "542": "Niue", "544": "Nauru",
        "546": "French Polynesia", "548": "Philippines", "550": "Timor-Leste",
        "553": "Papua New Guinea", "555": "Pitcairn Island", "557": "Solomon Islands",
        "559": "American Samoa", "561": "Samoa", "563": "Singapore", "564": "Singapore",
        "565": "Singapore", "566": "Singapore", "567": "Thailand", "570": "Tonga",
        "572": "Tuvalu", "574": "Vietnam", "576": "Vanuatu", "577": "Vanuatu",
        "578": "Wallis and Futuna", "601": "South Africa", "603": "Angola",
        "605": "Algeria", "607": "St Paul and Amsterdam Islands", "608": "Ascension Island",
        "609": "Burundi", "610": "Benin", "611": "Botswana", "612": "Central African Republic",
        "613": "Cameroon", "615": "Congo", "616": "Comoros", "617": "Cape Verde",
        "618": "Crozet Archipelago", "619": "Ivory Coast", "620": "Comoros",
        "621": "Djibouti", "622": "Egypt", "624": "Ethiopia", "625": "Eritrea",
        "626": "Gabon", "627": "Ghana", "629": "Gambia", "630": "Guinea-Bissau",
        "631": "Equatorial Guinea", "632": "Guinea", "633": "Burkina Faso",
        "634": "Kenya", "635": "Kerguelen Islands", "636": "Liberia", "637": "Liberia",
        "638": "South Sudan", "642": "Libya", "644": "Lesotho", "645": "Mauritius",
        "647": "Madagascar", "649": "Mali", "650": "Mozambique", "654": "Mauritania",
        "655": "Malawi", "656": "Niger", "657": "Nigeria", "659": "Namibia",
        "660": "Reunion", "661": "Rwanda", "662": "Sudan", "663": "Senegal",
        "664": "Seychelles", "665": "St Helena", "666": "Somalia", "667": "Sierra Leone",
        "668": "Sao Tome and Principe", "669": "Swaziland", "670": "Chad",
        "671": "Togo", "672": "Tunisia", "674": "Tanzania", "675": "Uganda",
        "676": "DR Congo", "677": "Tanzania", "678": "Zambia", "679": "Zimbabwe",
        "701": "Argentina", "710": "Brazil", "720": "Bolivia", "725": "Chile",
        "730": "Colombia", "735": "Ecuador", "740": "Falkland Islands", "745": "Guiana",
        "750": "Guyana", "755": "Paraguay", "760": "Peru", "765": "Suriname",
        "770": "Uruguay", "775": "Venezuela"
    }
    
    return mid_countries.get(mid, f"Unknown ({mid})")

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

async def process_ais_message(raw_message: str, source: str = "unknown", source_id: str = None):
    """Process and store AIS message"""
    try:
        # Decode the message
        decoded_msg = decode(raw_message)
        
        if not decoded_msg:
            return
        
        # Convert to dict
        decoded = decoded_msg.asdict()
        
        mmsi = str(decoded.get('mmsi', 'unknown'))
        msg_type = decoded.get('msg_type', 0)
        timestamp = datetime.now(timezone.utc)
        
        # Determine if VDO or VDM
        # VDO format: !xxVDO or $xxVDO (where xx is 2-char talker ID like AB, AI, etc.)
        # VDM format: !xxVDM or $xxVDM
        is_vdo = 'VDO' in raw_message[:10]  # Check first 10 chars for VDO
        
        # Store raw message
        message_doc = {
            'mmsi': mmsi,
            'timestamp': timestamp.isoformat(),
            'message_type': msg_type,
            'raw': raw_message,
            'decoded': decoded,
            'source': source,
            'source_id': source_id,
            'is_vdo': is_vdo,
            'repeat_indicator': decoded.get('repeat', 0)
        }
        await db.messages.insert_one(message_doc)
        
        # Process based on message type
        if msg_type in [1, 2, 3]:  # Position Reports (Class A)
            position_doc = {
                'mmsi': mmsi,
                'timestamp': timestamp.isoformat(),
                'lat': decoded.get('lat'),
                'lon': decoded.get('lon'),
                'speed': decoded.get('speed'),
                'course': decoded.get('course'),
                'heading': decoded.get('heading'),
                'nav_status': decoded.get('status'),
                'source_id': source_id,
                'is_vdo': is_vdo,
                'repeat_indicator': decoded.get('repeat', 0)
            }
            await db.positions.insert_one(position_doc)
            
            # Get position count
            pos_count = await db.positions.count_documents({'mmsi': mmsi})
            
            # Update vessel last position and add to sources list
            await db.vessels.update_one(
                {'mmsi': mmsi},
                {
                    '$set': {
                        'last_position': position_doc,
                        'last_seen': timestamp.isoformat(),
                        'position_count': pos_count,
                        'country': get_mmsi_country(mmsi)
                    },
                    '$addToSet': {'source_ids': source_id}
                },
                upsert=True
            )
            
            # Broadcast to WebSocket clients
            await manager.broadcast({
                'type': 'position',
                'data': position_doc
            })
        
        elif msg_type == 4:  # Base Station Report (VDO)
            # Type 4 has position data but different fields than Type 1-3
            position_doc = {
                'mmsi': mmsi,
                'timestamp': timestamp.isoformat(),
                'lat': decoded.get('lat'),
                'lon': decoded.get('lon'),
                'accuracy': decoded.get('accuracy'),
                'source_id': source_id,
                'is_vdo': is_vdo,
                'repeat_indicator': decoded.get('repeat', 0),
                'epfd': decoded.get('epfd'),  # Electronic Position Fixing Device type
                'raim': decoded.get('raim')  # RAIM flag
            }
            
            # Only store if position data exists
            if position_doc['lat'] is not None and position_doc['lon'] is not None:
                await db.positions.insert_one(position_doc)
                
                # Get position count
                pos_count = await db.positions.count_documents({'mmsi': mmsi})
                
                # Update vessel last position and add to sources list
                await db.vessels.update_one(
                    {'mmsi': mmsi},
                    {
                        '$set': {
                            'last_position': position_doc,
                            'last_seen': timestamp.isoformat(),
                            'position_count': pos_count,
                            'country': get_mmsi_country(mmsi),
                            'is_base_station': True  # Mark as base station
                        },
                        '$addToSet': {'source_ids': source_id}
                    },
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
                'last_seen': timestamp.isoformat(),
                'country': get_mmsi_country(mmsi)
            }
            
            await db.vessels.update_one(
                {'mmsi': mmsi},
                {
                    '$set': vessel_doc,
                    '$addToSet': {'source_ids': source_id}
                },
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
                'last_seen': timestamp.isoformat(),
                'country': get_mmsi_country(mmsi)
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
                {
                    '$set': vessel_doc,
                    '$addToSet': {'source_ids': source_id}
                },
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
        # Create source record
        source_id = str(uuid.uuid4())
        source_doc = {
            'source_id': source_id,
            'source_type': 'file',
            'name': file.filename,
            'config': {'filename': file.filename},
            'status': 'active',
            'created_at': datetime.now(timezone.utc).isoformat(),
            'message_count': 0
        }
        await db.sources.insert_one(source_doc)
        
        content = await file.read()
        lines = content.decode('utf-8', errors='ignore').split('\n')
        
        processed = 0
        errors = 0
        
        for line in lines:
            line = line.strip()
            if line and (line.startswith('!') or line.startswith('$')):
                try:
                    await process_ais_message(line, source=f'file:{file.filename}', source_id=source_id)
                    processed += 1
                except Exception as e:
                    errors += 1
                    logger.error(f"Error processing line: {e}")
        
        # Update source with message count
        await db.sources.update_one(
            {'source_id': source_id},
            {'$set': {
                'message_count': processed,
                'last_message': datetime.now(timezone.utc).isoformat()
            }}
        )
        
        return {
            'status': 'success',
            'source_id': source_id,
            'filename': file.filename,
            'processed': processed,
            'errors': errors
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/stream/start")
async def start_stream(config: StreamConfig, background_tasks: BackgroundTasks):
    """Start TCP/UDP/Serial stream"""
    source_id = str(uuid.uuid4())
    
    # Create source record
    source_name = f"{config.stream_type.upper()}: "
    if config.stream_type in ['tcp', 'udp']:
        source_name += f"{config.host}:{config.port}"
    else:
        source_name += config.serial_port
    
    source_doc = {
        'source_id': source_id,
        'source_type': config.stream_type,
        'name': source_name,
        'config': config.dict(),
        'status': 'active',
        'created_at': datetime.now(timezone.utc).isoformat(),
        'message_count': 0
    }
    await db.sources.insert_one(source_doc)
    
    stream_id = source_id
    
    # Async helper to process message and update stats
    async def process_stream_message(raw_msg: str, source_str: str, sid: str):
        await process_ais_message(raw_msg, source=source_str, source_id=sid)
        await db.sources.update_one(
            {'source_id': sid},
            {
                '$inc': {'message_count': 1},
                '$set': {'last_message': datetime.now(timezone.utc).isoformat()}
            }
        )
    
    def tcp_stream_handler():
        try:
            logger.info(f"Connecting to TCP stream: {config.host}:{config.port}")
            conn = TCPConnection(config.host, port=config.port)
            
            logger.info(f"TCP stream connected: {config.host}:{config.port}")
            
            for msg in conn:
                if source_id not in active_streams:
                    logger.info(f"TCP stream {source_id} stopped")
                    break
                try:
                    # msg is an AISSentence object with .raw attribute (bytes)
                    raw_msg = msg.raw.decode('utf-8', errors='ignore')
                    
                    # Schedule the async function on the main event loop
                    if main_event_loop:
                        future = asyncio.run_coroutine_threadsafe(
                            process_stream_message(raw_msg, f'tcp:{config.host}:{config.port}', source_id),
                            main_event_loop
                        )
                        # Wait for completion (with timeout to prevent blocking)
                        try:
                            future.result(timeout=2)
                        except Exception as e:
                            logger.error(f"Error processing TCP message: {e}")
                    
                except Exception as e:
                    logger.error(f"Error in TCP handler: {e}")
                    
        except Exception as e:
            logger.error(f"TCP stream error for {config.host}:{config.port} - {e}")
    
    def udp_stream_handler():
        try:
            logger.info(f"Starting UDP receiver: {config.host}:{config.port}")
            receiver = UDPReceiver(config.host, port=config.port)
            
            logger.info(f"UDP receiver started: {config.host}:{config.port}")
            
            for msg in receiver:
                if source_id not in active_streams:
                    logger.info(f"UDP stream {source_id} stopped")
                    break
                try:
                    raw_msg = msg.raw.decode('utf-8', errors='ignore')
                    
                    # Schedule the async function on the main event loop
                    if main_event_loop:
                        future = asyncio.run_coroutine_threadsafe(
                            process_stream_message(raw_msg, f'udp:{config.host}:{config.port}', source_id),
                            main_event_loop
                        )
                        # Wait for completion (with timeout to prevent blocking)
                        try:
                            future.result(timeout=2)
                        except Exception as e:
                            logger.error(f"Error processing UDP message: {e}")
                    
                except Exception as e:
                    logger.error(f"Error in UDP handler: {e}")
                    
        except Exception as e:
            logger.error(f"UDP stream error: {e}")
    
    def serial_stream_handler():
        try:
            logger.info(f"Opening serial port: {config.serial_port} at {config.baudrate} baud")
            ser = serial.Serial(config.serial_port, config.baudrate, timeout=1)
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            logger.info(f"Serial port opened: {config.serial_port}")
            
            while source_id in active_streams:
                try:
                    line = ser.readline().decode('utf-8', errors='ignore').strip()
                    if line:
                        loop.run_until_complete(process_ais_message(line, source=f'serial:{config.serial_port}', source_id=source_id))
                        loop.run_until_complete(db.sources.update_one(
                            {'source_id': source_id},
                            {
                                '$inc': {'message_count': 1},
                                '$set': {'last_message': datetime.now(timezone.utc).isoformat()}
                            }
                        ))
                except Exception as e:
                    logger.error(f"Serial read error: {e}")
            ser.close()
        except Exception as e:
            logger.error(f"Serial stream error: {e}")
    
    # Start appropriate stream
    if config.stream_type == 'tcp':
        active_streams[stream_id] = 'tcp'
        thread = threading.Thread(target=tcp_stream_handler, daemon=True)
        thread.start()
    elif config.stream_type == 'udp':
        active_streams[stream_id] = 'udp'
        thread = threading.Thread(target=udp_stream_handler, daemon=True)
        thread.start()
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

@api_router.get("/sources")
async def get_sources():
    """Get all data sources"""
    try:
        sources = await db.sources.find().sort('created_at', -1).to_list(100)
        serialized_sources = [serialize_doc(s) for s in sources]
        return {'sources': serialized_sources}
    except Exception as e:
        logger.error(f"Error loading sources: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.patch("/sources/{source_id}/toggle")
async def toggle_source(source_id: str):
    """Enable/disable a data source"""
    try:
        source = await db.sources.find_one({'source_id': source_id})
        if not source:
            raise HTTPException(status_code=404, detail="Source not found")
        
        new_status = 'inactive' if source['status'] == 'active' else 'active'
        
        # If disabling a stream, stop it
        if new_status == 'inactive' and source_id in active_streams:
            del active_streams[source_id]
        
        await db.sources.update_one(
            {'source_id': source_id},
            {'$set': {'status': new_status}}
        )
        
        return {'status': new_status}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error toggling source: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.patch("/sources/{source_id}/spoof-limit")
async def update_spoof_limit(source_id: str, spoof_limit_km: float):
    """Update spoof limit for a data source"""
    try:
        result = await db.sources.update_one(
            {'source_id': source_id},
            {'$set': {'spoof_limit_km': spoof_limit_km}}
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Source not found")
        
        return {'status': 'updated', 'spoof_limit_km': spoof_limit_km}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating spoof limit: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.delete("/sources/{source_id}")
async def delete_source(source_id: str):
    """Remove a data source"""
    try:
        # Stop stream if active
        if source_id in active_streams:
            del active_streams[source_id]
        
        result = await db.sources.delete_one({'source_id': source_id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Source not found")
        
        return {'status': 'deleted'}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting source: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/sources/disable-all")
async def disable_all_sources():
    """Disable all data sources"""
    try:
        # Stop all active streams
        for stream_id in list(active_streams.keys()):
            del active_streams[stream_id]
        
        # Disable all sources
        await db.sources.update_many({}, {'$set': {'status': 'inactive'}})
        
        return {'status': 'all_disabled', 'count': await db.sources.count_documents({})}
    except Exception as e:
        logger.error(f"Error disabling all sources: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/vessels/active")
async def get_active_vessels(limit: int = 5000, skip: int = 0):
    """Get vessels from active sources with per-source VDO spoof detection"""
    try:
        import math
        
        # Get active sources with their spoof limits
        active_sources = await db.sources.find({'status': 'active'}).to_list(100)
        active_source_ids = [s['source_id'] for s in active_sources]
        
        if not active_source_ids:
            return {'vessels': [], 'total': 0, 'vdo_data': []}
        
        # Get total count
        total = await db.vessels.count_documents({
            'source_ids': {'$in': active_source_ids}
        })
        
        # Get vessels that have at least one active source
        vessels = await db.vessels.find({
            'source_ids': {'$in': active_source_ids}
        }).sort('last_seen', -1).skip(skip).limit(limit).to_list(limit)
        
        # Process VDO positions per source
        vdo_data_list = []
        
        for source in active_sources:
            source_id = source['source_id']
            spoof_limit_km = source.get('spoof_limit_km', 50.0)
            
            # Get VDO positions for this source
            vdo_positions = await db.positions.find({
                'is_vdo': True,
                'source_id': source_id
            }).to_list(100)
            
            for vdo_pos in vdo_positions:
                if not vdo_pos.get('lat') or not vdo_pos.get('lon'):
                    continue
                    
                vdo_lat = vdo_pos['lat']
                vdo_lon = vdo_pos['lon']
                vdo_mmsi = vdo_pos.get('mmsi')
                
                # Get VDM positions from SAME source only
                vdm_positions = await db.positions.find({
                    'is_vdo': {'$ne': True},
                    'source_id': source_id,
                    'lat': {'$exists': True, '$ne': None, '$ne': 0},
                    'lon': {'$exists': True, '$ne': None, '$ne': 0}
                }).to_list(10000)
                
                # Find furthest VDM within spoof limit
                max_distance_within_limit = 0
                
                for vdm_pos in vdm_positions:
                    vdm_lat = vdm_pos.get('lat')
                    vdm_lon = vdm_pos.get('lon')
                    
                    if vdm_lat and vdm_lon:
                        # Calculate distance in km
                        lat1, lon1 = math.radians(vdo_lat), math.radians(vdo_lon)
                        lat2, lon2 = math.radians(vdm_lat), math.radians(vdm_lon)
                        
                        dlat = lat2 - lat1
                        dlon = lon2 - lon1
                        
                        a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
                        c = 2 * math.asin(math.sqrt(a))
                        distance_km = 6371 * c
                        
                        # Only consider VDMs within spoof limit
                        if distance_km <= spoof_limit_km:
                            max_distance_within_limit = max(max_distance_within_limit, distance_km)
                
                vdo_data_list.append({
                    'mmsi': vdo_mmsi,
                    'lat': vdo_lat,
                    'lon': vdo_lon,
                    'radius_km': max_distance_within_limit,
                    'spoof_limit_km': spoof_limit_km,
                    'source_id': source_id,
                    'source_name': source['name'],
                    'timestamp': vdo_pos.get('timestamp')
                })
        
        logger.info(f"Found {len(vessels)}/{total} vessels, {len(vdo_data_list)} VDO positions")
        
        serialized_vessels = [serialize_doc(v) for v in vessels]
        return {
            'vessels': serialized_vessels,
            'total': total,
            'vdo_data': vdo_data_list
        }
    except Exception as e:
        logger.error(f"Error loading active vessels: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/database/clear")
async def clear_database():
    """Clear all vessel, position, and message data (keep sources)"""
    try:
        vessels_deleted = await db.vessels.delete_many({})
        positions_deleted = await db.positions.delete_many({})
        messages_deleted = await db.messages.delete_many({})
        
        logger.info(f"Database cleared: {vessels_deleted.deleted_count} vessels, {positions_deleted.deleted_count} positions, {messages_deleted.deleted_count} messages")
        
        return {
            'status': 'cleared',
            'vessels_deleted': vessels_deleted.deleted_count,
            'positions_deleted': positions_deleted.deleted_count,
            'messages_deleted': messages_deleted.deleted_count
        }
    except Exception as e:
        logger.error(f"Error clearing database: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/serial/ports")
async def list_serial_ports():
    """List available serial ports"""
    ports = serial.tools.list_ports.comports()
    return {'ports': [{'device': p.device, 'description': p.description} for p in ports]}

@api_router.get("/vdo/positions")
async def get_vdo_positions():
    """Get all VDO (own ship) positions with spoof detection radius"""
    try:
        import math
        
        # Get all VDO positions
        vdo_positions = await db.positions.find({'is_vdo': True}).to_list(1000)
        
        result = []
        
        for vdo_pos in vdo_positions:
            if not vdo_pos.get('lat') or not vdo_pos.get('lon'):
                continue
                
            vdo_lat = vdo_pos['lat']
            vdo_lon = vdo_pos['lon']
            
            # Get all VDM positions with repeat_indicator <= 0
            vdm_positions = await db.positions.find({
                'is_vdo': {'$ne': True},
                'repeat_indicator': {'$lte': 0},
                'lat': {'$exists': True, '$ne': None},
                'lon': {'$exists': True, '$ne': None}
            }).to_list(10000)
            
            max_distance = 0
            
            # Calculate distance to furthest VDM target
            for vdm_pos in vdm_positions:
                vdm_lat = vdm_pos.get('lat')
                vdm_lon = vdm_pos.get('lon')
                
                if vdm_lat and vdm_lon:
                    # Haversine formula for distance
                    lat1, lon1 = math.radians(vdo_lat), math.radians(vdo_lon)
                    lat2, lon2 = math.radians(vdm_lat), math.radians(vdm_lon)
                    
                    dlat = lat2 - lat1
                    dlon = lon2 - lon1
                    
                    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
                    c = 2 * math.asin(math.sqrt(a))
                    distance_km = 6371 * c  # Earth radius in km
                    distance_nm = distance_km * 0.539957  # Convert to nautical miles
                    
                    max_distance = max(max_distance, distance_nm)
            
            result.append({
                'mmsi': vdo_pos.get('mmsi'),
                'lat': vdo_lat,
                'lon': vdo_lon,
                'radius_nm': max_distance,
                'radius_km': max_distance * 1.852,
                'timestamp': vdo_pos.get('timestamp')
            })
        
        return {'vdo_positions': result}
    except Exception as e:
        logger.error(f"Error getting VDO positions: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/vessels")
async def get_vessels(limit: int = 100):
    """Get all vessels"""
    try:
        vessels = await db.vessels.find().sort('last_seen', -1).limit(limit).to_list(limit)
        serialized_vessels = [serialize_doc(v) for v in vessels]
        return {'vessels': serialized_vessels}
    except Exception as e:
        logger.error(f"Error loading vessels: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to load vessels: {str(e)}")

@api_router.get("/vessel/{mmsi}")
async def get_vessel(mmsi: str):
    """Get vessel details by MMSI - combines data from all sources"""
    try:
        vessel = await db.vessels.find_one({'mmsi': mmsi})
        if vessel:
            vessel = serialize_doc(vessel)
            
            # Get the absolute latest position across all sources
            latest_position = await db.positions.find_one(
                {'mmsi': mmsi},
                sort=[('timestamp', -1)]
            )
            if latest_position:
                vessel['last_position'] = serialize_doc(latest_position)
            
            # Get recent positions sorted by timestamp (newest first)
            positions = await db.positions.find({'mmsi': mmsi}).sort('timestamp', -1).limit(100).to_list(100)
            positions = [serialize_doc(p) for p in positions]
            
            vessel['track'] = positions
            return vessel
        raise HTTPException(status_code=404, detail="Vessel not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error loading vessel {mmsi}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to load vessel: {str(e)}")

@api_router.post("/search")
async def search_vessels(query: SearchQuery):
    """Search vessels by MMSI, name, or callsign"""
    try:
        # Get active source IDs
        active_sources = await db.sources.find({'status': 'active'}).to_list(100)
        active_source_ids = [s['source_id'] for s in active_sources]
        
        if not active_source_ids:
            return {'vessels': []}
        
        filter_query = {'source_ids': {'$in': active_source_ids}}
        
        # Build OR query for MMSI, name, and callsign
        or_conditions = []
        if query.mmsi:
            or_conditions.append({'mmsi': {'$regex': query.mmsi, '$options': 'i'}})
        if query.vessel_name:
            or_conditions.append({'name': {'$regex': query.vessel_name, '$options': 'i'}})
            or_conditions.append({'callsign': {'$regex': query.vessel_name, '$options': 'i'}})
        if query.ship_type is not None:
            filter_query['ship_type'] = query.ship_type
        
        if or_conditions:
            filter_query['$or'] = or_conditions
        
        vessels = await db.vessels.find(filter_query).limit(500).to_list(500)
        serialized_vessels = [serialize_doc(v) for v in vessels]
        
        return {'vessels': serialized_vessels}
    except Exception as e:
        logger.error(f"Error searching vessels: {e}")
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")

@api_router.get("/positions/recent")
async def get_recent_positions(limit: int = 100):
    """Get recent positions for all vessels"""
    try:
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
        positions = [serialize_doc(r['latest']) for r in results]
        
        return {'positions': positions}
    except Exception as e:
        logger.error(f"Error loading recent positions: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to load positions: {str(e)}")

@api_router.get("/track/{mmsi}")
async def get_vessel_track(mmsi: str, limit: int = 10000):
    """Get vessel track history - properly sorted by timestamp across all sources"""
    try:
        # Get positions from ALL sources for this MMSI
        # Sort by timestamp descending (newest first), then reverse for trail drawing
        positions = await db.positions.find(
            {'mmsi': mmsi},
            {'lat': 1, 'lon': 1, 'timestamp': 1, 'speed': 1, 'course': 1, 'heading': 1, 'source_id': 1}
        ).sort('timestamp', -1).limit(limit).to_list(limit)
        
        # Remove duplicates (same timestamp from different sources) - keep first occurrence
        seen_timestamps = set()
        unique_positions = []
        for pos in positions:
            ts = pos.get('timestamp')
            if ts not in seen_timestamps:
                seen_timestamps.add(ts)
                unique_positions.append(pos)
        
        # Reverse to get chronological order (oldest to newest) for trail drawing
        unique_positions.reverse()
        
        serialized_positions = [serialize_doc(p) for p in unique_positions]
        
        logger.info(f"Track for {mmsi}: {len(unique_positions)} unique positions from {len(positions)} total")
        
        return {
            'mmsi': mmsi, 
            'track': serialized_positions,
            'count': len(serialized_positions),
            'total_records': len(positions)
        }
    except Exception as e:
        logger.error(f"Error loading track for {mmsi}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to load track: {str(e)}")

@api_router.get("/history/{mmsi}")
async def get_vessel_history(mmsi: str):
    """Get complete historical data for an MMSI - properly merged from all sources"""
    try:
        # Get vessel info
        vessel = await db.vessels.find_one({'mmsi': mmsi})
        if not vessel:
            raise HTTPException(status_code=404, detail="Vessel not found")
        
        # Get all positions sorted chronologically (newest first for display)
        positions = await db.positions.find({'mmsi': mmsi}).sort('timestamp', -1).to_list(10000)
        
        # Get all messages sorted chronologically
        messages = await db.messages.find({'mmsi': mmsi}).sort('timestamp', -1).to_list(10000)
        
        # Count unique sources
        position_sources = set()
        for p in positions:
            if p.get('source_id'):
                position_sources.add(p['source_id'])
        
        message_sources = set()
        for m in messages:
            if m.get('source_id'):
                message_sources.add(m['source_id'])
        
        all_sources = position_sources.union(message_sources)
        
        # Serialize all data
        result = {
            'mmsi': mmsi,
            'vessel': serialize_doc(vessel),
            'positions': [serialize_doc(p) for p in positions],
            'messages': [serialize_doc(m) for m in messages],
            'position_count': len(positions),
            'message_count': len(messages),
            'unique_sources': len(all_sources),
            'source_ids': list(all_sources)
        }
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error loading history for {mmsi}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to load history: {str(e)}")

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

@app.on_event("startup")
async def startup_event():
    global main_event_loop
    main_event_loop = asyncio.get_event_loop()
    logger.info("Main event loop captured for stream handlers")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
