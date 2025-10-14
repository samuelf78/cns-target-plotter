#!/bin/bash

# Create standalone package directory
mkdir -p /tmp/cns-target-plotter-standalone
cd /tmp/cns-target-plotter-standalone

# Copy backend files
mkdir -p backend
cp /app/backend/server.py backend/
cp /app/backend/requirements.txt backend/
cat > backend/.env << 'ENVFILE'
MONGO_URL=mongodb://localhost:27017
DB_NAME=ais_tracker
PORT=8001
ENVFILE

# Copy frontend files
mkdir -p frontend/src/components/ui
mkdir -p frontend/public

# Copy main frontend files
cp /app/frontend/package.json frontend/
cp /app/frontend/tailwind.config.js frontend/
cp /app/frontend/postcss.config.js frontend/
cp /app/frontend/src/App.js frontend/src/
cp /app/frontend/src/App.css frontend/src/
cp /app/frontend/src/index.js frontend/src/
cp /app/frontend/src/index.css frontend/src/

# Copy UI components
cp -r /app/frontend/src/components/ui/* frontend/src/components/ui/
cp -r /app/frontend/src/hooks frontend/src/

# Copy public files
cp -r /app/frontend/public/* frontend/public/ 2>/dev/null || true

# Create frontend .env
cat > frontend/.env << 'ENVFILE'
REACT_APP_BACKEND_URL=http://localhost:8001
ENVFILE

# Copy README
cp /app/STANDALONE_README.md README.md

# Create tarball
cd /tmp
tar -czf cns-target-plotter-standalone.tar.gz cns-target-plotter-standalone/

echo "Package created at: /tmp/cns-target-plotter-standalone.tar.gz"
ls -lh /tmp/cns-target-plotter-standalone.tar.gz
