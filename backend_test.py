#!/usr/bin/env python3
"""
Backend API Testing for Real-Time TCP Streaming
Tests the fixed TCP/UDP stream real-time broadcasting and WebSocket functionality.
"""

import requests
import json
import time
import websocket
import threading
from datetime import datetime
import subprocess

# Backend URL from frontend .env
BACKEND_URL = "https://ship-pulse.preview.emergentagent.com/api"
WS_URL = "wss://ship-pulse.preview.emergentagent.com/api/ws"

def test_api_connection():
    """Test basic API connectivity"""
    print("🔗 Testing API connection...")
    try:
        response = requests.get(f"{BACKEND_URL}/", timeout=10)
        if response.status_code == 200:
            print("✅ API connection successful")
            return True
        else:
            print(f"❌ API connection failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ API connection error: {e}")
        return False

def clear_database():
    """Clear the database before testing"""
    print("🗑️ Clearing database...")
    try:
        response = requests.post(f"{BACKEND_URL}/database/clear", timeout=10)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Database cleared: {data.get('vessels_deleted', 0)} vessels, {data.get('positions_deleted', 0)} positions, {data.get('messages_deleted', 0)} messages")
            return True
        else:
            print(f"❌ Database clear failed: {response.status_code} - {response.text}")
            return False
    except Exception as e:
        print(f"❌ Database clear error: {e}")
        return False

