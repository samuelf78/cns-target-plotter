import React, { useEffect, useState, useRef } from "react";
import "@/App.css";
import axios from "axios";
import { MapContainer, TileLayer, Marker, Polyline, Popup, Circle, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// Removed socket.io - using native WebSocket and polling
import { Upload, Radio, Wifi, WifiOff, Search, Filter, Play, Pause, Clock, Ship, Anchor, MapPin, Settings, X, Trash2, Power, PowerOff, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, Database, Activity, Download } from 'lucide-react';
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

// Check if MMSI is a base station / shore station
const isBaseStation = (vessel) => {
  if (!vessel) return false;
  // Check backend flag first (for VDO Type 4 messages)
  if (vessel.is_base_station) return true;
  // Base stations typically start with 00 (e.g., 002..., 003...)
  return vessel.mmsi && vessel.mmsi.startsWith('00');
};

// Check if vessel is an AtoN (Aid to Navigation)
const isAtoN = (vessel) => {
  if (!vessel) return false;
  // Check backend flag
  if (vessel.is_aton) return true;
  // AtoN MMSIs typically start with 99 (e.g., 992..., 993...)
  return vessel.mmsi && vessel.mmsi.startsWith('99');
};

// Check if vessel is SAR (Search and Rescue) aircraft
const isSARTarget = (vessel) => {
  if (!vessel) return false;
  // SAR aircraft MMSIs start with 111
  return vessel.mmsi && vessel.mmsi.startsWith('111');
};

// Validate heading per AIS specification
const isValidHeading = (heading) => {
  if (heading === null || heading === undefined) return false;
  // 511 = not available, 0-359 = valid
  return heading >= 0 && heading <= 359;
};

// Validate course per AIS specification
const isValidCourse = (course) => {
  if (course === null || course === undefined) return false;
  // 360 = not available, 0-359.9 = valid
  return course >= 0 && course < 360;
};

// Get best available direction for marker rotation
const getBestDirection = (position) => {
  if (!position) return null;
  
  const heading = position.heading;
  const course = position.course;
  
  // Prefer heading if valid
  if (isValidHeading(heading)) return heading;
  
  // Fall back to course if valid
  if (isValidCourse(course)) return course;
  
  // No valid direction available
  return null;
};

// Create base station icon with color (green = own, orange = received)
// multiSource: adds white asterisk in center if verified across multiple sources
const createBaseStationIcon = (isOwn, multiSource = false) => {
  const color = isOwn ? '#22c55e' : '#fb923c'; // green for own, orange for received
  const asterisk = multiSource ? '<span style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 18px; font-weight: bold;">*</span>' : '';
  
  return L.divIcon({
    html: `<div style="width: 24px; height: 24px; background-color: ${color}; border: 2px solid #ffffff; box-shadow: 0 0 6px rgba(0,0,0,0.4); position: relative;">${asterisk}</div>`,
    className: 'custom-base-station-icon',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
};

// Create yellow diamond icon for AtoN (Aid to Navigation)
const createAtoNIcon = () => {
  return L.divIcon({
    html: `<div style="width: 20px; height: 20px; background-color: #eab308; border: 2px solid #ffffff; box-shadow: 0 0 6px rgba(234, 179, 8, 0.6); transform: rotate(45deg);"></div>`,
    className: 'custom-aton-icon',
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
};

// Create simple circle icon for vessels without direction data
const createCircleIcon = (positionCount, isSpoofed) => {
  let color = '#ef4444'; // red - 1 position
  if (positionCount > 2) {
    color = '#22c55e'; // green - more than 2
  } else if (positionCount === 2) {
    color = '#eab308'; // yellow - 2 positions
  }
  
  // Grey out if spoofed
  if (isSpoofed) {
    color = '#6b7280'; // grey
  }
  
  const opacity = isSpoofed ? 0.4 : 1.0;
  
  return L.divIcon({
    html: `<div style="
      width: 12px;
      height: 12px;
      background-color: ${color};
      border: 2px solid #ffffff;
      border-radius: 50%;
      opacity: ${opacity};
      filter: drop-shadow(0 0 2px rgba(0,0,0,0.5));
    "></div>`,
    className: 'custom-circle-icon',
    iconSize: [12, 12],
    iconAnchor: [6, 6]
  });
};

// Create airplane icon for SAR (Search and Rescue) aircraft
const createSARIcon = (heading, positionCount, isSpoofed) => {
  let color = '#ef4444'; // red - 1 position
  if (positionCount > 2) {
    color = '#22c55e'; // green - more than 2
  } else if (positionCount === 2) {
    color = '#eab308'; // yellow - 2 positions
  }
  
  // Grey out if spoofed
  if (isSpoofed) {
    color = '#6b7280'; // grey
  }
  
  const rotation = heading || 0;
  const opacity = isSpoofed ? 0.4 : 1.0;
  
  // Simple airplane shape using CSS
  return L.divIcon({
    html: `<div style="
      position: relative;
      width: 24px;
      height: 24px;
      transform: rotate(${rotation}deg);
      opacity: ${opacity};
    ">
      <div style="
        position: absolute;
        width: 4px;
        height: 20px;
        background-color: ${color};
        left: 10px;
        top: 2px;
      "></div>
      <div style="
        position: absolute;
        width: 20px;
        height: 4px;
        background-color: ${color};
        left: 2px;
        top: 8px;
      "></div>
      <div style="
        position: absolute;
        width: 10px;
        height: 3px;
        background-color: ${color};
        left: 7px;
        top: 16px;
      "></div>
    </div>`,
    className: 'custom-sar-icon',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
};

// Create simple triangle marker pointing in heading direction (much faster than SVG arrows)
const createTriangleIcon = (heading, positionCount, isSpoofed) => {
  let color = '#ef4444'; // red - 1 position
  if (positionCount > 2) {
    color = '#22c55e'; // green - more than 2
  } else if (positionCount === 2) {
    color = '#eab308'; // yellow - 2 positions
  }
  
  // Grey out if spoofed
  if (isSpoofed) {
    color = '#6b7280'; // grey
  }
  
  const rotation = heading || 0;
  const opacity = isSpoofed ? 0.4 : 1.0;
  
  // Simple CSS triangle - MUCH faster than SVG
  return L.divIcon({
    html: `<div style="
      width: 0; 
      height: 0; 
      border-left: 8px solid transparent;
      border-right: 8px solid transparent;
      border-bottom: 20px solid ${color};
      transform: rotate(${rotation}deg);
      transform-origin: center 13px;
      opacity: ${opacity};
      filter: drop-shadow(0 0 2px rgba(0,0,0,0.5));
    "></div>`,
    className: 'custom-triangle-icon',
    iconSize: [16, 20],
    iconAnchor: [8, 13]
  });
};

// Helper functions to get display coordinates (with fallback to original coordinates for backward compatibility)
const getDisplayLat = (position) => {
  if (!position) return null;
  return position.display_lat !== undefined ? position.display_lat : position.lat;
};

const getDisplayLon = (position) => {
  if (!position) return null;
  return position.display_lon !== undefined ? position.display_lon : position.lon;
};

const hasValidDisplayPosition = (position) => {
  if (!position) return false;
  const lat = getDisplayLat(position);
  const lon = getDisplayLon(position);
  return lat !== null && lat !== undefined && lon !== null && lon !== undefined && lat !== 0 && lon !== 0;
};

// Interpolate position between two timestamps
const interpolatePosition = (pos1, pos2, targetTimestamp) => {
  if (!pos1 || !pos2) return null;
  
  const t1 = new Date(pos1.timestamp).getTime();
  const t2 = new Date(pos2.timestamp).getTime();
  const t = targetTimestamp;
  
  // If timestamps are the same, return pos1
  if (t2 === t1) return pos1;
  
  // Calculate interpolation factor (0 = pos1, 1 = pos2)
  const factor = (t - t1) / (t2 - t1);
  
  // Interpolate lat/lon
  const lat = pos1.lat + (pos2.lat - pos1.lat) * factor;
  const lon = pos1.lon + (pos2.lon - pos1.lon) * factor;
  
  // Interpolate other numeric fields if available
  const speed = pos1.speed !== null && pos2.speed !== null 
    ? pos1.speed + (pos2.speed - pos1.speed) * factor 
    : pos1.speed || pos2.speed;
    
  const course = pos1.course !== null && pos2.course !== null
    ? pos1.course + (pos2.course - pos1.course) * factor
    : pos1.course || pos2.course;
  
  return {
    ...pos1,
    lat,
    lon,
    display_lat: lat,
    display_lon: lon,
    speed,
    course,
    interpolated: true,
    timestamp: new Date(t).toISOString()
  };
};

// Get position at specific timestamp from track
const getPositionAtTime = (track, targetTimestamp) => {
  if (!track || track.length === 0) return null;
  
  // Sort track by timestamp (oldest to newest)
  const sortedTrack = [...track].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  // If target is before first position, return null (vessel doesn't exist yet)
  const firstTime = new Date(sortedTrack[0].timestamp).getTime();
  if (targetTimestamp < firstTime) return null;
  
  // If target is after last position, return last position (greyed out)
  const lastTime = new Date(sortedTrack[sortedTrack.length - 1].timestamp).getTime();
  if (targetTimestamp >= lastTime) {
    return { ...sortedTrack[sortedTrack.length - 1], atEnd: true };
  }
  
  // Find positions before and after target timestamp
  for (let i = 0; i < sortedTrack.length - 1; i++) {
    const t1 = new Date(sortedTrack[i].timestamp).getTime();
    const t2 = new Date(sortedTrack[i + 1].timestamp).getTime();
    
    if (targetTimestamp >= t1 && targetTimestamp < t2) {
      // Interpolate between these two positions
      return interpolatePosition(sortedTrack[i], sortedTrack[i + 1], targetTimestamp);
    }
  }
  
  // Shouldn't reach here, but return last position as fallback
  return sortedTrack[sortedTrack.length - 1];
};

function MapUpdater({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center && zoom !== undefined) {
      // Explicitly set both center and zoom (rare case)
      map.setView(center, zoom);
    } else if (center) {
      // Only pan to new center - NEVER change zoom
      map.panTo(center, { animate: true, duration: 0.5 });
    }
  }, [center, map]); // zoom removed from dependencies
  return null;
}

function App() {
  const [vessels, setVessels] = useState([]);
  const [selectedVessel, setSelectedVessel] = useState(null);
  const [vesselTrack, setVesselTrack] = useState([]);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [showVesselPanel, setShowVesselPanel] = useState(false);
  const [vesselHistory, setVesselHistory] = useState(null);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [expandedFields, setExpandedFields] = useState({});
  const [mapProvider, setMapProvider] = useState('osm');
  const [mapCenter, setMapCenter] = useState([37.7749, -122.4194]);
  const [mapZoom, setMapZoom] = useState(8);
  const [wsConnected, setWsConnected] = useState(false);
  const [sources, setSources] = useState([]);
  const [vesselSources, setVesselSources] = useState([]);
  const [vdoData, setVdoData] = useState([]);
  const [editingSpoofLimit, setEditingSpoofLimit] = useState(null);
  const [editingMessageLimit, setEditingMessageLimit] = useState(null);
  const [editingTargetLimit, setEditingTargetLimit] = useState(null);
  const [showSourceManager, setShowSourceManager] = useState(false);
  const [searchMMSI, setSearchMMSI] = useState('');
  const [searchName, setSearchName] = useState('');
  const [uploadProgress, setUploadProgress] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [showConnectionPanel, setShowConnectionPanel] = useState(false);
  const [showClearDbDialog, setShowClearDbDialog] = useState(false);
  const [showDeleteSourceDialog, setShowDeleteSourceDialog] = useState(false);
  const [sourceToDelete, setSourceToDelete] = useState(null);
  const [deleteSourceData, setDeleteSourceData] = useState(false);
  const [showStatusPanel, setShowStatusPanel] = useState(false);
  const [systemStatus, setSystemStatus] = useState(null);
  
  // Geographic filter settings
  const [geoFilter, setGeoFilter] = useState('viewport'); // 'viewport' or 'rectangle' (removed 'world')
  const [geoRectangle, setGeoRectangle] = useState({
    minLat: '',
    maxLat: '',
    minLon: '',
    maxLon: ''
  });
  const [showGeoFilter, setShowGeoFilter] = useState(false);
  
  // Display options
  const [showAllTrails, setShowAllTrails] = useState(false);
  const [vesselTrails, setVesselTrails] = useState({}); // {mmsi: [positions]}
  const [searchResults, setSearchResults] = useState([]); // Search results only
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false); // Sidebar collapse state
  
  // Connection settings
  const [streamType, setStreamType] = useState('tcp');
  const [tcpHost, setTcpHost] = useState('localhost');
  const [tcpPort, setTcpPort] = useState('10110');
  const [serialPort, setSerialPort] = useState('');
  const [serialPorts, setSerialPorts] = useState([]);
  const [baudrate, setBaudrate] = useState('9600');
  
  // Temporal playback (time slider)
  const [temporalMode, setTemporalMode] = useState(false);
  const [temporalSliderValue, setTemporalSliderValue] = useState(100); // 0-100, 100 = current time
  const [temporalTimestamp, setTemporalTimestamp] = useState(null);
  const [temporalTracks, setTemporalTracks] = useState({}); // {mmsi: [positions]}
  const [loadingTemporalData, setLoadingTemporalData] = useState(false);
  const [selectedVesselTimeRange, setSelectedVesselTimeRange] = useState({ min: null, max: null });
  
  const fileInputRef = useRef(null);
  const wsRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const debounceTimeoutRef = useRef(null);
  const realtimePollingRef = useRef(null); // For real-time TCP updates
  const mapRef = useRef(null); // For map centering

  useEffect(() => {
    // Don't load vessels by default - only load when searching
    loadSources();
    startPolling();
    loadSerialPorts();
    connectWebSocket();
    
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (realtimePollingRef.current) {
        clearInterval(realtimePollingRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);
  
  // Start real-time polling when sources become active
  useEffect(() => {
    const activeSources = sources.filter(s => s.status === 'active');
    
    if (activeSources.length > 0 && !realtimePollingRef.current) {
      console.log('🔴 Starting real-time polling - Active sources detected');
      
      // Start polling with adaptive interval
      const startPolling = () => {
        realtimePollingRef.current = setInterval(() => {
          console.log('🔴 Real-time poll: Fetching vessels with geographic filter');
          // Use the same filter params as loadVessels (full 5000 limit)
          const params = buildGeoFilterParams();
          axios.get(`${API}/vessels/active?${params}`)
            .then(response => {
              const vessels = response.data.vessels || [];
              const vdoData = response.data.vdo_data || [];
              console.log(`🔴 Received ${vessels.length} vessels, ${vdoData.length} VDO positions`);
              setVessels(vessels);
              setVdoData(vdoData);
              
              // Adaptive polling: if many vessels, slow down
              if (vessels.length > 500 && realtimePollingRef.interval === 2000) {
                console.log('🔴 Many vessels detected, slowing polling to 5 seconds');
                clearInterval(realtimePollingRef.current);
                realtimePollingRef.interval = 5000;
                startPolling();
              }
            })
            .catch(error => {
              console.error('🔴 Error fetching vessels:', error);
            });
        }, realtimePollingRef.interval || 2000);
      };
      
      realtimePollingRef.interval = 2000; // Start with 2 seconds
      startPolling();
      
    } else if (activeSources.length === 0 && realtimePollingRef.current) {
      console.log('🔴 Stopping real-time polling - No active sources');
      clearInterval(realtimePollingRef.current);
      realtimePollingRef.current = null;
      realtimePollingRef.interval = 2000; // Reset interval
    }
    
    return () => {
      if (realtimePollingRef.current) {
        clearInterval(realtimePollingRef.current);
        realtimePollingRef.current = null;
      }
    };
  }, [sources, geoFilter, geoRectangle]); // Re-run when sources or filter changes

  const connectWebSocket = () => {
    try {
      const wsUrl = `${WS_URL}/api/ws`;
      console.log('Connecting to WebSocket:', wsUrl);
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        setWsConnected(true);
        toast.success('Real-time updates connected');
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('WebSocket message received:', message.type);
          
          if (message.type === 'position') {
            // Real-time position update
            updateVesselPosition(message.data);
          } else if (message.type === 'vessel_info') {
            // Vessel information update
            updateVesselInfo(message.data);
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setWsConnected(false);
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setWsConnected(false);
        // Reconnect after 5 seconds
        setTimeout(() => {
          console.log('Attempting WebSocket reconnection...');
          connectWebSocket();
        }, 5000);
      };
    } catch (error) {
      console.error('Error creating WebSocket:', error);
      setWsConnected(false);
    }
  };

  const startPolling = () => {
    // Poll for vessel updates every 5 seconds (only if we have search results)
    pollIntervalRef.current = setInterval(async () => {
      try {
        if (vessels.length > 0) {
          await loadRecentPositions();
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 5000);
    setWsConnected(true);
  };

  // Helper function to build geographic filter parameters
  const buildGeoFilterParams = () => {
    let params = 'limit=5000';
    
    // Add geographic filter parameters
    if (geoFilter === 'viewport' && mapRef.current) {
      const bounds = mapRef.current.getBounds();
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      
      params += `&geo_filter=viewport&min_lat=${sw.lat}&max_lat=${ne.lat}&min_lon=${sw.lng}&max_lon=${ne.lng}`;
    } else if (geoFilter === 'rectangle') {
      // Use defaults if empty
      const minLat = geoRectangle.minLat === '' ? -90 : parseFloat(geoRectangle.minLat);
      const maxLat = geoRectangle.maxLat === '' ? 90 : parseFloat(geoRectangle.maxLat);
      const minLon = geoRectangle.minLon === '' ? -180 : parseFloat(geoRectangle.minLon);
      const maxLon = geoRectangle.maxLon === '' ? 180 : parseFloat(geoRectangle.maxLon);
      
      params += `&geo_filter=rectangle&min_lat=${minLat}&max_lat=${maxLat}&min_lon=${minLon}&max_lon=${maxLon}`;
    } else {
      params += '&geo_filter=world';
    }
    
    return params;
  };

  const loadVessels = async () => {
    try {
      const params = buildGeoFilterParams();
      const response = await axios.get(`${API}/vessels/active?${params}`);
      setVessels(response.data.vessels || []);
      setVdoData(response.data.vdo_data || []);
    } catch (error) {
      console.error('Error loading vessels:', error);
      const errorMsg = error.response?.data?.detail || error.message || 'Unknown error';
      toast.error(`Failed to load vessels: ${errorMsg}`);
    }
  };

  const loadRecentPositions = async () => {
    console.log('loadRecentPositions: Starting to fetch vessels from API');
    try {
      // Load full vessels from active sources with geographic filter applied
      const params = buildGeoFilterParams();
      const response = await axios.get(`${API}/vessels/active?${params}`);
      const vessels = response.data.vessels || [];
      const vdoData = response.data.vdo_data || [];
      
      console.log('loadRecentPositions: Received', vessels.length, 'vessels and', vdoData.length, 'VDO positions');
      
      // Update vessels state
      setVessels(vessels);
      setVdoData(vdoData);
      
      console.log('loadRecentPositions: State updated successfully');
    } catch (error) {
      console.error('loadRecentPositions: Error loading positions:', error);
    }
  };

  const loadSources = async () => {
    try {
      const response = await axios.get(`${API}/sources`);
      const newSources = response.data.sources || [];
      setSources(newSources);
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
    console.log('WebSocket: Received position update for MMSI', posData.mmsi);
    
    setVessels(prev => {
      const updated = [...prev];
      const idx = updated.findIndex(v => v.mmsi === posData.mmsi);
      if (idx >= 0) {
        updated[idx].last_position = posData;
      } else {
        // New vessel from WebSocket - add with basic info
        updated.push({ 
          mmsi: posData.mmsi, 
          last_position: posData,
          position_count: 1,
          source_ids: [posData.source_id]
        });
      }
      console.log('WebSocket: Updated vessels array, now has', updated.length, 'vessels');
      return updated;
    });
    
    // Rate-limited refresh: max once every 3 seconds
    const now = Date.now();
    if (!updateVesselPosition.lastUpdate || (now - updateVesselPosition.lastUpdate) > 3000) {
      console.log('WebSocket: Triggering loadRecentPositions (rate-limited)');
      updateVesselPosition.lastUpdate = now;
      loadRecentPositions();
    } else {
      console.log('WebSocket: Skipping loadRecentPositions (rate-limited, last update', 
        Math.round((now - updateVesselPosition.lastUpdate) / 1000), 'seconds ago)');
    }
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

  const handleClearDatabase = async () => {
    try {
      const response = await axios.post(`${API}/database/clear`);
      toast.success(`Database cleared: ${response.data.vessels_deleted} vessels, ${response.data.positions_deleted} positions, ${response.data.messages_deleted} messages`);
      setVessels([]);
      setVdoData([]);
      setSelectedVessel(null);
      setVesselTrack([]);
      setShowClearDbDialog(false);
    } catch (error) {
      toast.error('Failed to clear database');
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploadProgress(true);
    setUploadStatus('Reading file...');
    
    // Count lines in file to estimate progress
    const text = await file.text();
    const lines = text.split('\n').filter(line => line.trim().startsWith('!') || line.trim().startsWith('$'));
    const totalLines = lines.length;
    
    setUploadStatus(`Processing ${totalLines} lines...`);
    
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post(`${API}/upload`, formData, {
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadStatus(`Uploading... ${percentCompleted}%`);
        }
      });
      
      const processed = response.data.processed || 0;
      const errors = response.data.errors || 0;
      const sourceId = response.data.source_id;
      const targetCount = response.data.target_count || 0;
      
      setUploadStatus(`Processed ${processed} messages`);
      
      if (processed > 0) {
        toast.success(`Processed ${processed} messages, ${targetCount} targets${errors > 0 ? ` (${errors} errors)` : ''}`);
        await loadVessels();
        await loadRecentPositions();
        await loadSources();
      } else {
        toast.warning('No valid AIS messages found in file');
      }
    } catch (error) {
      console.error('Upload error:', error);
      const errorMsg = error.response?.data?.detail || error.message || 'Unknown error';
      
      // Check if it's a duplicate error (409 status)
      if (error.response?.status === 409) {
        toast.error(errorMsg, { duration: 5000 });
      } else {
        toast.error(`Upload failed: ${errorMsg}`);
      }
    } finally {
      setUploadProgress(false);
      setUploadStatus('');
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
      const sourceId = response.data.source_id;
      
      toast.success(`${streamType.toUpperCase()} stream started`);
      await loadSources();
      setShowConnectionPanel(false);
    } catch (error) {
      const errorMsg = error.response?.data?.detail || error.message || 'Unknown error';
      
      // Check if it's a duplicate error (409 status)
      if (error.response?.status === 409) {
        toast.error(errorMsg, { duration: 5000 });
      } else {
        toast.error(`Failed to start stream: ${errorMsg}`);
      }
    }
  };

  const toggleSource = async (sourceId) => {
    try {
      const response = await axios.patch(`${API}/sources/${sourceId}/toggle`);
      const newStatus = response.data.status;
      
      toast.success(`Source ${newStatus}`);
      
      console.log(`🔴 Stream toggled to ${newStatus}`);
      
      // Force reload sources to trigger useEffect and restart polling
      await loadSources();
      
      // Also reload vessels after a short delay
      setTimeout(async () => {
        console.log('🔴 Toggle: Reloading vessels after toggle');
        await loadVessels();
      }, 500);
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
    // Open confirmation dialog
    setSourceToDelete(sourceId);
    setDeleteSourceData(false); // Default to not deleting data
    setShowDeleteSourceDialog(true);
  };

  const confirmDeleteSource = async () => {
    try {
      const response = await axios.delete(`${API}/sources/${sourceToDelete}?delete_data=${deleteSourceData}`);
      
      if (deleteSourceData && response.data.data_deleted) {
        toast.success(`Source removed. Deleted ${response.data.messages_deleted} messages, ${response.data.positions_deleted} positions, ${response.data.vessels_deleted} vessels`);
      } else {
        toast.success('Source removed (data preserved)');
      }
      
      await loadSources();
      await loadVessels(); // Reload vessels to reflect changes
      setShowDeleteSourceDialog(false);
      setSourceToDelete(null);
    } catch (error) {
      toast.error('Failed to remove source');
    }
  };

  const updateSpoofLimit = async (sourceId, limit) => {
    try {
      await axios.patch(`${API}/sources/${sourceId}/spoof-limit?spoof_limit_km=${limit}`);
      toast.success(`Spoof limit updated to ${limit} km`);
      await loadSources();
      setEditingSpoofLimit(null);
    } catch (error) {
      toast.error('Failed to update spoof limit');
    }
  };

  const updateMessageLimit = async (sourceId, limit) => {
    try {
      if (limit < 10) {
        toast.error('Message limit must be at least 10');
        return;
      }
      await axios.patch(`${API}/sources/${sourceId}/message-limit?message_limit=${limit}`);
      toast.success(`Message limit updated to ${limit} messages`);
      await loadSources();
      setEditingMessageLimit(null);
    } catch (error) {
      toast.error('Failed to update message limit');
    }
  };

  const updateTargetLimit = async (sourceId, limit) => {
    try {
      if (limit < 0) {
        toast.error('Target limit must be 0 (unlimited) or positive');
        return;
      }
      await axios.patch(`${API}/sources/${sourceId}/target-limit?target_limit=${limit}`);
      toast.success(`Target limit updated to ${limit === 0 ? 'unlimited' : limit + ' targets'}`);
      await loadSources();
      await loadVessels(); // Reload vessels to reflect new limit
      setEditingTargetLimit(null);
    } catch (error) {
      toast.error('Failed to update target limit');
    }
  };

  const updateKeepNonVessel = async (sourceId, keep) => {
    try {
      await axios.patch(`${API}/sources/${sourceId}/keep-non-vessel?keep_non_vessel=${keep}`);
      toast.success(`Non-vessel targets ${keep ? 'will always be visible' : 'subject to limit'}`);
      await loadSources();
      await loadVessels(); // Reload vessels to reflect new setting
    } catch (error) {
      toast.error('Failed to update keep non-vessel setting');
    }
  };

  const pauseSource = async (sourceId) => {
    try {
      await axios.post(`${API}/sources/${sourceId}/pause`);
      toast.success('Stream paused');
      await loadSources(); // Reload to trigger useEffect
    } catch (error) {
      toast.error('Failed to pause stream');
    }
  };

  const resumeSource = async (sourceId) => {
    try {
      await axios.post(`${API}/sources/${sourceId}/resume`);
      toast.success('Stream resumed');
      await loadSources(); // Reload to trigger useEffect and restart polling
    } catch (error) {
      toast.error('Failed to resume stream');
    }
  };

  const selectVessel = async (vessel) => {
    setSelectedVessel(vessel);
    setShowVesselPanel(true);
    setLoadingTrack(true);
    
    // Load vessel track (all historic positions)
    try {
      const response = await axios.get(`${API}/track/${vessel.mmsi}`);
      const trackData = response.data;
      
      if (trackData.track && trackData.track.length > 0) {
        setVesselTrack(trackData.track);
        
        toast.success(`Loaded ${trackData.count} positions for ${vessel.name || vessel.mmsi}`);
      } else {
        setVesselTrack([]);
        toast.info('No track history available');
      }
    } catch (error) {
      console.error('Error loading vessel track:', error);
      setVesselTrack([]);
      toast.error('Failed to load vessel track');
    } finally {
      setLoadingTrack(false);
    }
    
    // Load source information for this vessel
    if (vessel.source_ids && vessel.source_ids.length > 0) {
      try {
        const allSources = await axios.get(`${API}/sources`);
        const vesselSourceList = allSources.data.sources.filter(s => 
          vessel.source_ids.includes(s.source_id)
        );
        setVesselSources(vesselSourceList);
      } catch (error) {
        console.error('Error loading vessel sources:', error);
        setVesselSources([]);
      }
    } else {
      setVesselSources([]);
    }
  };
  
  // Separate function for search result clicks - centers map on vessel
  const selectVesselAndCenter = async (vessel) => {
    // First select the vessel
    await selectVessel(vessel);
    
    // Then center map on it (no zoom change)
    if (hasValidDisplayPosition(vessel.last_position)) {
      const vesselLat = getDisplayLat(vessel.last_position);
      const vesselLon = getDisplayLon(vessel.last_position);
      setMapCenter([vesselLat, vesselLon]);
    }
  };

  // Activate temporal playback mode
  const activateTemporalMode = async (vessel) => {
    if (!vessel || !vesselTrack || vesselTrack.length === 0) {
      toast.error('No track history available for temporal playback');
      return;
    }
    
    setLoadingTemporalData(true);
    toast.info('Loading temporal data for all visible vessels...');
    
    try {
      // Get time range from selected vessel's track
      const sortedTrack = [...vesselTrack].sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      const minTime = new Date(sortedTrack[0].timestamp).getTime();
      const maxTime = new Date(sortedTrack[sortedTrack.length - 1].timestamp).getTime();
      
      setSelectedVesselTimeRange({ min: minTime, max: maxTime });
      
      // Store selected vessel's track
      const tracks = {};
      tracks[vessel.mmsi] = sortedTrack;
      
      // Load tracks for all currently visible vessels
      const visibleVessels = vessels.filter(v => 
        hasValidDisplayPosition(v.last_position) && 
        v.mmsi !== vessel.mmsi &&
        !isBaseStation(v) // Don't load tracks for base stations
      );
      
      console.log(`Loading tracks for ${visibleVessels.length} visible vessels...`);
      
      // Load tracks in parallel (limit to 100 vessels for performance)
      const vesselsToLoad = visibleVessels.slice(0, 100);
      const promises = vesselsToLoad.map(v => 
        axios.get(`${API}/track/${v.mmsi}`)
          .then(response => {
            if (response.data.track && response.data.track.length > 0) {
              tracks[v.mmsi] = response.data.track.sort((a, b) => 
                new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
              );
            }
          })
          .catch(err => console.error(`Error loading track for ${v.mmsi}:`, err))
      );
      
      await Promise.all(promises);
      
      console.log(`✅ Loaded ${Object.keys(tracks).length} vessel tracks for temporal playback`);
      console.log(`Track MMSIs:`, Object.keys(tracks));
      console.log(`Current vessels count:`, vessels.length);
      console.log(`Current vessel MMSIs:`, vessels.map(v => v.mmsi).slice(0, 10));
      
      setTemporalTracks(tracks);
      setTemporalMode(true);
      setTemporalSliderValue(100); // Start at current time (rightmost)
      setTemporalTimestamp(maxTime); // Current time
      
      toast.success(`Temporal playback activated with ${Object.keys(tracks).length} vessels`);
    } catch (error) {
      console.error('Error loading temporal data:', error);
      toast.error('Failed to load temporal data');
    } finally {
      setLoadingTemporalData(false);
    }
  };
  
  // Deactivate temporal playback mode
  const deactivateTemporalMode = () => {
    setTemporalMode(false);
    setTemporalSliderValue(100);
    setTemporalTimestamp(null);
    setTemporalTracks({});
    setSelectedVesselTimeRange({ min: null, max: null });
    toast.info('Temporal playback deactivated');
  };
  
  // Handle slider value change
  const handleTemporalSliderChange = (value) => {
    setTemporalSliderValue(value);
    
    // Map slider value (0-100) to timestamp
    if (selectedVesselTimeRange.min && selectedVesselTimeRange.max) {
      const timeRange = selectedVesselTimeRange.max - selectedVesselTimeRange.min;
      const timestamp = selectedVesselTimeRange.min + (timeRange * value / 100);
      setTemporalTimestamp(timestamp);
    }
  };

  const loadAllTrails = async () => {
    if (!showAllTrails) return;
    
    try {
      const trails = {};
      // Only load trails for mobile vessels (not base stations or AtoNs)
      const mobileVessels = vessels.filter(v => !isBaseStation(v) && !isAtoN(v));
      
      // Limit to prevent performance issues - only load trails for vessels with 2+ positions
      const vesselsWithHistory = mobileVessels.filter(v => v.position_count >= 2).slice(0, 50); // Max 50 vessels
      
      console.log(`Loading trails for ${vesselsWithHistory.length} vessels...`);
      toast.info(`Loading trails for ${vesselsWithHistory.length} vessels...`);
      
      // Load trails in parallel (faster than sequential)
      const promises = vesselsWithHistory.map(vessel => 
        axios.get(`${API}/track/${vessel.mmsi}`)
          .then(response => {
            if (response.data.track && response.data.track.length > 1) {
              trails[vessel.mmsi] = response.data.track;
              console.log(`Loaded trail for ${vessel.mmsi}: ${response.data.track.length} points`);
            }
          })
          .catch(err => console.error(`Error loading trail for ${vessel.mmsi}:`, err))
      );
      
      await Promise.all(promises);
      
      console.log(`Loaded ${Object.keys(trails).length} trails successfully`);
      setVesselTrails(trails);
      toast.success(`Loaded trails for ${Object.keys(trails).length} vessels`);
    } catch (error) {
      console.error('Error loading all trails:', error);
      toast.error('Failed to load trails');
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
    if (!searchMMSI && !searchName) {
      // Clear search results if search is empty
      setSearchResults([]);
      toast.info('Search cleared');
      return;
    }
    
    try {
      const response = await axios.post(`${API}/search`, {
        mmsi: searchMMSI || undefined,
        vessel_name: searchName || undefined
      });
      
      // Set search results (don't replace vessels)
      setSearchResults(response.data.vessels || []);
      
      if (response.data.vessels.length === 0) {
        toast.info('No vessels found matching your search');
      } else {
        toast.success(`Found ${response.data.vessels.length} vessel(s)`);
        
        // Don't auto-select - let user click to select
        // User will click search result to center and select
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

  const loadSystemStatus = async () => {
    try {
      const response = await axios.get(`${API}/status`);
      setSystemStatus(response.data);
    } catch (error) {
      console.error('Error loading status:', error);
      toast.error('Failed to load system status');
    }
  };

  const exportToExcel = async () => {
    try {
      const response = await axios.get(`${API}/export/xlsx`, {
        responseType: 'blob'
      });
      
      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `ais_data_${new Date().toISOString().slice(0,10)}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      
      toast.success('Export completed!');
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export data');
    }
  };

  const isSpoofed = (vessel) => {
    if (!hasValidDisplayPosition(vessel.last_position)) return false;
    if (vdoData.length === 0) return false;
    
    const vesselLat = getDisplayLat(vessel.last_position);
    const vesselLon = getDisplayLon(vessel.last_position);
    
    // Check if vessel is beyond spoof limit from any OWN base station (VDO) in same source
    // Exclude received base stations from spoof detection
    for (const vdo of vdoData) {
      // Only check against own base stations (VDO), not received base stations
      if (!vdo.is_own) continue;
      
      // Check if vessel is from same source as VDO
      if (vessel.source_ids && vessel.source_ids.includes(vdo.source_id)) {
        const distance = calculateDistance(
          vesselLat,
          vesselLon,
          vdo.lat,
          vdo.lon
        );
        
        // If vessel is beyond the spoof limit, it's spoofed
        if (distance > vdo.spoof_limit_km) {
          return true;
        }
      }
    }
    
    return false;
  };

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const toggleFieldExpansion = (field) => {
    setExpandedFields(prev => ({
      ...prev,
      [field]: !prev[field]
    }));
  };

  // Load trails when showAllTrails is enabled or when new vessels come into view
  useEffect(() => {
    if (showAllTrails) {
      // Load trails for vessels that don't have trails yet
      const loadNewTrails = async () => {
        const mobileVessels = vessels.filter(v => !isBaseStation(v) && !isAtoN(v));
        const vesselsNeedingTrails = mobileVessels.filter(v => 
          v.position_count >= 2 && 
          !vesselTrails[v.mmsi] // Only load if we don't already have the trail
        ).slice(0, 50); // Limit to 50 new vessels at a time
        
        if (vesselsNeedingTrails.length === 0) return;
        
        console.log(`Loading trails for ${vesselsNeedingTrails.length} new vessels...`);
        
        const newTrails = { ...vesselTrails };
        const promises = vesselsNeedingTrails.map(vessel => 
          axios.get(`${API}/track/${vessel.mmsi}`)
            .then(response => {
              if (response.data.track && response.data.track.length > 1) {
                newTrails[vessel.mmsi] = response.data.track;
              }
            })
            .catch(err => console.error(`Error loading trail for ${vessel.mmsi}:`, err))
        );
        
        await Promise.all(promises);
        setVesselTrails(newTrails);
        console.log(`Loaded ${vesselsNeedingTrails.length} new trails`);
      };
      
      loadNewTrails();
    } else {
      setVesselTrails({});
    }
  }, [showAllTrails, vessels]); // Re-run when showAllTrails changes OR vessels list changes

  // Component to capture map reference
  const MapRefCapture = () => {
    const map = useMap();
    mapRef.current = map;
    return null;
  };

  return (
    <div className="App">
      <Toaster position="bottom-right" />
      
      {/* Header */}
      <header className="nautical-header">
        <div className="header-content">
          <div className="logo-section">
            <Anchor className="logo-icon" size={24} />
            <h1 className="text-lg font-semibold">CNS Systems Target Plotter</h1>
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
            
            <div className="flex items-center gap-2 px-3 py-1 bg-slate-800 rounded border border-slate-600">
              <Switch
                checked={showAllTrails}
                onCheckedChange={setShowAllTrails}
                id="show-all-trails"
              />
              <label htmlFor="show-all-trails" className="text-sm cursor-pointer">
                Show All Trails
              </label>
            </div>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSourceManager(!showSourceManager)}
              data-testid="source-manager-button"
            >
              <Database size={16} className="mr-2" />
              Sources ({sources.length})
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowGeoFilter(!showGeoFilter)}
              className={geoFilter === 'rectangle' ? 'bg-blue-900' : ''}
            >
              <MapPin size={16} className="mr-2" />
              Geo Filter
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowStatusPanel(true);
                loadSystemStatus();
              }}
              data-testid="status-button"
            >
              <Activity size={16} className="mr-2" />
              Status
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
        <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          {/* Collapse/Expand Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="sidebar-toggle-btn"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <ChevronsRight size={20} /> : <ChevronsLeft size={20} />}
          </Button>
          
          {!sidebarCollapsed && (
            <>
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

              {/* Search Results Only */}
              {searchResults.length > 0 && (
                <Card className="vessel-list-card">
                  <CardHeader>
                    <CardTitle className="text-sm">
                      <Search size={16} className="inline mr-2" />
                      Search Results ({searchResults.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="vessel-list" data-testid="search-results-list">
                      {searchResults.map((vessel) => (
                        <div
                          key={vessel.mmsi}
                          className={`vessel-item ${selectedVessel?.mmsi === vessel.mmsi ? 'selected' : ''}`}
                          onClick={() => selectVesselAndCenter(vessel)}
                          data-testid={`search-result-${vessel.mmsi}`}
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
                            {hasValidDisplayPosition(vessel.last_position) && (
                              <div className="vessel-position">
                                <MapPin size={12} />
                                {getDisplayLat(vessel.last_position)?.toFixed(4)}, {getDisplayLon(vessel.last_position)?.toFixed(4)}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </aside>

        {/* Map Container */}
        <main className="map-section">
          <div className="map-container" data-testid="map-container">
            <MapContainer
              center={mapCenter}
              zoom={mapZoom}
              style={{ height: '100%', width: '100%' }}
              zoomControl={true}
              preferCanvas={true}
            >
              <MapRefCapture />
              <MapUpdater center={mapCenter} />
              <TileLayer
                url={getMapTileUrl()}
                attribution='&copy; OpenStreetMap contributors'
              />
              
              {/* VDO/Base Station Positions with Color Coding */}
              {vdoData.map((vdo, idx) => (
                <React.Fragment key={`vdo-${idx}`}>
                  {/* Green = own base station, Orange = received base station, Asterisk = multi-source */}
                  <Marker
                    position={[vdo.lat, vdo.lon]}
                    icon={createBaseStationIcon(vdo.is_own, vdo.multi_source)}
                  >
                    <Popup>
                      <div className="vessel-popup">
                        <h3>{vdo.is_own ? 'Own Base Station (VDO)' : 'Received Base Station'}</h3>
                        <p><strong>MMSI:</strong> {vdo.mmsi}</p>
                        <p><strong>Source:</strong> {vdo.source_name}</p>
                        {vdo.multi_source && <p><strong>Verified:</strong> {vdo.source_count} sources</p>}
                        <p><strong>Spoof Limit:</strong> {vdo.spoof_limit_km} km</p>
                        <p><strong>Actual Range:</strong> {vdo.radius_km ? vdo.radius_km.toFixed(2) : 0} km</p>
                      </div>
                    </Popup>
                  </Marker>
                  
                  {/* Pink range circle - shows actual base station range (furthest valid VDM) */}
                  {vdo.radius_km > 0 && (
                    <Circle
                      center={[vdo.lat, vdo.lon]}
                      radius={vdo.radius_km * 1000}
                      pathOptions={{
                        color: '#ec4899',
                        fillColor: 'transparent',
                        fillOpacity: 0,
                        weight: 2
                      }}
                    />
                  )}
                </React.Fragment>
              ))}

              {/* Vessel Markers with Clustering (excluding base stations which are rendered via VDO data) */}
              <MarkerClusterGroup
                key={`markers-${temporalMode ? temporalTimestamp : 'current'}`}
                chunkedLoading
                maxClusterRadius={30}
                disableClusteringAtZoom={8}
                spiderfyOnMaxZoom={true}
                showCoverageOnHover={false}
                zoomToBoundsOnClick={true}
              >
                {vessels.map((vessel) => {
                  // In temporal mode, use interpolated positions
                  let position, shouldGrey = false;
                  
                  if (temporalMode && temporalTimestamp && temporalTracks[vessel.mmsi]) {
                    // Get position at temporal timestamp
                    const temporalPos = getPositionAtTime(temporalTracks[vessel.mmsi], temporalTimestamp);
                    if (!temporalPos) return null; // Vessel doesn't exist yet at this time
                    
                    position = temporalPos;
                    shouldGrey = temporalPos.atEnd; // Grey out if at last known position
                    
                    // Debug: Log temporal position usage
                    if (vessel.mmsi === selectedVessel?.mmsi) {
                      console.log(`[Temporal] Selected vessel ${vessel.mmsi} at`, temporalPos);
                    }
                  } else if (temporalMode && temporalTimestamp) {
                    // Vessel has no temporal track data - grey it out if it's in view
                    if (!hasValidDisplayPosition(vessel.last_position)) return null;
                    position = vessel.last_position;
                    shouldGrey = true; // No temporal data available
                    
                    // Debug: Log missing temporal data
                    console.log(`[Temporal] Vessel ${vessel.mmsi} has no temporal data - using current position`);
                  } else {
                    // Normal mode - use current position
                    if (!hasValidDisplayPosition(vessel.last_position)) return null;
                    position = vessel.last_position;
                  }
                  
                  const isBase = isBaseStation(vessel);
                  const isAton = isAtoN(vessel);
                  const isSAR = isSARTarget(vessel);
                  const posCount = getPositionCount(vessel);
                  const spoofed = shouldGrey || isSpoofed(vessel); // Force greyed if no temporal data
                  const vesselLat = position.display_lat || position.lat;
                  const vesselLon = position.display_lon || position.lon;
                  
                  // Skip base stations as they're rendered separately via VDO data
                  if (isBase) return null;
                  
                  // Determine icon based on target type and available data
                  let icon;
                  if (isAton) {
                    icon = createAtoNIcon();
                  } else if (isSAR) {
                    // SAR aircraft - use airplane icon with best direction
                    const direction = getBestDirection(position);
                    icon = createSARIcon(direction, posCount, spoofed);
                  } else {
                    // Regular vessel - check if we have direction data
                    const direction = getBestDirection(position);
                    if (direction !== null) {
                      // Has valid heading or course - use triangle
                      icon = createTriangleIcon(direction, posCount, spoofed);
                    } else {
                      // No direction data - use simple circle
                      icon = createCircleIcon(posCount, spoofed);
                    }
                  }
                  
                  return (
                    <Marker
                      key={vessel.mmsi}
                      position={[vesselLat, vesselLon]}
                      icon={icon}
                      eventHandlers={{
                        click: () => selectVessel(vessel)
                      }}
                    />
                  );
                })}
              </MarkerClusterGroup>
              
              {/* All Vessel Trails (when enabled and NOT in temporal mode) - Light Blue Trails */}
              {!temporalMode && showAllTrails && Object.entries(vesselTrails).map(([mmsi, trail]) => (
                <Polyline
                  key={`trail-${mmsi}`}
                  positions={trail
                    .filter(p => hasValidDisplayPosition(p))
                    .map(p => [getDisplayLat(p), getDisplayLon(p)])}
                  color="#60a5fa"
                  weight={2}
                  opacity={0.6}
                />
              ))}

              {/* Selected Vessel Track - Dark Blue Trail (chronologically ordered) */}
              {selectedVessel && vesselTrack.length >= 1 && (temporalMode || !showAllTrails || showAllTrails) && (
                <Polyline
                  positions={vesselTrack
                    .filter(p => hasValidDisplayPosition(p))
                    .map(p => [getDisplayLat(p), getDisplayLon(p)])}
                  color="#1e40af"
                  weight={3}
                  opacity={0.9}
                />
              )}
            </MapContainer>
          </div>
        </main>

        {/* Floating Vessel Info Panel */}
        {showVesselPanel && selectedVessel && (
          <div className="vessel-info-panel">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle className="text-lg">
                    {selectedVessel.name || `MMSI: ${selectedVessel.mmsi}`}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowVesselPanel(false);
                      setSelectedVessel(null);
                      setVesselTrack([]);
                      // Deactivate temporal mode when closing panel
                      if (temporalMode) {
                        deactivateTemporalMode();
                      }
                    }}
                  >
                    <X size={16} />
                  </Button>
                </div>
              </CardHeader>
              
              {/* Temporal Playback Slider */}
              {vesselTrack && vesselTrack.length > 1 && (
                <div className="px-6 py-3 border-t border-b bg-slate-50">
                  {!temporalMode ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => activateTemporalMode(selectedVessel)}
                      disabled={loadingTemporalData}
                      className="w-full"
                    >
                      <Clock size={16} className="mr-2" />
                      {loadingTemporalData ? 'Loading Temporal Data...' : 'Enable Time Slider'}
                    </Button>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-semibold text-slate-700">Time Slider</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={deactivateTemporalMode}
                          className="h-6 px-2 text-xs"
                        >
                          Reset to Current
                        </Button>
                      </div>
                      
                      {/* Timestamp Display */}
                      <div className="text-xs text-center text-slate-600 font-mono">
                        {temporalTimestamp ? new Date(temporalTimestamp).toISOString().replace('T', ' ').substring(0, 19) : ''}
                      </div>
                      
                      {/* Slider with position markers */}
                      <div className="relative">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="0.1"
                          value={temporalSliderValue}
                          onChange={(e) => handleTemporalSliderChange(parseFloat(e.target.value))}
                          className="w-full h-2 bg-slate-300 rounded-lg appearance-none cursor-pointer slider-thumb"
                        />
                        
                        {/* Position markers (dots) for actual data points */}
                        {vesselTrack && vesselTrack.length > 0 && selectedVesselTimeRange.min && selectedVesselTimeRange.max && (
                          <div className="absolute top-0 left-0 w-full h-2 pointer-events-none">
                            {vesselTrack.map((pos, idx) => {
                              const posTime = new Date(pos.timestamp).getTime();
                              const timeRange = selectedVesselTimeRange.max - selectedVesselTimeRange.min;
                              const percent = ((posTime - selectedVesselTimeRange.min) / timeRange) * 100;
                              
                              return (
                                <div
                                  key={idx}
                                  className="absolute w-1 h-1 bg-blue-600 rounded-full"
                                  style={{ left: `${percent}%`, top: '2px' }}
                                  title={new Date(pos.timestamp).toISOString()}
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>
                      
                      {/* Time range labels */}
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>
                          {selectedVesselTimeRange.min ? new Date(selectedVesselTimeRange.min).toISOString().substring(11, 19) : ''}
                        </span>
                        <span>
                          {selectedVesselTimeRange.max ? new Date(selectedVesselTimeRange.max).toISOString().substring(11, 19) : ''}
                        </span>
                      </div>
                      
                      <div className="text-xs text-center text-slate-500">
                        Showing {Object.keys(temporalTracks).length} vessels at selected time
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              <CardContent>
                <ScrollArea className="h-96">
                  <div className="space-y-3 text-sm">
                    <div className="info-row">
                      <span className="info-label">MMSI:</span>
                      <span className="info-value">{selectedVessel.mmsi}</span>
                    </div>
                    
                    {selectedVessel.country && (
                      <div className="info-row">
                        <span className="info-label">Country:</span>
                        <span className="info-value">{selectedVessel.country}</span>
                      </div>
                    )}
                    
                    {selectedVessel.callsign && (
                      <div className="info-row">
                        <span className="info-label">Callsign:</span>
                        <span className="info-value">{selectedVessel.callsign}</span>
                      </div>
                    )}
                    
                    {selectedVessel.ship_type_text && (
                      <div className="info-row">
                        <span className="info-label">Ship Type:</span>
                        <span className="info-value">{selectedVessel.ship_type_text}</span>
                      </div>
                    )}
                    
                    {selectedVessel.imo && (
                      <div className="info-row">
                        <span className="info-label">IMO:</span>
                        <span className="info-value">{selectedVessel.imo}</span>
                      </div>
                    )}
                    
                    {(() => {
                      // Determine which position to display (temporal or current)
                      let displayPosition = selectedVessel.last_position;
                      let isTemporalPosition = false;
                      
                      if (temporalMode && temporalTimestamp && temporalTracks[selectedVessel.mmsi]) {
                        const temporalPos = getPositionAtTime(temporalTracks[selectedVessel.mmsi], temporalTimestamp);
                        if (temporalPos) {
                          displayPosition = temporalPos;
                          isTemporalPosition = true;
                        }
                      }
                      
                      if (!hasValidDisplayPosition(displayPosition) && !(displayPosition?.lat && displayPosition?.lon)) {
                        return null;
                      }
                      
                      return (
                        <>
                          <div className="info-section-title">
                            {isTemporalPosition ? 'Historical Position' : 'Current Position'}
                            {isTemporalPosition && displayPosition.interpolated && (
                              <span className="text-xs text-blue-500 ml-2">(Interpolated)</span>
                            )}
                          </div>
                          <div className="info-row">
                            <span className="info-label">Latitude:</span>
                            <span className="info-value">
                              {(displayPosition.display_lat || displayPosition.lat)?.toFixed(6)}
                            </span>
                          </div>
                          <div className="info-row">
                            <span className="info-label">Longitude:</span>
                            <span className="info-value">
                              {(displayPosition.display_lon || displayPosition.lon)?.toFixed(6)}
                            </span>
                          </div>
                          {displayPosition.position_valid === false && (
                            <div className="info-row">
                              <span className="info-label">Position Status:</span>
                              <span className="info-value text-yellow-500">Using last known valid position</span>
                            </div>
                          )}
                          {displayPosition.speed !== null && displayPosition.speed !== undefined && (
                            <div className="info-row">
                              <span className="info-label">Speed:</span>
                              <span className="info-value">
                                {typeof displayPosition.speed === 'number' ? displayPosition.speed.toFixed(1) : displayPosition.speed} knots
                              </span>
                            </div>
                          )}
                          {displayPosition.course !== null && displayPosition.course !== undefined && (
                            <div className="info-row">
                              <span className="info-label">Course:</span>
                              <span className="info-value">
                                {typeof displayPosition.course === 'number' ? displayPosition.course.toFixed(1) : displayPosition.course}\u00b0
                              </span>
                            </div>
                          )}
                          {displayPosition.heading !== null && displayPosition.heading !== undefined && (
                            <div className="info-row">
                              <span className="info-label">Heading:</span>
                              <span className="info-value">
                                {isValidHeading(displayPosition.heading) 
                                  ? `${displayPosition.heading}\u00b0` 
                                  : 'N/A'}
                              </span>
                            </div>
                          )}
                          {isTemporalPosition && displayPosition.timestamp && (
                            <div className="info-row">
                              <span className="info-label">Timestamp:</span>
                              <span className="info-value text-xs">
                                {new Date(displayPosition.timestamp).toISOString().replace('T', ' ').substring(0, 19)}
                              </span>
                            </div>
                          )}
                        </>
                      );
                    })()}
                    
                    {selectedVessel.destination && (
                      <div className="info-row">
                        <span className="info-label">Destination:</span>
                        <span className="info-value">{selectedVessel.destination}</span>
                      </div>
                    )}
                    
                    {selectedVessel.eta && (
                      <div className="info-row">
                        <span className="info-label">ETA:</span>
                        <span className="info-value">{selectedVessel.eta}</span>
                      </div>
                    )}
                    
                    {vesselTrack.length > 0 && (
                      <div className="info-row">
                        <span className="info-label">Track Points:</span>
                        <span className="info-value">{vesselTrack.length}</span>
                      </div>
                    )}
                    
                    {isBaseStation(selectedVessel) && (
                      <div className="info-row">
                        <span className="info-label">Station Type:</span>
                        <span className="info-value badge-blue">Base Station</span>
                      </div>
                    )}
                    
                    {isSpoofed(selectedVessel) && (
                      <div className="info-row">
                        <span className="info-label">Warning:</span>
                        <span className="info-value badge-warning">⚠️ Possible Spoof</span>
                      </div>
                    )}
                    
                    {vesselSources.length > 0 && (
                      <>
                        <div className="info-section-title">
                          Data Sources {vesselSources.length > 1 && `(${vesselSources.length})`}
                        </div>
                        {vesselSources.length > 1 && (
                          <div className="info-note">
                            ℹ️ Data merged from multiple sources in chronological order
                          </div>
                        )}
                        {vesselSources.map((source, idx) => (
                          <div key={idx} className="info-row">
                            <span className="info-label">{source.source_type.toUpperCase()}:</span>
                            <span className="info-value">{source.name}</span>
                          </div>
                        ))}
                      </>
                    )}
                    
                    <Button 
                      className="w-full mt-4"
                      onClick={() => loadVesselHistory(selectedVessel.mmsi)}
                    >
                      <Database size={16} className="mr-2" />
                      View Full History
                    </Button>
                    
                    <Button 
                      className="w-full mt-2"
                      variant="outline"
                      onClick={() => window.open(`https://www.vesselfinder.com/vessels/details/${selectedVessel.mmsi}`, '_blank')}
                    >
                      <Ship size={16} className="mr-2" />
                      Search MMSI on VesselFinder
                    </Button>
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        )}

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

        {/* Geographic Filter Panel */}
        {showGeoFilter && (
          <div className="geo-filter-panel">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>Geographic Filter</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowGeoFilter(false)}
                  >
                    <X size={16} />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Filter Mode:</label>
                    <select
                      value={geoFilter}
                      onChange={(e) => setGeoFilter(e.target.value)}
                      className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white"
                    >
                      <option value="viewport">Current Viewport Only</option>
                      <option value="rectangle">Custom Rectangle</option>
                    </select>
                  </div>

                  {geoFilter === 'viewport' && (
                    <div className="bg-blue-900/30 border border-blue-700 rounded p-3">
                      <p className="text-sm text-blue-200">
                        ✓ Only targets within the current map view will be displayed.
                        Pan and zoom the map to adjust the filter area.
                      </p>
                    </div>
                  )}

                  {geoFilter === 'rectangle' && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs mb-1">Min Latitude:</label>
                          <Input
                            type="text"
                            value={geoRectangle.minLat}
                            onChange={(e) => {
                              // Accept comma or dot as decimal separator
                              const val = e.target.value.replace(',', '.');
                              setGeoRectangle({...geoRectangle, minLat: val});
                            }}
                            placeholder="-90.0000 (optional)"
                            className="bg-slate-700 border-slate-600"
                          />
                        </div>
                        <div>
                          <label className="block text-xs mb-1">Max Latitude:</label>
                          <Input
                            type="text"
                            value={geoRectangle.maxLat}
                            onChange={(e) => {
                              const val = e.target.value.replace(',', '.');
                              setGeoRectangle({...geoRectangle, maxLat: val});
                            }}
                            placeholder="90.0000 (optional)"
                            className="bg-slate-700 border-slate-600"
                          />
                        </div>
                        <div>
                          <label className="block text-xs mb-1">Min Longitude:</label>
                          <Input
                            type="text"
                            value={geoRectangle.minLon}
                            onChange={(e) => {
                              const val = e.target.value.replace(',', '.');
                              setGeoRectangle({...geoRectangle, minLon: val});
                            }}
                            placeholder="-180.0000 (optional)"
                            className="bg-slate-700 border-slate-600"
                          />
                        </div>
                        <div>
                          <label className="block text-xs mb-1">Max Longitude:</label>
                          <Input
                            type="text"
                            value={geoRectangle.maxLon}
                            onChange={(e) => {
                              const val = e.target.value.replace(',', '.');
                              setGeoRectangle({...geoRectangle, maxLon: val});
                            }}
                            placeholder="180.0000 (optional)"
                            className="bg-slate-700 border-slate-600"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <Button
                    className="w-full"
                    onClick={() => {
                      loadVessels();
                      toast.success('Geographic filter applied');
                    }}
                  >
                    Apply Filter
                  </Button>
                </div>
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
                    onClick={() => setShowClearDbDialog(true)}
                  >
                    <Database size={16} className="mr-2" />
                    Clear Database
                  </Button>
                </div>
                <ScrollArea className="h-96">
                  {sources.length === 0 ? (
                    <p className="text-center text-gray-400 py-4">No data sources</p>
                  ) : (
                    <div className="space-y-2 pr-2">
                      {sources.map(source => (
                        <div key={source.source_id} className="source-item-expanded">
                          <div className="source-main">
                            <div className="source-info">
                              <div className="source-name">{source.name}</div>
                              <div className="source-meta">
                                <span className="source-type">{source.source_type.toUpperCase()}</span>
                                <span className="source-count">{source.message_count || 0} msgs</span>
                                <span className="source-count">{source.target_count || 0} targets</span>
                                {source.fragment_count > 0 && (
                                  <span className="source-fragments">{source.fragment_count} fragments</span>
                                )}
                              </div>
                            </div>
                            <div className="source-controls">
                              {/* Pause/Resume for streaming sources */}
                              {['tcp', 'udp', 'serial'].includes(source.source_type) && source.status === 'active' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => source.is_paused ? resumeSource(source.source_id) : pauseSource(source.source_id)}
                                  title={source.is_paused ? "Resume" : "Pause"}
                                >
                                  {source.is_paused ? <Play size={16} /> : <Pause size={16} />}
                                </Button>
                              )}
                              
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
                          
                          {/* Message Limit Configuration (for streaming sources) */}
                          {['tcp', 'udp', 'serial'].includes(source.source_type) && (
                            <div className="spoof-limit-section">
                              <label className="spoof-label">Message Limit:</label>
                              {editingMessageLimit === source.source_id ? (
                                <div className="spoof-edit">
                                  <Input
                                    type="number"
                                    defaultValue={source.message_limit || 500}
                                    onKeyPress={(e) => {
                                      if (e.key === 'Enter') {
                                        updateMessageLimit(source.source_id, parseInt(e.target.value));
                                      }
                                    }}
                                    className="spoof-input"
                                  />
                                  <Button size="sm" onClick={() => setEditingMessageLimit(null)}>
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <div className="spoof-display">
                                  <span className="spoof-value">{source.message_limit || 500} messages</span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setEditingMessageLimit(source.source_id)}
                                  >
                                    <Settings size={14} />
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}
                          
                          {/* Target Limit Configuration */}
                          <div className="spoof-limit-section">
                            <label className="spoof-label">Target Limit:</label>
                            {editingTargetLimit === source.source_id ? (
                              <div className="spoof-edit">
                                <Input
                                  type="number"
                                  min="0"
                                  defaultValue={source.target_limit || 0}
                                  onKeyPress={(e) => {
                                    if (e.key === 'Enter') {
                                      updateTargetLimit(source.source_id, parseInt(e.target.value));
                                    }
                                  }}
                                  className="spoof-input"
                                />
                                <Button size="sm" onClick={() => setEditingTargetLimit(null)}>
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <div className="spoof-display">
                                <span className="spoof-value">{source.target_limit === 0 ? 'Unlimited' : `${source.target_limit} targets`}</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditingTargetLimit(source.source_id)}
                                >
                                  <Settings size={14} />
                                </Button>
                              </div>
                            )}
                          </div>
                          
                          {/* Keep Non-Vessel Targets Toggle */}
                          {source.target_limit > 0 && (
                            <div className="spoof-limit-section">
                              <label className="spoof-label">Keep Base Stations & AtoNs:</label>
                              <div className="spoof-display">
                                <Switch
                                  checked={source.keep_non_vessel_targets !== false}
                                  onCheckedChange={(checked) => updateKeepNonVessel(source.source_id, checked)}
                                />
                                <span className="spoof-value text-xs ml-2">
                                  {source.keep_non_vessel_targets !== false ? 'Always visible' : 'Subject to limit'}
                                </span>
                              </div>
                            </div>
                          )}
                          
                          {/* Spoof Limit Configuration */}
                          <div className="spoof-limit-section">
                            <label className="spoof-label">Spoof Limit (km):</label>
                            {editingSpoofLimit === source.source_id ? (
                              <div className="spoof-edit">
                                <Input
                                  type="number"
                                  defaultValue={source.spoof_limit_km || 500}
                                  onKeyPress={(e) => {
                                    if (e.key === 'Enter') {
                                      updateSpoofLimit(source.source_id, parseFloat(e.target.value));
                                    }
                                  }}
                                  className="spoof-input"
                                />
                                <Button size="sm" onClick={() => setEditingSpoofLimit(null)}>
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <div className="spoof-display">
                                <span className="spoof-value">{source.spoof_limit_km || 500} km</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditingSpoofLimit(source.source_id)}
                                >
                                  <Settings size={14} />
                                </Button>
                              </div>
                            )}
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
                            <p>
                              <strong>Pos:</strong> {getDisplayLat(pos)?.toFixed(6)}, {getDisplayLon(pos)?.toFixed(6)}
                              {pos.position_valid === false && <span className="text-yellow-500 ml-1">(using last valid)</span>}
                            </p>
                            <p><strong>Speed:</strong> {pos.speed} kts, <strong>Course:</strong> {pos.course}°</p>
                            <p><strong>Heading:</strong> {pos.heading}°, <strong>Nav Status:</strong> {pos.nav_status}</p>
                            <p><strong>Repeat Indicator:</strong> {pos.repeat_indicator ?? 'N/A'}</p>
                            <p><strong>VDO:</strong> {pos.is_vdo ? 'Yes' : 'No'}, <strong>Source:</strong> {pos.source_id?.substring(0, 8)}...</p>
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

      {/* Clear Database Confirmation Dialog */}
      <Dialog open={showClearDbDialog} onOpenChange={setShowClearDbDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear Database?</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-gray-600">
              This will remove all vessels, positions, and messages from the database.
              <br />
              <strong>Sources will be kept.</strong>
            </p>
            <p className="text-sm text-red-600 mt-2">
              This action cannot be undone.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setShowClearDbDialog(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearDatabase}
            >
              Clear Database
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Source Confirmation Dialog */}
      <Dialog open={showDeleteSourceDialog} onOpenChange={setShowDeleteSourceDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Source?</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-gray-600 mb-4">
              Do you want to delete the associated data (vessels, positions, messages) from this source?
            </p>
            
            <div className="flex items-center gap-2 p-3 bg-slate-100 rounded">
              <input
                type="checkbox"
                id="deleteData"
                checked={deleteSourceData}
                onChange={(e) => setDeleteSourceData(e.target.checked)}
                className="w-4 h-4"
              />
              <label htmlFor="deleteData" className="text-sm cursor-pointer">
                Also delete all data from this source (vessels, positions, messages)
              </label>
            </div>
            
            <p className="text-sm text-gray-500 mt-3">
              {deleteSourceData 
                ? '⚠️ This will permanently delete all data received from this source.' 
                : 'ℹ️ Source will be removed but data will be kept in the database.'}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowDeleteSourceDialog(false);
                setSourceToDelete(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDeleteSource}
            >
              Delete Source
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload Progress Indicator - Bottom Right */}
      {uploadProgress && (
        <div className="fixed bottom-4 right-4 z-50">
          <Card className="w-80 bg-slate-800 border-slate-700">
            <CardContent className="pt-6">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Upload className="animate-pulse text-blue-400" size={20} />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">File Upload</p>
                    <p className="text-xs text-slate-400">{uploadStatus}</p>
                  </div>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-2">
                  <div className="bg-blue-500 h-2 rounded-full animate-pulse" style={{ width: '100%' }}></div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* System Status Panel */}
      <Dialog open={showStatusPanel} onOpenChange={setShowStatusPanel}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>System Status & Statistics</DialogTitle>
          </DialogHeader>
          {systemStatus && (
            <div className="space-y-4">
              {/* Overall Stats */}
              <div className="grid grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-2xl font-bold text-blue-600">{systemStatus.vessels}</div>
                    <div className="text-sm text-gray-600">Vessels</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-2xl font-bold text-green-600">{systemStatus.messages}</div>
                    <div className="text-sm text-gray-600">Messages</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-2xl font-bold text-orange-600">{systemStatus.positions}</div>
                    <div className="text-sm text-gray-600">Positions</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-2xl font-bold text-purple-600">{systemStatus.sources}</div>
                    <div className="text-sm text-gray-600">Sources</div>
                  </CardContent>
                </Card>
              </div>

              {/* Source Statistics */}
              <Card>
                <CardHeader>
                  <h3 className="text-lg font-semibold">Source Statistics</h3>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {systemStatus.source_stats.map((source, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded">
                        <div>
                          <div className="font-medium">{source.name}</div>
                          <div className="text-sm text-gray-600">
                            {source.type.toUpperCase()} • {source.status}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm">
                            <span className="font-medium">{source.message_count}</span> msgs • 
                            <span className="font-medium ml-1">{source.target_count}</span> targets
                            {source.fragment_count > 0 && (
                              <span className="text-orange-600 ml-1">• {source.fragment_count} fragments</span>
                            )}
                          </div>
                          {source.messages_per_second !== undefined && (
                            <div className="text-xs text-green-600 font-medium">
                              {source.messages_per_second} msg/sec
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Actions */}
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={loadSystemStatus}
                >
                  Refresh
                </Button>
                <Button
                  onClick={exportToExcel}
                >
                  <Download size={16} className="mr-2" />
                  Export to Excel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default App;
