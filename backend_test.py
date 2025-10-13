#!/usr/bin/env python3
"""
Backend API Testing for VDO Type 4 Message Processing
Tests the fixed Type 4 (Base Station Report) message processing and VDO detection.
"""

import requests
import json
import time
from datetime import datetime

# Backend URL from frontend .env
BACKEND_URL = "https://ship-pulse.preview.emergentagent.com/api"

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
    """Check backend logs for any errors"""
    print("📋 Checking backend logs...")
    try:
        import subprocess
        result = subprocess.run(['tail', '-n', '50', '/var/log/supervisor/backend.err.log'], 
                              capture_output=True, text=True, timeout=10)
        
        if result.returncode == 0:
            logs = result.stdout.strip()
            if logs:
                print("⚠️ Recent backend error logs:")
                print(logs[-1000:])  # Last 1000 chars
                return False
            else:
                print("✅ No recent backend errors")
                return True
        else:
            print("⚠️ Could not read backend logs")
            return True  # Don't fail the test for this
    except Exception as e:
        print(f"⚠️ Error checking logs: {e}")
        return True  # Don't fail the test for this

def run_comprehensive_test():
    """Run the complete test suite"""
    print("=" * 60)
    print("🧪 VDO Type 4 Message Processing Test Suite")
    print("=" * 60)
    
    test_results = {
        'api_connection': False,
        'database_clear': False,
        'file_upload': False,
        'message_storage': False,
        'position_storage': False,
        'base_station_flag': False,
        'active_vessels': False,
        'backend_logs': False
    }
    
    # Test 1: API Connection
    test_results['api_connection'] = test_api_connection()
    if not test_results['api_connection']:
        print("❌ Cannot proceed without API connection")
        return test_results
    
    # Test 2: Clear Database
    test_results['database_clear'] = clear_database()
    
    # Test 3: Upload VDO File
    source_id = upload_vdo_file()
    test_results['file_upload'] = source_id is not None
    
    # Test 4: Verify Message Storage
    vessel_data = verify_message_storage()
    test_results['message_storage'] = vessel_data is not None
    
    # Test 5: Verify Position Storage
    test_results['position_storage'] = verify_position_storage(vessel_data)
    
    # Test 6: Verify Base Station Flag
    test_results['base_station_flag'] = verify_base_station_flag(vessel_data)
    
    # Test 7: Verify Active Vessels
    test_results['active_vessels'] = verify_active_vessels()
    
    # Test 8: Check Backend Logs
    test_results['backend_logs'] = check_backend_logs()
    
    # Summary
    print("\n" + "=" * 60)
    print("📊 TEST RESULTS SUMMARY")
    print("=" * 60)
    
    passed = 0
    total = len(test_results)
    
    for test_name, result in test_results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{test_name.replace('_', ' ').title()}: {status}")
        if result:
            passed += 1
    
    print(f"\nOverall: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 ALL TESTS PASSED - VDO Type 4 processing is working correctly!")
    else:
        print("⚠️ SOME TESTS FAILED - Issues found with VDO Type 4 processing")
    
    return test_results

if __name__ == "__main__":
    results = run_comprehensive_test()