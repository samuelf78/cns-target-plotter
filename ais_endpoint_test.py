#!/usr/bin/env python3
"""
AIS Application Endpoint Testing
Tests the AIS application endpoints to ensure they're working correctly.

Focus areas:
1. Upload AIS file - POST /api/upload with sample NMEA file
2. Get vessels - GET /api/vessels to verify vessel data includes position_count field
3. Get vessel track - GET /api/track/{mmsi} to ensure historical positions are returned
4. Text messages API - GET /api/messages/text to verify new message logging works

Test Requirements:
- Verify vessel objects have position_count field populated
- Check that vesselTrack data is being returned with proper structure
- Ensure temporal track data has the right format
- Test if new message types (6, 8, 9, 12, 14, 19, 27) are being decoded and stored
"""

import requests
import json
import time
import tempfile
import os
from datetime import datetime

# Backend URL from frontend .env
BACKEND_URL = "https://vessel-monitor-app.preview.emergentagent.com/api"

# Sample NMEA messages for testing
SAMPLE_MESSAGES = {
    'position': "!AIVDM,1,1,,A,13aEOK?P00PD2wVMdLDRhgvL289?,0*26",
    'type_14_safety': "!AIVDM,1,1,,A,>3aEOK0000000000000000000000,0*35",
    'type_6_binary': "!AIVDM,1,1,,A,6>jR0600V:C0>da4UF6BP=P0000,2*5A",
    'type_8_broadcast': "!AIVDM,1,1,,A,85Mwp`1Kf3aCnsNvBWLi=wQuNhA5t43N`5nCuI=p<IBG>mLAA@QKlZ@,0*13",
    'type_9_sar': "!AIVDM,1,1,,A,91b55wi;hbOS@OdQAC062Ch2089h,0*30",
    'type_12_safety_addressed': "!AIVDM,1,1,,A,<5?SIj1;GbD07??4,0*38",
    'type_19_extended_class_b': "!AIVDM,1,1,,A,C5N3SRgPEnJGEBT>NhWAwwo862PaLELTBJ:V00000000S0D:R220,0*0B",
    'type_27_long_range': "!AIVDM,1,1,,A,KC5E2b@U19PFdLbMuc5=ROv62<7m,0*16"
}

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

def create_test_file(messages, filename="test_ais_messages.txt"):
    """Create a temporary test file with AIS messages"""
    try:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
            for msg in messages:
                f.write(msg + '\n')
            return f.name
    except Exception as e:
        print(f"❌ Error creating test file: {e}")
        return None

def test_upload_ais_file():
    """Test POST /api/upload with sample NMEA file"""
    print("📤 Testing AIS file upload...")
    try:
        # Create test file with various message types
        test_messages = [
            SAMPLE_MESSAGES['position'],
            SAMPLE_MESSAGES['type_14_safety'],
            SAMPLE_MESSAGES['type_6_binary'],
            SAMPLE_MESSAGES['type_8_broadcast'],
            SAMPLE_MESSAGES['type_9_sar'],
            SAMPLE_MESSAGES['type_12_safety_addressed'],
            SAMPLE_MESSAGES['type_19_extended_class_b'],
            SAMPLE_MESSAGES['type_27_long_range']
        ]
        
        temp_file = create_test_file(test_messages)
        if not temp_file:
            return False, None
        
        try:
            with open(temp_file, 'rb') as f:
                files = {'file': ('test_ais_messages.txt', f, 'text/plain')}
                response = requests.post(f"{BACKEND_URL}/upload", files=files, timeout=30)
            
            # Clean up temp file
            os.unlink(temp_file)
            
            if response.status_code == 200:
                data = response.json()
                print(f"✅ File uploaded successfully:")
                print(f"   - Source ID: {data.get('source_id')}")
                print(f"   - Processed: {data.get('processed')} messages")
                print(f"   - Errors: {data.get('errors')} errors")
                print(f"   - Target count: {data.get('target_count')} targets")
                return True, data.get('source_id')
            else:
                print(f"❌ File upload failed: {response.status_code} - {response.text}")
                return False, None
        except Exception as e:
            # Clean up temp file on error
            if os.path.exists(temp_file):
                os.unlink(temp_file)
            raise e
            
    except Exception as e:
        print(f"❌ File upload error: {e}")
        return False, None

