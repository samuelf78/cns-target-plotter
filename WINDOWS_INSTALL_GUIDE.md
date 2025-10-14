# COMPLETE WINDOWS INSTALLATION GUIDE
# CNS Systems Target Plotter - Step by Step

## STEP 1: DOWNLOAD THE PACKAGE

### Option A: Download from Web Interface
1. Look at the file tree on the left side of this screen
2. Find the file: `cns-target-plotter-standalone.tar.gz`
3. Right-click on it → Download
4. Save it to your Desktop or Downloads folder

### Option B: Use File Manager
1. Click the folder icon (Files) in the left sidebar
2. Navigate to `/app/`
3. Find `cns-target-plotter-standalone.tar.gz`
4. Right-click → Download

The file will download to your computer (about 50 KB).

---

## STEP 2: EXTRACT THE FILES

You need to extract the .tar.gz file. Here's how:

### Using 7-Zip (Recommended - Free):

1. **Download 7-Zip:**
   - Go to: https://www.7-zip.org/
   - Download the Windows 64-bit version
   - Install it (Next → Next → Install)

2. **Extract the package:**
   - Find `cns-target-plotter-standalone.tar.gz` in your Downloads folder
   - Right-click on it → 7-Zip → Extract Here
   - It will create a `.tar` file
   - Right-click on the `.tar` file → 7-Zip → Extract Here
   - You'll now have a folder: `cns-target-plotter-standalone`

