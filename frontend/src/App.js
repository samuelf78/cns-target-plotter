import { useEffect, useState, useRef } from "react";
import "@/App.css";
import axios from "axios";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import io from 'socket.io-client';
import { Upload, Radio, Wifi, WifiOff, Search, Filter, Play, Pause, Clock, Ship, Anchor, MapPin, Settings, X, Trash2, Power, PowerOff, ChevronDown, ChevronRight, Database } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Badge } from './components/ui/badge';
import { toast } from 'sonner';
import { Toaster } from './components/ui/sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './components/ui/dialog';
import { ScrollArea } from './components/ui/scroll-area';
import { Switch } from './components/ui/switch';

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

// Create direction arrow icon with color
const createArrowIcon = (heading, positionCount) => {
  let color = '#ef4444'; // red - 1 position
  if (positionCount > 2) {
    color = '#22c55e'; // green - more than 2
  } else if (positionCount === 2) {
    color = '#eab308'; // yellow - 2 positions
  }
  
  const rotation = heading || 0;
  
  return L.divIcon({
    html: `<div style="transform: rotate(${rotation}deg); width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="${color}" stroke="#ffffff" stroke-width="1.5">
        <path d="M12 2 L2 22 L12 18 L22 22 Z"/>
      </svg>
    </div>`,
    className: 'custom-arrow-icon',
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
  const [vesselHistory, setVesselHistory] = useState(null);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [expandedFields, setExpandedFields] = useState({});
  const [mapProvider, setMapProvider] = useState('osm');
  const [mapCenter, setMapCenter] = useState([37.7749, -122.4194]);
  const [mapZoom, setMapZoom] = useState(8);
  const [wsConnected, setWsConnected] = useState(false);
  const [sources, setSources] = useState([]);
  const [showSourceManager, setShowSourceManager] = useState(false);
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
    loadSources();
    connectWebSocket();
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
      const response = await axios.get(`${API}/vessels/active?limit=1000`);
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
      const errorMsg = error.response?.data?.detail || error.message;
      if (errorMsg) {
        toast.error(`Failed to load positions: ${errorMsg}`);
      }
    }
  };

  const loadSources = async () => {
    try {
      const response = await axios.get(`${API}/sources`);
      setSources(response.data.sources || []);
    } catch (error) {
      console.error('Error loading sources:', error);
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
      const processed = response.data.processed || 0;
      const errors = response.data.errors || 0;
      
      if (processed > 0) {
        toast.success(`Processed ${processed} messages${errors > 0 ? ` (${errors} errors)` : ''}`);
        await loadVessels();
        await loadRecentPositions();
        await loadSources();
      } else {
        toast.warning('No valid AIS messages found in file');
      }
    } catch (error) {
      console.error('Upload error:', error);
      const errorMsg = error.response?.data?.detail || error.message || 'Unknown error';
      toast.error(`Upload failed: ${errorMsg}`);
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
      await loadSources();
      setShowConnectionPanel(false);
    } catch (error) {
      toast.error('Failed to start stream');
    }
  };

  const toggleSource = async (sourceId) => {
    try {
      const response = await axios.patch(`${API}/sources/${sourceId}/toggle`);
      toast.success(`Source ${response.data.status}`);
      await loadSources();
      await loadVessels();
      await loadRecentPositions();
    } catch (error) {
      toast.error('Failed to toggle source');
    }
  };

  const disableAllSources = async () => {
    try {
      const response = await axios.post(`${API}/sources/disable-all`);
      toast.success(`All sources disabled (${response.data.count})`);
      await loadSources();
      setVessels([]);
      setSelectedVessel(null);
      setVesselTrack([]);
    } catch (error) {
      toast.error('Failed to disable all sources');
    }
  };

  const deleteSource = async (sourceId) => {
    try {
      await axios.delete(`${API}/sources/${sourceId}`);
      toast.success('Source removed');
      await loadSources();
    } catch (error) {
      toast.error('Failed to remove source');
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

  const loadVesselHistory = async (mmsi) => {
    try {
      const response = await axios.get(`${API}/history/${mmsi}`);
      setVesselHistory(response.data);
      setShowHistoryDialog(true);
    } catch (error) {
      console.error('Error loading vessel history:', error);
      toast.error('Failed to load vessel history');
    }
  };

  const handleSearch = async () => {
    try {
      const response = await axios.post(`${API}/search`, {
        mmsi: searchMMSI || undefined,
        vessel_name: searchName || undefined
      });
      setVessels(response.data.vessels || []);
      if (response.data.vessels.length === 0) {
        toast.info('No vessels found matching your search');
      }
    } catch (error) {
      console.error('Search error:', error);
      const errorMsg = error.response?.data?.detail || error.message || 'Unknown error';
      toast.error(`Search failed: ${errorMsg}`);
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

  const getPositionCount = (vessel) => {
    // This would ideally come from the backend, but we'll estimate
    return vessel.position_count || 1;
  };

  const toggleFieldExpansion = (field) => {
    setExpandedFields(prev => ({
      ...prev,
      [field]: !prev[field]
    }));
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
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSourceManager(!showSourceManager)}
              data-testid="source-manager-button"
            >
              <Database size={16} className="mr-2" />
              Sources ({sources.length})
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
                
                const posCount = getPositionCount(vessel);
                
                return (
                  <Marker
                    key={vessel.mmsi}
                    position={[vessel.last_position.lat, vessel.last_position.lon]}
                    icon={createArrowIcon(vessel.last_position.heading || vessel.last_position.course, posCount)}
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
                        <Button 
                          size="sm" 
                          className="mt-2 w-full"
                          onClick={() => loadVesselHistory(vessel.mmsi)}
                        >
                          View Full History
                        </Button>
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
              </CardContent>
            </Card>
          </div>
        )}

        {/* Source Manager Panel */}
        {showSourceManager && (
          <div className="source-manager-panel">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>Data Source Manager</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSourceManager(false)}
                  >
                    <X size={16} />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 mb-3">
                  {sources.length > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      onClick={disableAllSources}
                    >
                      <PowerOff size={16} className="mr-2" />
                      Disable All Sources
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={async () => {
                      if (window.confirm('Clear all vessel data? This will remove all vessels, positions, and messages from the database. Sources will be kept.')) {
                        try {
                          const response = await axios.post(`${API}/database/clear`);
                          toast.success(`Database cleared: ${response.data.vessels_deleted} vessels, ${response.data.positions_deleted} positions, ${response.data.messages_deleted} messages`);
                          setVessels([]);
                          setSelectedVessel(null);
                          setVesselTrack([]);
                        } catch (error) {
                          toast.error('Failed to clear database');
                        }
                      }
                    }}
                  >
                    <Trash2 size={16} className="mr-2" />
                    Clear Database
                  </Button>
                </div>
                <ScrollArea className="h-96">
                  {sources.length === 0 ? (
                    <p className="text-center text-gray-400 py-4">No data sources</p>
                  ) : (
                    <div className="space-y-2">
                      {sources.map(source => (
                        <div key={source.source_id} className="source-item">
                          <div className="source-info">
                            <div className="source-name">{source.name}</div>
                            <div className="source-meta">
                              <span className="source-type">{source.source_type.toUpperCase()}</span>
                              <span className="source-count">{source.message_count || 0} msgs</span>
                            </div>
                          </div>
                          <div className="source-controls">
                            <Switch
                              checked={source.status === 'active'}
                              onCheckedChange={() => toggleSource(source.source_id)}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteSource(source.source_id)}
                            >
                              <Trash2 size={16} />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* History Dialog */}
      <Dialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>
              Vessel History - MMSI: {vesselHistory?.mmsi}
            </DialogTitle>
          </DialogHeader>
          {vesselHistory && (
            <ScrollArea className="h-[600px] pr-4">
              <div className="space-y-4">
                {/* Summary */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p>Position Records: {vesselHistory.position_count}</p>
                    <p>Total Messages: {vesselHistory.message_count}</p>
                  </CardContent>
                </Card>

                {/* Vessel Info */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Vessel Information</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      {Object.entries(vesselHistory.vessel || {}).map(([key, value]) => {
                        if (key === '_id' || key === 'last_position' || key === 'track') return null;
                        return (
                          <div key={key} className="flex justify-between">
                            <span className="font-semibold">{key}:</span>
                            <span>{String(value)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* Positions */}
                <Card>
                  <CardHeader>
                    <div className="flex justify-between items-center cursor-pointer" onClick={() => toggleFieldExpansion('positions')}>
                      <CardTitle className="text-base">Position History ({vesselHistory.positions.length})</CardTitle>
                      {expandedFields.positions ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </div>
                  </CardHeader>
                  {expandedFields.positions && (
                    <CardContent>
                      <div className="space-y-2 max-h-60 overflow-y-auto text-xs">
                        {vesselHistory.positions.slice(0, 50).map((pos, idx) => (
                          <div key={idx} className="border-b pb-1">
                            <p><strong>Time:</strong> {pos.timestamp}</p>
                            <p><strong>Pos:</strong> {pos.lat?.toFixed(6)}, {pos.lon?.toFixed(6)}</p>
                            <p><strong>Speed:</strong> {pos.speed} kts, <strong>Course:</strong> {pos.course}°</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  )}
                </Card>

                {/* Messages */}
                <Card>
                  <CardHeader>
                    <div className="flex justify-between items-center cursor-pointer" onClick={() => toggleFieldExpansion('messages')}>
                      <CardTitle className="text-base">All Messages ({vesselHistory.messages.length})</CardTitle>
                      {expandedFields.messages ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </div>
                  </CardHeader>
                  {expandedFields.messages && (
                    <CardContent>
                      <div className="space-y-2 max-h-60 overflow-y-auto text-xs">
                        {vesselHistory.messages.slice(0, 100).map((msg, idx) => (
                          <div key={idx} className="border-b pb-1">
                            <p><strong>Type {msg.message_type}:</strong> {msg.timestamp}</p>
                            <p className="text-gray-400 truncate">{msg.raw}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  )}
                </Card>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default App;