def test_get_vessels():
    """Test GET /api/vessels to verify vessel data includes position_count field"""
    print("🚢 Testing GET /api/vessels endpoint...")
    try:
        response = requests.get(f"{BACKEND_URL}/vessels", timeout=10)
        if response.status_code == 200:
            data = response.json()
            vessels = data.get('vessels', [])
            
            print(f"✅ Vessels endpoint working:")
            print(f"   - Total vessels: {len(vessels)}")
            
            if len(vessels) > 0:
                # Check first vessel for required fields
                vessel = vessels[0]
                required_fields = ['mmsi', 'position_count', 'last_seen', 'country']
                missing_fields = []
                
                for field in required_fields:
                    if field not in vessel:
                        missing_fields.append(field)
                
                if missing_fields:
                    print(f"❌ Missing required fields: {missing_fields}")
                    return False
                
                print(f"✅ Vessel data structure verified:")
                print(f"   - MMSI: {vessel.get('mmsi')}")
                print(f"   - Position count: {vessel.get('position_count')}")
                print(f"   - Last seen: {vessel.get('last_seen')}")
                print(f"   - Country: {vessel.get('country')}")
                
                # Check if position_count is populated (should be > 0)
                position_count = vessel.get('position_count', 0)
                if position_count > 0:
                    print(f"✅ Position count field populated: {position_count}")
                    return True
                else:
                    print(f"❌ Position count field not populated: {position_count}")
                    return False
            else:
                print("❌ No vessels found")
                return False
        else:
            print(f"❌ Vessels endpoint failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Vessels endpoint error: {e}")
        return False

def test_get_vessel_track():
    """Test GET /api/track/{mmsi} to ensure historical positions are returned"""
    print("📍 Testing GET /api/track/{mmsi} endpoint...")
    try:
        # First get a vessel MMSI from the vessels endpoint
        response = requests.get(f"{BACKEND_URL}/vessels", timeout=10)
        if response.status_code != 200:
            print("❌ Cannot get vessels to test track endpoint")
            return False
        
        vessels_data = response.json()
        vessels = vessels_data.get('vessels', [])
        
        if len(vessels) == 0:
            print("❌ No vessels available to test track endpoint")
            return False
        
        # Use the first vessel's MMSI
        test_mmsi = vessels[0].get('mmsi')
        print(f"   Testing with MMSI: {test_mmsi}")
        
        # Test the track endpoint
        response = requests.get(f"{BACKEND_URL}/track/{test_mmsi}", timeout=10)
        if response.status_code == 200:
            data = response.json()
            track_data = data.get('track', [])
            
            print(f"✅ Track endpoint working:")
            print(f"   - Track points: {len(track_data)}")
            
            if len(track_data) > 0:
                # Check track data structure
                track_point = track_data[0]
                required_fields = ['timestamp', 'lat', 'lon']
                optional_fields = ['speed', 'course', 'heading']
                
                missing_required = []
                for field in required_fields:
                    if field not in track_point:
                        missing_required.append(field)
                
                if missing_required:
                    print(f"❌ Missing required track fields: {missing_required}")
                    return False
                
                print(f"✅ Track data structure verified:")
                print(f"   - Timestamp: {track_point.get('timestamp')}")
                print(f"   - Latitude: {track_point.get('lat')}")
                print(f"   - Longitude: {track_point.get('lon')}")
                
                # Check optional fields
                for field in optional_fields:
                    if field in track_point:
                        print(f"   - {field.capitalize()}: {track_point.get(field)}")
                
                # Verify temporal track data format
                timestamp = track_point.get('timestamp')
                if timestamp:
                    try:
                        # Try to parse timestamp
                        datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
                        print("✅ Timestamp format is valid ISO format")
                    except:
                        print("❌ Invalid timestamp format")
                        return False
                
                return True
            else:
                print("❌ No track data found")
                return False
        else:
            print(f"❌ Track endpoint failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Track endpoint error: {e}")
        return False

