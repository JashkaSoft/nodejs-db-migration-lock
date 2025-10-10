#!/bin/bash

# E2E Test Runner Script
# This script runs the E2E tests with podman Compose

set -e

echo "🚀 Starting E2E Tests for nodejs-db-migration-lock"
echo "=================================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if podman is running
if ! podman info > /dev/null 2>&1; then
    echo -e "${RED}❌ podman is not running. Please start podman first.${NC}"
    exit 1
fi

# Check if podman Compose is available
if ! command -v podman-compose &> /dev/null; then
    echo -e "${RED}❌ podman-compose not found. Please install podman Compose.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ podman is running${NC}"
echo ""

# Cleanup any previous runs
echo "🧹 Cleaning up previous runs..."
podman-compose down -v 2>/dev/null || true
echo ""

# Build and run tests
echo "🏗️  Building podman images..."
podman-compose build --no-cache

echo ""
echo "🐳 Starting containers..."
echo "   - 1 PostgreSQL database"
echo "   - 3 Migration processes (concurrent)"
echo "   - 1 Test verifier"
echo ""

# Run containers in background
podman-compose up -d

echo ""
echo "⏳ Waiting for migrations to complete (20 seconds)..."
sleep 20

echo ""
echo "🔍 Running E2E tests with Jest..."
echo ""

# Run Jest E2E tests from the host (not inside the container)
# The tests will connect to the postgres container via localhost:5433
cd ..
POSTGRES_HOST=localhost POSTGRES_PORT=5433 npm run test:e2e:only
EXIT_CODE=$?
cd e2e

echo ""
echo "=================================================="

if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ E2E Tests PASSED!${NC}"
else
    echo -e "${RED}❌ E2E Tests FAILED!${NC}"
fi

echo ""
echo "🧹 Cleaning up..."
podman-compose down -v --timeout 5

echo ""
echo "=================================================="

exit $EXIT_CODE
