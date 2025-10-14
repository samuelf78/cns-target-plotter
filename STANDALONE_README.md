# CNS Systems Target Plotter - Standalone Version

Complete standalone version for local deployment with access to local network IPs and serial ports.

## Prerequisites

- Python 3.9 or higher
- Node.js 16 or higher
- MongoDB 4.4 or higher
- npm or yarn package manager

## Directory Structure

```
cns-target-plotter/
├── backend/
│   ├── server.py
│   ├── requirements.txt
│   └── .env
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── App.js
│   │   ├── App.css
│   │   ├── index.js
│   │   ├── index.css
│   │   └── components/
│   ├── package.json
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── .env
└── README.md
```

## Installation Steps

### 1. Install MongoDB

**Windows:**
- Download from https://www.mongodb.com/try/download/community
- Run installer and follow defaults
- MongoDB service will start automatically

**Linux:**
```bash
sudo apt-get install -y mongodb
sudo systemctl start mongodb
sudo systemctl enable mongodb
```

**macOS:**
```bash
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb-community
```

### 2. Setup Backend

```bash
cd backend

# Create virtual environment (optional but recommended)
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment variables
# Edit .env file and set:
MONGO_URL=mongodb://localhost:27017
DB_NAME=ais_tracker
PORT=8001
```

### 3. Setup Frontend

```bash
cd frontend

# Install dependencies
npm install
# or
yarn install

# Configure environment variables
# Edit .env file and set:
REACT_APP_BACKEND_URL=http://localhost:8001
```

## Running the Application

### Start Backend

```bash
cd backend
# Activate venv if you created one
python server.py
# or with uvicorn directly:
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

Backend will be available at: http://localhost:8001

### Start Frontend

```bash
cd frontend
npm start
# or
yarn start
```

Frontend will be available at: http://localhost:3000

## Accessing Local Network and Serial Ports

### Local Network Access

The standalone version can connect to:
- **TCP streams**: Any IP address on your local network (e.g., 192.168.1.100:5631)
- **UDP streams**: Any IP address on your local network
- **Local AIS receivers**: Direct connection to network-enabled AIS receivers

Example TCP connection:
- Host: `192.168.1.100` (your AIS receiver IP)
- Port: `5631` (typical AIS TCP port)

### Serial Port Access

The app automatically detects all available serial ports:
1. Click "Stream Connection" button in the UI
2. Select "Serial" as stream type
3. All connected serial ports will appear in the dropdown
4. Common ports:
   - Windows: COM1, COM2, COM3, etc.
   - Linux: /dev/ttyUSB0, /dev/ttyACM0, etc.
   - macOS: /dev/cu.usbserial-*

**Note**: On Linux/macOS, you may need to add your user to the dialout group:
```bash
sudo usermod -a -G dialout $USER
# Log out and log back in for changes to take effect
```

## Features

✅ Real-time AIS/NMEA data streaming
✅ Support for TCP, UDP, Serial, and File uploads
✅ Live vessel tracking with WebSocket updates
✅ VDO/VDM spoof detection with configurable limits
✅ Historical track replay
✅ Multiple map providers (OpenStreetMap, Satellite, Nautical)
✅ Search vessels by MMSI, name, or call sign
✅ Multi-source data fusion
✅ Base station range visualization

## Production Deployment

### Using PM2 (Recommended for Linux/macOS)

```bash
# Install PM2
npm install -g pm2

# Start backend
cd backend
pm2 start "uvicorn server:app --host 0.0.0.0 --port 8001" --name ais-backend

# Build and serve frontend
cd frontend
npm run build
pm2 start "npx serve -s build -l 3000" --name ais-frontend

# Save PM2 configuration
pm2 save
pm2 startup
```

### Using Docker (Alternative)

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  mongodb:
    image: mongo:4.4
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db

  backend:
    build: ./backend
    ports:
      - "8001:8001"
    environment:
      - MONGO_URL=mongodb://mongodb:27017
      - DB_NAME=ais_tracker
    depends_on:
      - mongodb
    devices:
      - /dev/ttyUSB0:/dev/ttyUSB0  # Serial port access
    network_mode: "host"  # For local network access

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      - REACT_APP_BACKEND_URL=http://localhost:8001
    depends_on:
      - backend

volumes:
  mongodb_data:
```

Run with:
```bash
docker-compose up -d
```

## Firewall Configuration

If you want to access the app from other devices on your network:

**Windows Firewall:**
```powershell
netsh advfirewall firewall add rule name="AIS Backend" dir=in action=allow protocol=TCP localport=8001
netsh advfirewall firewall add rule name="AIS Frontend" dir=in action=allow protocol=TCP localport=3000
```

**Linux (ufw):**
```bash
sudo ufw allow 8001/tcp
sudo ufw allow 3000/tcp
```

Then access from other devices using your computer's IP:
- Frontend: http://192.168.1.x:3000
- Backend: http://192.168.1.x:8001

## Troubleshooting

### Backend won't start
- Check MongoDB is running: `mongosh` or `mongo`
- Check port 8001 is not in use: `lsof -i :8001` or `netstat -ano | findstr 8001`
- Check Python version: `python --version` (should be 3.9+)

### Serial ports not showing
- **Windows**: Check Device Manager for COM ports
- **Linux**: Run `ls -l /dev/ttyUSB* /dev/ttyACM*`
- **Linux permissions**: `sudo chmod 666 /dev/ttyUSB0`

### Cannot connect to TCP/UDP streams
- Verify IP address and port
- Check firewall rules
- Ensure AIS receiver is on same network
- Test with telnet: `telnet 192.168.1.100 5631`

### Frontend cannot connect to backend
- Check REACT_APP_BACKEND_URL in frontend/.env
- Ensure backend is running
- Check CORS settings in server.py

## Support

For issues or questions:
1. Check logs: Backend console output
2. Check browser console: F12 → Console tab
3. Verify all services are running
4. Check network connectivity

## Security Notes

For production use:
1. Change MongoDB default port or add authentication
2. Use environment variables for sensitive data
3. Enable HTTPS for frontend (use nginx/Apache)
4. Restrict backend CORS to specific origins
5. Use firewall rules to limit access

## License

All source code provided as-is for standalone deployment.