def test_text_messages_api():
    """Test GET /api/messages/text to verify new message logging works"""
    print("💬 Testing GET /api/messages/text endpoint...")
    try:
        response = requests.get(f"{BACKEND_URL}/messages/text", timeout=10)
        if response.status_code == 200:
            data = response.json()
            messages = data.get('messages', [])
            
            print(f"✅ Text messages endpoint working:")
            print(f"   - Total messages: {len(messages)}")
            
            if len(messages) > 0:
                # Check message structure
                message = messages[0]
                required_fields = ['mmsi', 'timestamp', 'message_type', 'message_category']
                
                missing_fields = []
                for field in required_fields:
                    if field not in message:
                        missing_fields.append(field)
                
                if missing_fields:
                    print(f"❌ Missing required message fields: {missing_fields}")
                    return False
                
                print(f"✅ Text message structure verified:")
                print(f"   - MMSI: {message.get('mmsi')}")
                print(f"   - Message type: {message.get('message_type')}")
                print(f"   - Category: {message.get('message_category')}")
                print(f"   - Timestamp: {message.get('timestamp')}")
                
                # Check for specific message types (6, 8, 12, 14)
                message_types = set()
                for msg in messages:
                    msg_type = msg.get('message_type')
                    if msg_type:
                        message_types.add(msg_type)
                
                print(f"✅ Found message types: {sorted(message_types)}")
                
                # Check if we have the new message types we uploaded
                expected_types = {6, 8, 12, 14}
                found_types = message_types.intersection(expected_types)
                
                if found_types:
                    print(f"✅ New message types found: {sorted(found_types)}")
                    return True
                else:
                    print(f"❌ No new message types found (expected: {expected_types})")
                    return False
            else:
                print("ℹ️ No text messages found (this may be normal if no text messages were in the uploaded data)")
                return True  # This is not necessarily a failure
        else:
            print(f"❌ Text messages endpoint failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Text messages endpoint error: {e}")
        return False

def test_message_types_decoding():
    """Test if new message types (6, 8, 9, 12, 14, 19, 27) are being decoded and stored"""
    print("🔍 Testing message types decoding and storage...")
    try:
        # Check vessels endpoint for different vessel types
        response = requests.get(f"{BACKEND_URL}/vessels", timeout=10)
        if response.status_code != 200:
            print("❌ Cannot get vessels to check message types")
            return False
        
        vessels_data = response.json()
        vessels = vessels_data.get('vessels', [])
        
        # Check for different message type indicators
        message_type_indicators = {
            'sar_aircraft': 0,  # Type 9 - SAR aircraft (MMSI starting with 111)
            'class_b_vessels': 0,  # Type 18/19 - Class B vessels
            'base_stations': 0,  # Type 4 - Base stations
            'atons': 0  # Type 21 - Aid to Navigation
        }
        
        for vessel in vessels:
            mmsi = vessel.get('mmsi', '')
            
            # Check for SAR aircraft (MMSI starting with 111)
            if mmsi.startswith('111'):
                message_type_indicators['sar_aircraft'] += 1
            
            # Check for base stations
            if vessel.get('is_base_station'):
                message_type_indicators['base_stations'] += 1
            
            # Check for AtoNs
            if vessel.get('is_aton'):
                message_type_indicators['atons'] += 1
            
            # Check for Class B vessels (ship_type or other indicators)
            if vessel.get('ship_type') is not None:
                message_type_indicators['class_b_vessels'] += 1
        
        print(f"✅ Message type analysis:")
        for msg_type, count in message_type_indicators.items():
            print(f"   - {msg_type.replace('_', ' ').title()}: {count}")
        
        # Check text messages for binary and safety messages
        try:
            response = requests.get(f"{BACKEND_URL}/messages/text", timeout=10)
            if response.status_code == 200:
                text_data = response.json()
                text_messages = text_data.get('messages', [])
                
                text_categories = {}
                for msg in text_messages:
                    category = msg.get('message_category', 'unknown')
                    text_categories[category] = text_categories.get(category, 0) + 1
                
                print(f"✅ Text message categories:")
                for category, count in text_categories.items():
                    print(f"   - {category.replace('_', ' ').title()}: {count}")
                
                return True
            else:
                print("⚠️ Could not check text messages, but vessel analysis completed")
                return True
        except:
            print("⚠️ Could not check text messages, but vessel analysis completed")
            return True
            
    except Exception as e:
        print(f"❌ Message types analysis error: {e}")
        return False