3. **Move to a good location:**
   - Copy the `cns-target-plotter-standalone` folder
   - Paste it to `C:\` drive
   - Final location: `C:\cns-target-plotter-standalone`

---

## STEP 3: INSTALL PREREQUISITES

You need 3 programs. Install them in this order:

### A. Install MongoDB (Database)

1. **Download:**
   - Go to: https://www.mongodb.com/try/download/community
   - Click "Download"
   - File: `mongodb-windows-x86_64-6.0.x.msi` (about 300 MB)

2. **Install:**
   - Double-click the downloaded file
   - Click "Next"
   - Accept license → "Next"
   - Choose "Complete" installation
   - **IMPORTANT**: Check "Install MongoDB as a Service" ✓
   - Click "Next"
   - Uncheck "Install MongoDB Compass" (optional, we don't need it)
   - Click "Install"
   - Click "Yes" if Windows asks for permission
   - Wait 2-3 minutes for installation
   - Click "Finish"

3. **Verify MongoDB is running:**
   - Press `Windows Key + R`
   - Type: `services.msc`
   - Press Enter
   - Look for "MongoDB" in the list
   - Status should say "Running"

### B. Install Python

1. **Download:**
   - Go to: https://www.python.org/downloads/
   - Click the big "Download Python 3.12.x" button
   - File: `python-3.12.x-amd64.exe` (about 25 MB)

2. **Install:**
   - Double-click the downloaded file
   - **⚠️ CRITICAL**: Check "Add Python to PATH" at the bottom ✓✓✓
   - Click "Install Now"
   - Click "Yes" if Windows asks for permission
   - Wait 1-2 minutes
   - Click "Close"

3. **Verify Python:**
   - Press `Windows Key + R`
   - Type: `cmd`
   - Press Enter (Command Prompt opens)
   - Type: `python --version`
   - Press Enter
   - You should see: `Python 3.12.x`
   - Type: `exit` to close

### C. Install Node.js

1. **Download:**
   - Go to: https://nodejs.org/
   - Click "Download Node.js (LTS)"
   - File: `node-v20.x.x-x64.msi` (about 30 MB)

2. **Install:**
   - Double-click the downloaded file
   - Click "Next"
   - Accept license → "Next"
   - Click "Next" (keep default location)
   - Click "Next" (keep all features)
   - Check "Automatically install the necessary tools" ✓
   - Click "Next"
   - Click "Install"
   - Click "Yes" if Windows asks for permission
   - Wait 2-3 minutes
   - Click "Finish"
   - A PowerShell window may open - let it finish, then close it

3. **Verify Node.js:**
   - Press `Windows Key + R`
   - Type: `cmd`
   - Press Enter
   - Type: `node --version`
   - Press Enter
   - You should see: `v20.x.x`
   - Type: `exit`

---

## STEP 4: SETUP BACKEND (Python Server)

1. **Open Command Prompt:**
   - Press `Windows Key + R`
   - Type: `cmd`
   - Press Enter

2. **Navigate to backend folder:**
   ```cmd
   cd C:\cns-target-plotter-standalone\backend
   ```
   Press Enter

3. **Install Python packages:**
   ```cmd
   pip install -r requirements.txt
   ```
   Press Enter
   
   This will take 2-3 minutes. You'll see lots of text scrolling.
   Wait until you see "Successfully installed..." messages.

4. **Done!** You can close this Command Prompt window.

---

## STEP 5: SETUP FRONTEND (React Website)

1. **Open NEW Command Prompt:**
   - Press `Windows Key + R`
   - Type: `cmd`
   - Press Enter

2. **Navigate to frontend folder:**
   ```cmd
   cd C:\cns-target-plotter-standalone\frontend
   ```
   Press Enter

3. **Install Node packages:**
   ```cmd
   npm install
   ```
   Press Enter
   
   **⏰ This takes 3-5 minutes!** 
   You'll see a progress bar.
   Wait until you see "added XXX packages" message.

4. **Done!** You can close this Command Prompt window.

---

## STEP 6: START THE APPLICATION

### Option A: Easy Way (Automatic)

1. Open File Explorer
2. Go to: `C:\cns-target-plotter-standalone`
3. Find: `start-windows.bat`
4. Double-click it

Two black windows will open:
- One says "Starting Backend..."
- One says "Starting Frontend..."

After 10-20 seconds, your web browser will automatically open to:
**http://localhost:3000**

That's it! The application is running!

### Option B: Manual Way (More Control)

**Start Backend:**
1. Press `Windows Key + R`
2. Type: `cmd`
3. Press Enter
4. Type:
   ```cmd
   cd C:\cns-target-plotter-standalone\backend
   python server.py
   ```
5. Press Enter
6. You'll see: "Application startup complete"
7. **LEAVE THIS WINDOW OPEN!**

**Start Frontend:**
1. Press `Windows Key + R` again
2. Type: `cmd`
3. Press Enter
4. Type:
   ```cmd
   cd C:\cns-target-plotter-standalone\frontend
   npm start
   ```
5. Press Enter
6. Wait 10-20 seconds
7. Browser opens automatically
8. **LEAVE THIS WINDOW OPEN!**

---

## STEP 7: USE THE APPLICATION

The application is now running at: **http://localhost:3000**

### Connect to TCP AIS Receiver:

1. Click "Stream Connection" button (top right)
2. Select "TCP" 
3. Enter your receiver's IP (e.g., `192.168.1.100`)
4. Enter port (e.g., `5631` or `10110`)
5. Click "Start Stream"
6. Vessels will appear on the map!

### Connect to Serial USB Receiver:

1. Plug in your USB AIS receiver
2. Wait 10 seconds for Windows to install drivers
3. Click "Stream Connection" button
4. Select "Serial"
5. Pick your COM port (e.g., COM3, COM4)
6. Set baud rate (usually `38400`)
7. Click "Start Stream"
8. Vessels will appear!

### Upload a File:

1. Click "Upload File" button (top)
2. Select your .txt file with AIS messages
3. Watch progress in bottom right corner
4. Vessels appear on map when done

---

## STEP 8: STOP THE APPLICATION

**If you used the .bat file:**
- Close both black Command Prompt windows
- Close your browser

**If you started manually:**
- In each Command Prompt window, press `Ctrl + C`
- Type `Y` if asked
- Close the windows
- Close your browser

---

## TROUBLESHOOTING

### Problem: "MongoDB is not running"

**Fix:**
1. Press `Windows Key + R`
2. Type: `services.msc`
3. Press Enter
4. Find "MongoDB" in the list
5. Right-click → Start
6. Try again

### Problem: "Python is not recognized"

**Fix:**
1. Reinstall Python
2. **MAKE SURE** you check "Add Python to PATH" ✓
3. Restart your computer
4. Try again

### Problem: "Port 8001 is already in use"

**Fix:**
1. Press `Windows Key + R`
2. Type: `cmd`
3. Type: `netstat -ano | findstr :8001`
4. Note the number at the end (PID)
5. Type: `taskkill /PID <that_number> /F`
6. Try starting again

### Problem: "Cannot find module"

**Fix for Backend:**
```cmd
cd C:\cns-target-plotter-standalone\backend
pip install -r requirements.txt
```

**Fix for Frontend:**
```cmd
cd C:\cns-target-plotter-standalone\frontend
rmdir /s /q node_modules
del package-lock.json
npm install
```

### Problem: Serial port doesn't show up

**Fix:**
1. Open Device Manager (Windows Key + X → Device Manager)
2. Expand "Ports (COM & LPT)"
3. Find your USB device (note the COM number)
4. If you see a yellow ⚠️, right-click → Update driver
5. Refresh the app and try again

### Problem: Can't connect to TCP receiver

**Fix:**
1. Make sure receiver is on same network
2. Ping the receiver: `ping 192.168.1.100`
3. Check receiver's IP address hasn't changed
4. Check firewall isn't blocking connection
5. Try telnet: `telnet 192.168.1.100 5631`

---

## FIREWALL SETUP (Optional - For Network Access)

If you want to access from other computers:

1. Press `Windows Key`
2. Type: "Firewall"
3. Click "Windows Defender Firewall"
4. Click "Allow an app through firewall"
5. Click "Change settings"
6. Click "Allow another app"
7. Browse to: `C:\Python312\python.exe`
8. Click "Add"
9. Check both "Private" and "Public" ✓
10. Click "OK"

Then access from other devices using:
`http://YOUR_COMPUTER_IP:3000`

