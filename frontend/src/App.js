import { useEffect, useState, useRef } from "react";
import "@/App.css";
import axios from "axios";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import io from 'socket.io-client';
import { Upload, Radio, Wifi, WifiOff, Search, Filter, Play, Pause, Clock, Ship, Anchor, MapPin, Settings, X } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Badge } from './components/ui/badge';
import { toast } from 'sonner';
import { Toaster } from './components/ui/sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const WS_URL = BACKEND_URL.replace('https', 'wss').replace('http', 'ws');

// Fix Leaflet default icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom ship icon
const createShipIcon = (heading) => {
  return L.divIcon({
    html: `<div style="transform: rotate(${heading || 0}deg); font-size: 24px; color: #3b82f6;">⛵</div>`,
    className: 'custom-ship-icon',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
};

function MapUpdater({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView(center, zoom || map.getZoom());
    }
  }, [center, zoom, map]);
  return null;
}

function App() {
  const [vessels, setVessels] = useState([]);
  const [selectedVessel, setSelectedVessel] = useState(null);
  const [vesselTrack, setVesselTrack] = useState([]);
  const [mapProvider, setMapProvider] = useState('osm');
  const [mapCenter, setMapCenter] = useState([37.7749, -122.4194]);
  const [mapZoom, setMapZoom] = useState(8);
  const [wsConnected, setWsConnected] = useState(false);
  const [activeStreams, setActiveStreams] = useState({});
  const [searchMMSI, setSearchMMSI] = useState('');
  const [searchName, setSearchName] = useState('');
  const [uploadProgress, setUploadProgress] = useState(false);
  const [showConnectionPanel, setShowConnectionPanel] = useState(false);
  
  // Connection settings
  const [streamType, setStreamType] = useState('tcp');
  const [tcpHost, setTcpHost] = useState('localhost');
  const [tcpPort, setTcpPort] = useState('10110');
  const [serialPort, setSerialPort] = useState('');
  const [serialPorts, setSerialPorts] = useState([]);
  const [baudrate, setBaudrate] = useState('9600');
  
  const fileInputRef = useRef(null);
  const wsRef = useRef(null);

  useEffect(() => {
    loadVessels();
    loadRecentPositions();
    connectWebSocket();
    loadActiveStreams();
    loadSerialPorts();
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const connectWebSocket = () => {
    try {
      const socket = io(`${WS_URL}/api/ws`, {
        transports: ['websocket', 'polling'],
        reconnection: true
      });
      
      socket.on('connect', () => {
        setWsConnected(true);
        toast.success('Live updates connected');
      });
      
      socket.on('disconnect', () => {
        setWsConnected(false);
        toast.error('Live updates disconnected');
      });
      
      socket.on('message', (data) => {
        if (data.type === 'position') {
          updateVesselPosition(data.data);
        } else if (data.type === 'vessel_info') {
          updateVesselInfo(data.data);
        }
      });
      
      wsRef.current = socket;
    } catch (error) {
      console.error('WebSocket connection error:', error);
    }
  };

  const loadVessels = async () => {
    try {
      const response = await axios.get(`${API}/vessels?limit=100`);
      setVessels(response.data.vessels || []);
    } catch (error) {
      console.error('Error loading vessels:', error);
      const errorMsg = error.response?.data?.detail || error.message || 'Unknown error';
      toast.error(`Failed to load vessels: ${errorMsg}`);
    }
  };

  const loadRecentPositions = async () => {
    try {
      const response = await axios.get(`${API}/positions/recent?limit=100`);
      const positions = response.data.positions || [];
      
      // Update vessels with positions
      setVessels(prev => {
        const updated = [...prev];
        positions.forEach(pos => {
          const idx = updated.findIndex(v => v.mmsi === pos.mmsi);
          if (idx >= 0) {
            updated[idx].last_position = pos;
          } else {
            updated.push({ mmsi: pos.mmsi, last_position: pos });
          }
        });
        return updated;
      });
    } catch (error) {
      console.error('Error loading positions:', error);
    }
  };

  const loadSerialPorts = async () => {
    try {
      const response = await axios.get(`${API}/serial/ports`);
      setSerialPorts(response.data.ports || []);
    } catch (error) {
      console.error('Error loading serial ports:', error);
    }
  };

  const loadActiveStreams = async () => {
    try {
      const response = await axios.get(`${API}/stream/active`);
      setActiveStreams(response.data.streams || {});
    } catch (error) {
      console.error('Error loading active streams:', error);
    }
  };

  const updateVesselPosition = (posData) => {
    setVessels(prev => {
      const updated = [...prev];
      const idx = updated.findIndex(v => v.mmsi === posData.mmsi);
      if (idx >= 0) {
        updated[idx].last_position = posData;
      } else {
        updated.push({ mmsi: posData.mmsi, last_position: posData });
      }
      return updated;
    });
  };

  const updateVesselInfo = (vesselData) => {
    setVessels(prev => {
      const updated = [...prev];
      const idx = updated.findIndex(v => v.mmsi === vesselData.mmsi);
      if (idx >= 0) {
        updated[idx] = { ...updated[idx], ...vesselData };
      } else {
        updated.push(vesselData);
      }
      return updated;
    });
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploadProgress(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post(`${API}/upload`, formData);
      toast.success(`Processed ${response.data.processed} messages`);
      await loadVessels();
      await loadRecentPositions();
    } catch (error) {
      toast.error('Upload failed');
    } finally {
      setUploadProgress(false);
    }
  };

  const startStream = async () => {
    try {
      const config = {
        stream_type: streamType,
        host: streamType !== 'serial' ? tcpHost : undefined,
        port: streamType !== 'serial' ? parseInt(tcpPort) : undefined,
        serial_port: streamType === 'serial' ? serialPort : undefined,
        baudrate: streamType === 'serial' ? parseInt(baudrate) : undefined
      };
      
      const response = await axios.post(`${API}/stream/start`, config);
      toast.success(`${streamType.toUpperCase()} stream started`);
      await loadActiveStreams();
      setShowConnectionPanel(false);
    } catch (error) {
      toast.error('Failed to start stream');
    }
  };

  const stopStream = async (streamId) => {
    try {
      await axios.post(`${API}/stream/stop/${streamId}`);
      toast.success('Stream stopped');
      await loadActiveStreams();
    } catch (error) {
      toast.error('Failed to stop stream');
    }
  };

  const selectVessel = async (vessel) => {
    setSelectedVessel(vessel);
    
    // Load vessel details and track
    try {
      const response = await axios.get(`${API}/vessel/${vessel.mmsi}`);
      const vesselData = response.data;
      
      if (vesselData.track && vesselData.track.length > 0) {
        setVesselTrack(vesselData.track);
        
        // Center map on vessel
        const lastPos = vesselData.track[0];
        if (lastPos.lat && lastPos.lon) {
          setMapCenter([lastPos.lat, lastPos.lon]);
          setMapZoom(12);
        }
      }
    } catch (error) {
      console.error('Error loading vessel details:', error);
    }
  };

  const handleSearch = async () => {
    try {
      const response = await axios.post(`${API}/search`, {
        mmsi: searchMMSI || undefined,
        vessel_name: searchName || undefined
      });
      setVessels(response.data.vessels || []);
    } catch (error) {
      toast.error('Search failed');
    }
  };

  const getMapTileUrl = () => {
    switch (mapProvider) {
      case 'osm':
        return 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      case 'satellite':
        return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
      case 'nautical':
        return 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png';
      default:
        return 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    }
  };

  return (
    <div className="App">
      <Toaster position="top-right" />
      
      {/* Header */}
      <header className="nautical-header">
        <div className="header-content">
          <div className="logo-section">
            <Anchor className="logo-icon" size={32} />
            <h1>AIS Maritime Tracker</h1>
          </div>
          
          <div className="header-controls">
            <Badge variant={wsConnected ? "default" : "destructive"} className="status-badge">
              {wsConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span className="ml-1">{wsConnected ? 'Live' : 'Offline'}</span>
            </Badge>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadProgress}
              data-testid="upload-file-button"
            >
              <Upload size={16} className="mr-2" />
              Upload Log
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowConnectionPanel(!showConnectionPanel)}
              data-testid="stream-connection-button"
            >
              <Radio size={16} className="mr-2" />
              Stream
            </Button>
            
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.log,.nmea"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </div>
        </div>
      </header>

      <div className="main-container">
        {/* Sidebar */}
        <aside className="sidebar">
          {/* Search Panel */}
          <Card className="search-card">
            <CardHeader>
              <CardTitle className="text-sm">Search Vessels</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Input
                  placeholder="MMSI Number"
                  value={searchMMSI}
                  onChange={(e) => setSearchMMSI(e.target.value)}
                  data-testid="search-mmsi-input"
                />
                <Input
                  placeholder="Vessel Name"
                  value={searchName}
                  onChange={(e) => setSearchName(e.target.value)}
                  data-testid="search-name-input"
                />
                <Button
                  className="w-full"
                  onClick={handleSearch}
                  data-testid="search-button"
                >
                  <Search size={16} className="mr-2" />
                  Search
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Map Provider Selection */}
          <Card className="map-provider-card">
            <CardHeader>
              <CardTitle className="text-sm">Map Provider</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={mapProvider} onValueChange={setMapProvider}>
                <SelectTrigger data-testid="map-provider-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="osm">OpenStreetMap</SelectItem>
                  <SelectItem value="satellite">Satellite</SelectItem>
                  <SelectItem value="nautical">Nautical Chart</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Vessel List */}
          <Card className="vessel-list-card">
            <CardHeader>
              <CardTitle className="text-sm">
                <Ship size={16} className="inline mr-2" />
                Vessels ({vessels.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="vessel-list" data-testid="vessel-list">
                {vessels.map((vessel) => (
                  <div
                    key={vessel.mmsi}
                    className={`vessel-item ${selectedVessel?.mmsi === vessel.mmsi ? 'selected' : ''}`}
                    onClick={() => selectVessel(vessel)}
                    data-testid={`vessel-item-${vessel.mmsi}`}
                  >
                    <div className="vessel-info">
                      <div className="vessel-name">
                        {vessel.name || `MMSI: ${vessel.mmsi}`}
                      </div>
                      <div className="vessel-details">
                        <span className="mmsi-badge">{vessel.mmsi}</span>
                        {vessel.ship_type_text && (
                          <span className="type-badge">{vessel.ship_type_text}</span>
                        )}
                      </div>
                      {vessel.last_position && (
                        <div className="vessel-position">
                          <MapPin size={12} />
                          {vessel.last_position.lat?.toFixed(4)}, {vessel.last_position.lon?.toFixed(4)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </aside>

        {/* Map Container */}
        <main className="map-section">
          <div className="map-container" data-testid="map-container">
            <MapContainer
              center={mapCenter}
              zoom={mapZoom}
              style={{ height: '100%', width: '100%' }}
              zoomControl={true}
            >
              <MapUpdater center={mapCenter} zoom={mapZoom} />
              <TileLayer
                url={getMapTileUrl()}
                attribution='&copy; OpenStreetMap contributors'
              />
              
              {/* Vessel Markers */}
              {vessels.map((vessel) => {
                if (!vessel.last_position?.lat || !vessel.last_position?.lon) return null;
                
                return (
                  <Marker
                    key={vessel.mmsi}
                    position={[vessel.last_position.lat, vessel.last_position.lon]}
                    icon={createShipIcon(vessel.last_position.heading)}
                  >
                    <Popup>
                      <div className="vessel-popup">
                        <h3>{vessel.name || `MMSI: ${vessel.mmsi}`}</h3>
                        <p><strong>MMSI:</strong> {vessel.mmsi}</p>
                        {vessel.callsign && <p><strong>Callsign:</strong> {vessel.callsign}</p>}
                        {vessel.ship_type_text && <p><strong>Type:</strong> {vessel.ship_type_text}</p>}
                        {vessel.last_position.speed !== null && (
                          <p><strong>Speed:</strong> {vessel.last_position.speed} knots</p>
                        )}
                        {vessel.last_position.course !== null && (
                          <p><strong>Course:</strong> {vessel.last_position.course}°</p>
                        )}
                        {vessel.destination && <p><strong>Destination:</strong> {vessel.destination}</p>}
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
              
              {/* Selected Vessel Track */}
              {selectedVessel && vesselTrack.length > 1 && (
                <Polyline
                  positions={vesselTrack
                    .filter(p => p.lat && p.lon)
                    .map(p => [p.lat, p.lon])}
                  color="#3b82f6"
                  weight={2}
                  opacity={0.7}
                />
              )}
            </MapContainer>
          </div>
        </main>

        {/* Connection Panel */}
        {showConnectionPanel && (
          <div className="connection-panel">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>Stream Connection</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowConnectionPanel(false)}
                  >
                    <X size={16} />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs value={streamType} onValueChange={setStreamType}>
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="tcp">TCP</TabsTrigger>
                    <TabsTrigger value="udp">UDP</TabsTrigger>
                    <TabsTrigger value="serial">Serial</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="tcp" className="space-y-3">
                    <Input
                      placeholder="Host"
                      value={tcpHost}
                      onChange={(e) => setTcpHost(e.target.value)}
                    />
                    <Input
                      placeholder="Port"
                      value={tcpPort}
                      onChange={(e) => setTcpPort(e.target.value)}
                    />
                  </TabsContent>
                  
                  <TabsContent value="udp" className="space-y-3">
                    <Input
                      placeholder="Host"
                      value={tcpHost}
                      onChange={(e) => setTcpHost(e.target.value)}
                    />
                    <Input
                      placeholder="Port"
                      value={tcpPort}
                      onChange={(e) => setTcpPort(e.target.value)}
                    />
                  </TabsContent>
                  
                  <TabsContent value="serial" className="space-y-3">
                    <Select value={serialPort} onValueChange={setSerialPort}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select Serial Port" />
                      </SelectTrigger>
                      <SelectContent>
                        {serialPorts.map(port => (
                          <SelectItem key={port.device} value={port.device}>
                            {port.device} - {port.description}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Baudrate"
                      value={baudrate}
                      onChange={(e) => setBaudrate(e.target.value)}
                    />
                  </TabsContent>
                </Tabs>
                
                <Button
                  className="w-full mt-4"
                  onClick={startStream}
                  data-testid="start-stream-button"
                >
                  Start Stream
                </Button>
                
                {/* Active Streams */}
                {Object.keys(activeStreams).length > 0 && (
                  <div className="active-streams mt-4">
                    <h4 className="text-sm font-semibold mb-2">Active Streams</h4>
                    {Object.entries(activeStreams).map(([id, type]) => (
                      <div key={id} className="stream-item">
                        <span>{type.toUpperCase()}</span>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => stopStream(id)}
                        >
                          Stop
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
