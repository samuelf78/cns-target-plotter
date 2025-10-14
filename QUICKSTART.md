# Quick Start Guide - CNS Systems Target Plotter

## What You're Getting

Complete source code for a standalone AIS/NMEA vessel tracking application with:
- ✅ Real-time TCP/UDP/Serial streaming
- ✅ Local network IP access
- ✅ Serial port detection
- ✅ File upload processing
- ✅ VDO/VDM spoof detection
- ✅ Historical track playback
- ✅ Multi-source data fusion

## Quick Start (Windows)

### 1. Install Prerequisites

**MongoDB** (Required):
- Download: https://www.mongodb.com/try/download/community
- Run installer → Next → Accept → Install
- MongoDB Compass (GUI) will also be installed

**Python 3.9+** (Required):
- Download: https://www.python.org/downloads/
- ⚠️ CHECK "Add Python to PATH" during installation

**Node.js 16+** (Required):
- Download: https://nodejs.org/
- Use LTS version recommended for most users

### 2. Extract Package

Extract `cns-target-plotter-standalone.tar.gz` to a folder like:
```
C:\cns-target-plotter\
```

### 3. Setup Backend

Open Command Prompt (cmd) or PowerShell:

```batch
cd C:\cns-target-plotter\backend

:: Install Python dependencies
pip install -r requirements.txt
```

### 4. Setup Frontend

```batch
cd C:\cns-target-plotter\frontend

:: Install Node dependencies (takes 2-3 minutes)
npm install
```

### 5. Start Application

**Option A - Use startup script (Easy):**
```batch
cd C:\cns-target-plotter
start-windows.bat
```

**Option B - Manual start:**

Terminal 1 (Backend):
```batch
cd C:\cns-target-plotter\backend
python server.py
```

Terminal 2 (Frontend):
```batch
cd C:\cns-target-plotter\frontend
npm start
```

### 6. Open Application

Browser will open automatically to: http://localhost:3000

If not, manually open: http://localhost:3000

## Quick Start (Linux/macOS)

### 1. Install Prerequisites

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install -y mongodb python3 python3-pip nodejs npm
```

**macOS:**
```bash
brew install mongodb-community python node
brew services start mongodb-community
```

### 2. Extract Package

```bash
cd ~
tar -xzf cns-target-plotter-standalone.tar.gz
cd cns-target-plotter-standalone
```

### 3. Setup Backend

```bash
cd backend

# Create virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 4. Setup Frontend

```bash
cd ../frontend
npm install
```

### 5. Start Application

**Option A - Use startup script:**
```bash
cd ..
./start-linux.sh
```

**Option B - Manual start:**

Terminal 1 (Backend):
```bash
cd backend
source venv/bin/activate
python server.py
```

Terminal 2 (Frontend):
```bash
cd frontend
npm start
```

### 6. Open Application

Open browser: http://localhost:3000

## Connecting to Data Sources

### TCP Stream (Network AIS Receiver)

1. Click "Stream Connection" button (top right)
2. Select "TCP" as stream type
3. Enter receiver IP address (e.g., `192.168.1.100`)
4. Enter port (typically `5631` or `10110`)
5. Click "Start Stream"

**Finding your receiver's IP:**
- Check receiver's display screen
- Check your router's connected devices
- Use network scanner tool

### Serial Port (USB AIS Receiver)

1. Connect USB AIS receiver to computer
2. Wait for drivers to install (Windows)
3. Click "Stream Connection" button
4. Select "Serial" as stream type
5. Select your COM port from dropdown
6. Set baud rate (typically `38400` or `4800`)
7. Click "Start Stream"

**Common baud rates:**
- 38400 (most common)
- 4800 (older receivers)
- 115200 (some USB receivers)

### File Upload

1. Save AIS messages to a `.txt` file
2. Click "Upload File" button (top)
3. Select your file
4. Watch progress indicator (bottom right)
5. Vessels will appear on map

