#!/bin/bash

# HIPAA-Compliant Healthcare Provider Portal Setup Script
# This script will help you set up the application for development

echo "🏥 HIPAA-Compliant Healthcare Provider Portal Setup"
echo "=================================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    echo "Visit: https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js version: $(node -v)"

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
    echo "⚠️  PostgreSQL is not installed. You'll need to install it for the database."
    echo "Visit: https://www.postgresql.org/download/"
    echo "Or use Docker: docker run --name postgres -e POSTGRES_PASSWORD=password -p 5432:5432 -d postgres"
fi

# Install backend dependencies
echo "📦 Installing backend dependencies..."
npm install

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
cd client
npm install
cd ..

# Create environment file
if [ ! -f .env ]; then
    echo "🔧 Creating environment configuration..."
    cp .env.example .env
    echo "✅ Environment file created. Please edit .env with your configuration."
else
    echo "✅ Environment file already exists."
fi

# Create uploads directory
echo "📁 Creating uploads directory..."
mkdir -p uploads

# Create database setup script
echo "🗄️  Creating database setup script..."
cat > setup-database.sql << 'EOF'
-- Database setup for HIPAA Healthcare Portal
-- Run this script in PostgreSQL

-- Create database
CREATE DATABASE hipaa_healthcare_db;

-- Create user (change password as needed)
CREATE USER hipaa_user WITH PASSWORD 'your_secure_password';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE hipaa_healthcare_db TO hipaa_user;

-- Connect to the database
\c hipaa_healthcare_db;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO hipaa_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO hipaa_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO hipaa_user;

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO hipaa_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO hipaa_user;
EOF

echo "✅ Database setup script created: setup-database.sql"

# Create development startup script
echo "🚀 Creating development startup script..."
cat > dev-start.sh << 'EOF'
#!/bin/bash

# Start both backend and frontend in development mode
echo "Starting HIPAA Healthcare Portal in development mode..."

# Start backend
echo "Starting backend server..."
npm run server &

# Wait a moment for backend to start
sleep 3

# Start frontend
echo "Starting frontend development server..."
cd client && npm start
EOF

chmod +x dev-start.sh

# Create production build script
echo "🏗️  Creating production build script..."
cat > build.sh << 'EOF'
#!/bin/bash

# Build the application for production
echo "Building HIPAA Healthcare Portal for production..."

# Build frontend
echo "Building frontend..."
cd client
npm run build
cd ..

# Install production dependencies
echo "Installing production dependencies..."
npm ci --only=production

echo "✅ Production build complete!"
echo "To start the production server, run: npm start"
EOF

chmod +x build.sh

# Create security checklist
echo "🔒 Creating security checklist..."
cat > SECURITY_CHECKLIST.md << 'EOF'
# HIPAA Security Checklist

## Environment Configuration
- [ ] Change all default passwords in .env file
- [ ] Generate secure JWT secrets
- [ ] Configure encryption keys
- [ ] Set up HTTPS in production
- [ ] Configure database with SSL

## Database Security
- [ ] Use strong database passwords
- [ ] Enable database encryption at rest
- [ ] Configure database access controls
- [ ] Set up database backups
- [ ] Enable audit logging

## Application Security
- [ ] Review and update CORS settings
- [ ] Configure rate limiting
- [ ] Set up proper session management
- [ ] Enable security headers
- [ ] Configure file upload restrictions

## HIPAA Compliance
- [ ] Complete HIPAA training for all users
- [ ] Set up audit logging
- [ ] Configure data retention policies
- [ ] Implement access controls
- [ ] Set up data encryption

## Production Deployment
- [ ] Use HTTPS only
- [ ] Configure firewall rules
- [ ] Set up monitoring and alerting
- [ ] Implement backup strategies
- [ ] Configure error handling

## Regular Maintenance
- [ ] Keep dependencies updated
- [ ] Monitor security advisories
- [ ] Review audit logs regularly
- [ ] Test backup and recovery
- [ ] Update security policies
EOF

echo "✅ Security checklist created: SECURITY_CHECKLIST.md"

# Create README for next steps
echo "📋 Creating setup instructions..."
cat > SETUP_INSTRUCTIONS.md << 'EOF'
# Setup Instructions

## Quick Start

1. **Configure Environment**
   ```bash
   # Edit the .env file with your settings
   nano .env
   ```

2. **Set up Database**
   ```bash
   # Create database and user
   psql -U postgres -f setup-database.sql
   ```

3. **Start Development Server**
   ```bash
   # Start both backend and frontend
   ./dev-start.sh
   ```

4. **Access the Application**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:3001
   - Health Check: http://localhost:3001/api/health

## First Time Setup

1. **Register a Healthcare Provider**
   - Go to http://localhost:3000/register
   - Fill in your provider information
   - Complete HIPAA training

2. **Login and Access**
   - Login with your credentials
   - Complete HIPAA training if required
   - Start managing patients and documents

## Production Deployment

1. **Build for Production**
   ```bash
   ./build.sh
   ```

2. **Configure Production Environment**
   - Set NODE_ENV=production
   - Configure HTTPS
   - Set up monitoring

3. **Start Production Server**
   ```bash
   npm start
   ```

## Security Notes

- Review SECURITY_CHECKLIST.md
- Change all default passwords
- Configure proper SSL certificates
- Set up regular backups
- Monitor audit logs

## Support

For issues or questions:
- Check the logs in the console
- Review the API documentation
- Ensure all environment variables are set correctly
EOF

echo "✅ Setup instructions created: SETUP_INSTRUCTIONS.md"

echo ""
echo "🎉 Setup Complete!"
echo "=================="
echo ""
echo "Next steps:"
echo "1. Edit .env file with your configuration"
echo "2. Set up PostgreSQL database"
echo "3. Run: ./dev-start.sh"
echo "4. Access: http://localhost:3000"
echo ""
echo "📚 Documentation:"
echo "- SETUP_INSTRUCTIONS.md - Detailed setup guide"
echo "- SECURITY_CHECKLIST.md - Security requirements"
echo "- README.md - General information"
echo ""
echo "🔒 Remember to review the security checklist before production use!"