Find your IP:
```cmd
ipconfig
```
Look for "IPv4 Address" (e.g., 192.168.1.50)

---

## DAILY USE

### Starting the app:
1. Double-click: `C:\cns-target-plotter-standalone\start-windows.bat`
2. Wait 20 seconds
3. Browser opens automatically

### Stopping the app:
- Close the two black Command Prompt windows

### Restarting:
- Close everything
- Wait 5 seconds
- Start again

---

## GETTING HELP

If something doesn't work:

1. **Check backend window** for error messages
2. **Check browser console**: Press F12 → Console tab
3. **Check MongoDB is running**: services.msc
4. **Restart everything**: Close all, wait 10 seconds, start fresh
5. **Reboot computer** if all else fails

---

## WHAT YOU NOW HAVE

✅ Complete AIS/NMEA vessel tracking system
✅ Runs on your Windows computer
✅ Access to local network devices (TCP/UDP)
✅ Access to serial ports (USB receivers)
✅ Processes uploaded files
✅ Real-time tracking
✅ Historical replay
✅ No internet required
✅ Full source code - modify as you wish

## NEXT STEPS

- Read QUICKSTART.md for feature details
- Read README.md for technical information
- Connect your AIS receiver and start tracking!

---

## QUICK REFERENCE CARD

**Installation folder:** `C:\cns-target-plotter-standalone`

**Start app:** Double-click `start-windows.bat`

**Access app:** http://localhost:3000

**Backend runs on:** http://localhost:8001

**Stop app:** Close Command Prompt windows

**Restart:** Close all → Wait 5 seconds → Start again

**Check MongoDB:** services.msc → Find MongoDB → Should say "Running"

---

ENJOY YOUR VESSEL TRACKING SYSTEM! 🚢