**File format example:**
```
!AIVDM,1,1,,A,13HOI:0P0000VOHLCnHQKwvL05Ip,0*23
!AIVDM,1,1,,B,15M67FC000G?ufbE`FepT@3n00Sa,0*5C
```

## Configuration

### Change Ports

**Backend** (backend/.env):
```
PORT=8001  # Change to any available port
```

**Frontend** (frontend/.env):
```
REACT_APP_BACKEND_URL=http://localhost:8001
```

After changing, restart both services.

### Database

**Change database** (backend/.env):
```
MONGO_URL=mongodb://localhost:27017
DB_NAME=ais_tracker  # Change database name
```

### Network Access

To access from other devices on your network:

1. Find your computer's IP address:
   - Windows: `ipconfig` (look for IPv4 Address)
   - Linux/Mac: `ifconfig` or `ip addr`

2. Update frontend/.env:
   ```
   REACT_APP_BACKEND_URL=http://YOUR_IP:8001
   ```

3. Allow through firewall:
   - Windows: Settings → Windows Defender Firewall → Allow app
   - Linux: `sudo ufw allow 8001` and `sudo ufw allow 3000`

4. Access from other devices:
   - http://YOUR_IP:3000

## Troubleshooting

### "MongoDB not running"
**Windows:**
```batch
net start MongoDB
```

**Linux:**
```bash
sudo systemctl start mongodb
```

**macOS:**
```bash
brew services start mongodb-community
```

### "Port already in use"
Close other applications using ports 8001 or 3000.

**Find what's using port 8001 (Windows):**
```batch
netstat -ano | findstr :8001
taskkill /PID <PID_NUMBER> /F
```

**Linux/macOS:**
```bash
lsof -i :8001
kill <PID>
```

### Serial port not showing (Linux)
```bash
# Add user to dialout group
sudo usermod -a -G dialout $USER

# Set permissions
sudo chmod 666 /dev/ttyUSB0

# Log out and back in
```

### Frontend won't load
1. Check backend is running (http://localhost:8001)
2. Check browser console (F12)
3. Clear browser cache
4. Check .env files match

### "Module not found" errors
```bash
# Backend
cd backend
pip install -r requirements.txt

# Frontend
cd frontend
rm -rf node_modules package-lock.json
npm install
```

## Performance Tips

### For Large Files
- Files with 10,000+ messages may take 30-60 seconds to process
- Watch progress indicator in bottom right
- Large files are processed in background

### For Multiple Streams
- Can run multiple TCP/UDP streams simultaneously
- Each source tracked separately
- Use "Disable All Sources" to clear map

### Database Cleanup
- Use "Clear Database" button to remove old data
- Does NOT delete sources (your connections)
- Frees up disk space and improves performance

## Production Deployment

### Run as Service (Linux)

1. Edit `ais-tracker.service` file:
   - Replace `YOUR_USERNAME` with your username
   - Replace paths with actual installation path

2. Install service:
```bash
sudo cp ais-tracker.service /etc/systemd/system/
sudo systemctl enable ais-tracker
sudo systemctl start ais-tracker
```

3. Check status:
```bash
sudo systemctl status ais-tracker
```

### Run as Service (Windows)

Use NSSM (Non-Sucking Service Manager):
1. Download: https://nssm.cc/download
2. Install backend as service:
```batch
nssm install AISBackend "C:\Python39\python.exe" "C:\cns-target-plotter\backend\server.py"
nssm start AISBackend
```

## Support & Updates

### View Logs

**Backend logs** (console output):
- Check terminal/command prompt where server.py is running

**Frontend logs** (browser):
- Press F12 → Console tab

**MongoDB logs** (if needed):
- Windows: `C:\Program Files\MongoDB\Server\4.4\log\`
- Linux: `/var/log/mongodb/`

### Backup Database

```bash
mongodump --db ais_tracker --out /path/to/backup
```

### Restore Database

```bash
mongorestore --db ais_tracker /path/to/backup/ais_tracker
```

## Features Overview

- **Real-time Tracking**: Live vessel positions via WebSocket
- **Multi-source**: Combine TCP, UDP, Serial, and file data
- **Spoof Detection**: Configurable VDO/VDM validation (500km default)
- **Historical Trails**: Click vessel → View history → See track
- **Search**: Find vessels by MMSI, name, or call sign
- **Map Providers**: OpenStreetMap, Satellite, Nautical charts
- **Data Export**: View full history with all message details

## System Requirements

**Minimum:**
- CPU: Dual-core 2.0 GHz
- RAM: 4 GB
- Storage: 500 MB + data storage
- Network: 100 Mbps for streaming

**Recommended:**
- CPU: Quad-core 2.5 GHz+
- RAM: 8 GB
- Storage: SSD with 5+ GB free
- Network: 1 Gbps

## Security Notes

**For public networks:**
1. Use HTTPS (add nginx/Apache reverse proxy)
2. Enable MongoDB authentication
3. Use strong passwords
4. Firewall rules to limit access
5. Regular backups

**For local use:**
- Default configuration is secure for local network
- Only accessible from devices on same network
- No internet exposure by default