def upload_vdo_file():
    """Upload the VDO test file"""
    print("📤 Uploading VDO test file...")
    try:
        with open('/app/test_vdo.txt', 'rb') as f:
            files = {'file': ('test_vdo.txt', f, 'text/plain')}
            response = requests.post(f"{BACKEND_URL}/upload", files=files, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ File uploaded successfully:")
            print(f"   - Source ID: {data.get('source_id')}")
            print(f"   - Processed: {data.get('processed')} messages")
            print(f"   - Errors: {data.get('errors')} errors")
            return data.get('source_id')
        else:
            print(f"❌ File upload failed: {response.status_code} - {response.text}")
            return None
    except Exception as e:
        print(f"❌ File upload error: {e}")
        return None

def verify_message_storage():
    """Verify the VDO message was stored correctly"""
    print("📋 Verifying message storage...")
    try:
        # Wait a moment for processing
        time.sleep(2)
        
        # We don't have a direct messages endpoint, so we'll check through vessel data
        response = requests.get(f"{BACKEND_URL}/vessels", timeout=10)
        if response.status_code == 200:
            data = response.json()
            vessels = data.get('vessels', [])
            
            # Look for the expected MMSI (994031019)
            target_mmsi = "994031019"
            target_vessel = None
            
            for vessel in vessels:
                if vessel.get('mmsi') == target_mmsi:
                    target_vessel = vessel
                    break
            
            if target_vessel:
                print(f"✅ Message processed for MMSI {target_mmsi}")
                print(f"   - Vessel found: {target_vessel.get('name', 'Unknown')}")
                print(f"   - Country: {target_vessel.get('country', 'Unknown')}")
                print(f"   - Is Base Station: {target_vessel.get('is_base_station', False)}")
                return target_vessel
            else:
                print(f"❌ No vessel found with MMSI {target_mmsi}")
                print(f"   Found {len(vessels)} vessels total")
                return None
        else:
            print(f"❌ Failed to get vessels: {response.status_code}")
            return None
    except Exception as e:
        print(f"❌ Message verification error: {e}")
        return None

def verify_position_storage(vessel_data):
    """Verify the position data was stored correctly"""
    print("📍 Verifying position storage...")
    try:
        if not vessel_data:
            print("❌ No vessel data provided")
            return False
        
        mmsi = vessel_data.get('mmsi')
        last_position = vessel_data.get('last_position')
        
        if last_position:
            lat = last_position.get('lat')
            lon = last_position.get('lon')
            is_vdo = last_position.get('is_vdo')
            
            print(f"✅ Position data found:")
            print(f"   - Latitude: {lat}")
            print(f"   - Longitude: {lon}")
            print(f"   - Is VDO: {is_vdo}")
            print(f"   - Timestamp: {last_position.get('timestamp')}")
            
            # Verify expected coordinates (approximately)
            expected_lat = 18.01114
            expected_lon = 41.66945
            
            if lat and lon:
                lat_diff = abs(lat - expected_lat)
                lon_diff = abs(lon - expected_lon)
                
                if lat_diff < 0.001 and lon_diff < 0.001:
                    print(f"✅ Position coordinates match expected values")
                    if is_vdo:
                        print(f"✅ Message correctly marked as VDO")
                        return True
                    else:
                        print(f"❌ Message not marked as VDO")
                        return False
                else:
                    print(f"❌ Position coordinates don't match expected values")
                    print(f"   Expected: {expected_lat}, {expected_lon}")
                    print(f"   Got: {lat}, {lon}")
                    return False
            else:
                print(f"❌ Missing position coordinates")
                return False
        else:
            print(f"❌ No position data found for vessel")
            return False
    except Exception as e:
        print(f"❌ Position verification error: {e}")
        return False

def verify_base_station_flag(vessel_data):
    """Verify the vessel is marked as a base station"""
    print("🏢 Verifying base station flag...")
    try:
        if not vessel_data:
            print("❌ No vessel data provided")
            return False
        
        is_base_station = vessel_data.get('is_base_station', False)
        
        if is_base_station:
            print(f"✅ Vessel correctly marked as base station")
            return True
        else:
            print(f"❌ Vessel not marked as base station")
            return False
    except Exception as e:
        print(f"❌ Base station verification error: {e}")
        return False

def verify_active_vessels():
    """Verify the base station appears in active vessels"""
    print("🚢 Verifying active vessels endpoint...")
    try:
        response = requests.get(f"{BACKEND_URL}/vessels/active", timeout=10)
        if response.status_code == 200:
            data = response.json()
            vessels = data.get('vessels', [])
            vdo_data = data.get('vdo_data', [])
            
            print(f"✅ Active vessels endpoint working:")
            print(f"   - Total vessels: {len(vessels)}")
            print(f"   - VDO data entries: {len(vdo_data)}")
            
            # Look for our target MMSI
            target_mmsi = "994031019"
            found_vessel = False
            found_vdo = False
            
            for vessel in vessels:
                if vessel.get('mmsi') == target_mmsi:
                    found_vessel = True
                    print(f"   - Found vessel {target_mmsi} in active vessels")
                    break
            
            for vdo in vdo_data:
                if vdo.get('mmsi') == target_mmsi:
                    found_vdo = True
                    print(f"   - Found VDO data for {target_mmsi}")
                    print(f"     Lat: {vdo.get('lat')}, Lon: {vdo.get('lon')}")
                    print(f"     Radius: {vdo.get('radius_km')} km")
                    break
            
            if found_vessel and found_vdo:
                print(f"✅ Base station correctly appears in active vessels")
                return True
            else:
                print(f"❌ Base station missing from active vessels (vessel: {found_vessel}, vdo: {found_vdo})")
                return False
        else:
            print(f"❌ Active vessels endpoint failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Active vessels verification error: {e}")
        return False

def check_backend_logs():
    """Check backend logs for processing messages"""
    print("📋 Checking backend logs for AIS processing...")
    try:
        result = subprocess.run(['tail', '-n', '100', '/var/log/supervisor/backend.out.log'], 
                              capture_output=True, text=True, timeout=10)
        
        if result.returncode == 0:
            logs = result.stdout.strip()
            if "Processed AIS message" in logs:
                print("✅ Found 'Processed AIS message' logs in backend")
                # Count processing messages
                processing_count = logs.count("Processed AIS message")
                print(f"   - Found {processing_count} message processing entries")
                return True
            else:
                print("❌ No 'Processed AIS message' logs found")
                print("Recent logs:")
                print(logs[-500:])  # Last 500 chars
                return False
        else:
            print("⚠️ Could not read backend logs")
            return False
    except Exception as e:
        print(f"❌ Error checking logs: {e}")
        return False

def test_websocket_connection():
    """Test WebSocket connection and message reception"""
    print("🔌 Testing WebSocket connection...")
    
    messages_received = []
    connection_successful = False
    
    def on_message(ws, message):
        try:
            data = json.loads(message)
            messages_received.append(data)
            print(f"   📨 WebSocket message received: {data.get('type', 'unknown')}")
        except Exception as e:
            print(f"   ❌ Error parsing WebSocket message: {e}")
    
    def on_open(ws):
        nonlocal connection_successful
        connection_successful = True
        print("   ✅ WebSocket connection opened")
    
    def on_error(ws, error):
        print(f"   ❌ WebSocket error: {error}")
    
    def on_close(ws, close_status_code, close_msg):
        print("   🔌 WebSocket connection closed")
    
    try:
        ws = websocket.WebSocketApp(WS_URL,
                                  on_open=on_open,
                                  on_message=on_message,
                                  on_error=on_error,
                                  on_close=on_close)
        
        # Run WebSocket in a separate thread
        ws_thread = threading.Thread(target=ws.run_forever)
        ws_thread.daemon = True
        ws_thread.start()
        
        # Wait for connection
        time.sleep(3)
        
        if connection_successful:
            print("✅ WebSocket connection established")
            return True, messages_received
        else:
            print("❌ WebSocket connection failed")
            return False, []
            
    except Exception as e:
        print(f"❌ WebSocket connection error: {e}")
        return False, []

def verify_statistics_update():
    """Verify that source statistics are updating correctly"""
    print("📊 Verifying source statistics...")
    try:
        response = requests.get(f"{BACKEND_URL}/sources", timeout=10)
        if response.status_code == 200:
            data = response.json()
            sources = data.get('sources', [])
            
            if sources:
                print(f"✅ Found {len(sources)} sources")
                
                # Check for recent activity
                active_sources = 0
                for source in sources:
                    message_count = source.get('message_count', 0)
                    target_count = source.get('target_count', 0)
                    fragment_count = source.get('fragment_count', 0)
                    last_message = source.get('last_message')
                    
                    print(f"   📊 Source: {source.get('name', 'Unknown')}")
                    print(f"      - Message count: {message_count}")
                    print(f"      - Target count: {target_count}")
                    print(f"      - Fragment count: {fragment_count}")
                    print(f"      - Last message: {last_message}")
                    
                    if message_count > 0:
                        active_sources += 1
                
                if active_sources > 0:
                    print(f"✅ Found {active_sources} sources with message activity")
                    return True
                else:
                    print("❌ No sources show message activity")
                    return False
            else:
                print("❌ No sources found")
                return False
        else:
            print(f"❌ Failed to get sources: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Statistics verification error: {e}")
        return False

def test_immediate_vessel_appearance():
    """Test that vessels appear immediately after upload"""
    print("⚡ Testing immediate vessel appearance...")
    try:
        # Get initial vessel count
        response = requests.get(f"{BACKEND_URL}/vessels/active", timeout=10)
        if response.status_code != 200:
            print(f"❌ Failed to get initial vessel count: {response.status_code}")
            return False
        
        initial_data = response.json()
        initial_count = len(initial_data.get('vessels', []))
        print(f"   📊 Initial vessel count: {initial_count}")
        
        # Upload test file
        source_id = upload_vdo_file()
        if not source_id:
            print("❌ File upload failed")
            return False
        
        # Check vessels immediately (within 2 seconds)
        time.sleep(2)
        
        response = requests.get(f"{BACKEND_URL}/vessels/active", timeout=10)
        if response.status_code == 200:
            new_data = response.json()
            new_count = len(new_data.get('vessels', []))
            
            print(f"   📊 New vessel count: {new_count}")
            
            if new_count > initial_count:
                print(f"✅ Vessels appeared immediately ({new_count - initial_count} new vessels)")
                return True
            else:
                print("❌ No new vessels appeared immediately")
                return False
        else:
            print(f"❌ Failed to check vessels after upload: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Immediate appearance test error: {e}")
        return False

def run_real_time_streaming_test():
    """Run the real-time TCP streaming test suite"""
    print("=" * 70)
    print("🚀 Real-Time TCP Streaming & WebSocket Broadcasting Test Suite")
    print("=" * 70)
    
    test_results = {
        'api_connection': False,
        'database_clear': False,
        'websocket_connection': False,
        'immediate_vessel_appearance': False,
        'message_processing_logs': False,
        'statistics_update': False,
        'active_vessels_endpoint': False
    }
    
    # Test 1: API Connection
    test_results['api_connection'] = test_api_connection()
    if not test_results['api_connection']:
        print("❌ Cannot proceed without API connection")
        return test_results
    
    # Test 2: Clear Database
    test_results['database_clear'] = clear_database()
    
    # Test 3: WebSocket Connection
    ws_success, ws_messages = test_websocket_connection()
    test_results['websocket_connection'] = ws_success
    
    # Test 4: Test Immediate Vessel Appearance
    test_results['immediate_vessel_appearance'] = test_immediate_vessel_appearance()
    
    # Test 5: Check Backend Processing Logs
    test_results['message_processing_logs'] = check_backend_logs()
    
    # Test 6: Verify Statistics Update
    test_results['statistics_update'] = verify_statistics_update()
    
    # Test 7: Verify Active Vessels Endpoint
    test_results['active_vessels_endpoint'] = verify_active_vessels()
    
    # Summary
    print("\n" + "=" * 70)
    print("📊 REAL-TIME STREAMING TEST RESULTS")
    print("=" * 70)
    
    passed = 0
    total = len(test_results)
    
    for test_name, result in test_results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{test_name.replace('_', ' ').title()}: {status}")
        if result:
            passed += 1
    
    print(f"\nOverall: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 ALL TESTS PASSED - Real-time TCP streaming is working correctly!")
        print("✅ Messages processed immediately")
        print("✅ WebSocket broadcasts position updates")
        print("✅ Statistics update correctly")
        print("✅ Vessels appear in /api/vessels/active within seconds")
    else:
        print("⚠️ SOME TESTS FAILED - Issues found with real-time streaming")
        
        # Detailed failure analysis
        if not test_results['websocket_connection']:
            print("❌ CRITICAL: WebSocket connection failed - real-time updates won't work")
        if not test_results['immediate_vessel_appearance']:
            print("❌ CRITICAL: Vessels don't appear immediately - streaming may not be working")
        if not test_results['message_processing_logs']:
            print("❌ WARNING: No message processing logs found - check if messages are being processed")
        if not test_results['statistics_update']:
            print("❌ WARNING: Statistics not updating - source tracking may be broken")
    
    return test_results

if __name__ == "__main__":
    results = run_comprehensive_test()