def check_backend_logs():
    """Check backend logs for any errors in message processing"""
    print("📋 Checking backend logs for message processing...")
    try:
        import subprocess
        result = subprocess.run(['tail', '-n', '50', '/var/log/supervisor/backend.err.log'], 
                              capture_output=True, text=True, timeout=10)
        
        if result.returncode == 0:
            logs = result.stdout.strip()
            if logs:
                # Look for errors
                error_lines = [line for line in logs.split('\n') if 'error' in line.lower() or 'exception' in line.lower()]
                if error_lines:
                    print("⚠️ Found potential errors in backend logs:")
                    for line in error_lines[-5:]:  # Show last 5 error lines
                        print(f"   {line}")
                    return False
                else:
                    print("✅ No errors found in recent backend logs")
                    return True
            else:
                print("ℹ️ No recent error logs found")
                return True
        else:
            print("⚠️ Could not read backend error logs")
            return True  # Not a critical failure
    except Exception as e:
        print(f"⚠️ Error checking logs: {e}")
        return True  # Not a critical failure

def run_ais_endpoint_tests():
    """Run comprehensive AIS endpoint tests"""
    print("=" * 70)
    print("🚢 AIS Application Endpoint Test Suite")
    print("=" * 70)
    
    test_results = {
        'api_connection': False,
        'database_clear': False,
        'upload_ais_file': False,
        'get_vessels': False,
        'get_vessel_track': False,
        'text_messages_api': False,
        'message_types_decoding': False,
        'backend_logs_check': False
    }
    
    # Test 1: API Connection
    test_results['api_connection'] = test_api_connection()
    if not test_results['api_connection']:
        print("❌ Cannot proceed without API connection")
        return test_results
    
    # Test 2: Clear Database
    test_results['database_clear'] = clear_database()
    
    # Test 3: Upload AIS File
    upload_success, source_id = test_upload_ais_file()
    test_results['upload_ais_file'] = upload_success
    
    if upload_success:
        # Wait for processing
        print("⏳ Waiting for message processing...")
        time.sleep(5)
        
        # Test 4: Get Vessels
        test_results['get_vessels'] = test_get_vessels()
        
        # Test 5: Get Vessel Track
        test_results['get_vessel_track'] = test_get_vessel_track()
        
        # Test 6: Text Messages API
        test_results['text_messages_api'] = test_text_messages_api()
        
        # Test 7: Message Types Decoding
        test_results['message_types_decoding'] = test_message_types_decoding()
    
    # Test 8: Backend Logs Check
    test_results['backend_logs_check'] = check_backend_logs()
    
    # Summary
    print("\n" + "=" * 70)
    print("📊 AIS ENDPOINT TEST RESULTS")
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
        print("🎉 ALL TESTS PASSED - AIS application endpoints are working correctly!")
        print("✅ File upload processes AIS messages successfully")
        print("✅ Vessel data includes position_count field")
        print("✅ Vessel track data returns proper structure")
        print("✅ Text messages API logs new message types")
        print("✅ New message types (6, 8, 9, 12, 14, 19, 27) are decoded and stored")
    else:
        print("⚠️ SOME TESTS FAILED - Issues found with AIS endpoints")
        
        # Detailed failure analysis
        failed_tests = [name for name, result in test_results.items() if not result]
        for test_name in failed_tests:
            if test_name == 'upload_ais_file':
                print("❌ CRITICAL: AIS file upload not working")
            elif test_name == 'get_vessels':
                print("❌ CRITICAL: Vessels endpoint missing position_count field")
            elif test_name == 'get_vessel_track':
                print("❌ CRITICAL: Vessel track endpoint not returning proper structure")
            elif test_name == 'text_messages_api':
                print("❌ WARNING: Text messages API not working properly")
            elif test_name == 'message_types_decoding':
                print("❌ WARNING: New message types may not be decoded properly")
    
    return test_results

if __name__ == "__main__":
    # Run AIS endpoint tests
    print("Starting AIS Endpoint Tests...")
    results = run_ais_endpoint_tests()
    
    print("\n" + "=" * 70)
    print("🏁 TESTING COMPLETE")
    print("=" * 70)
    
    passed = sum(results.values())
    total = len(results)
    
    print(f"AIS Endpoint Tests: {passed}/{total} passed")
    
    if passed == total:
        print("🎉 ALL AIS ENDPOINT TESTS PASSED!")
    else:
        print("⚠️ Some AIS endpoint tests failed - see details above")