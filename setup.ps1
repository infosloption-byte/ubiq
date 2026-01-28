# Ubiq Platform - Automated Setup Script for Windows
# Run this script in PowerShell as Administrator

Write-Host "================================" -ForegroundColor Green
Write-Host "Ubiq Platform Setup Script" -ForegroundColor Green
Write-Host "Windows Version" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host ""

# Function to print status
function Print-Status {
    param($message)
    Write-Host "[✓] $message" -ForegroundColor Green
}

function Print-Error {
    param($message)
    Write-Host "[✗] $message" -ForegroundColor Red
}

function Print-Warning {
    param($message)
    Write-Host "[!] $message" -ForegroundColor Yellow
}

# Check if running from project root
if (-not (Test-Path "backend") -or -not (Test-Path "frontend") -or -not (Test-Path "inference-server")) {
    Print-Error "Please run this script from the project root directory"
    exit 1
}

Print-Status "Starting setup process..."

# ===========================================
# 1. BACKEND SETUP
# ===========================================
Write-Host ""
Write-Host "Setting up Laravel Backend..." -ForegroundColor Yellow

Set-Location backend

# Check if .env exists
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Print-Status "Created .env file from .env.example"
    } else {
        Print-Error ".env.example not found in backend directory"
        exit 1
    }
} else {
    Print-Warning ".env already exists, skipping..."
}

# Check for composer
if (-not (Get-Command composer -ErrorAction SilentlyContinue)) {
    Print-Error "Composer is not installed. Please install it first."
    Write-Host "Download from: https://getcomposer.org/download/" -ForegroundColor Cyan
    exit 1
}

# Install PHP dependencies
Print-Status "Installing PHP dependencies..."
composer install --no-interaction

# Generate application key
Print-Status "Generating application key..."
php artisan key:generate

# Set up storage directories
Print-Status "Setting up storage directories..."
New-Item -ItemType Directory -Force -Path "storage/framework/sessions" | Out-Null
New-Item -ItemType Directory -Force -Path "storage/framework/views" | Out-Null
New-Item -ItemType Directory -Force -Path "storage/framework/cache" | Out-Null
New-Item -ItemType Directory -Force -Path "storage/logs" | Out-Null
New-Item -ItemType Directory -Force -Path "bootstrap/cache" | Out-Null

# Database setup
Write-Host ""
$db_type = Read-Host "Database type (sqlite/mysql) [default: sqlite]"
if ([string]::IsNullOrWhiteSpace($db_type)) {
    $db_type = "sqlite"
}

if ($db_type -eq "sqlite") {
    Print-Status "Setting up SQLite database..."
    
    # Update .env for SQLite
    (Get-Content .env) -replace 'DB_CONNECTION=.*', 'DB_CONNECTION=sqlite' | Set-Content .env
    
    # Create database file
    New-Item -ItemType File -Force -Path "database/database.sqlite" | Out-Null
    
    Print-Status "Running migrations..."
    php artisan migrate --force
    
    Print-Status "Seeding database..."
    php artisan db:seed --force
    
} elseif ($db_type -eq "mysql") {
    Print-Warning "MySQL setup requires manual configuration"
    Write-Host "Please update the following in backend\.env:" -ForegroundColor Cyan
    Write-Host "  DB_CONNECTION=mysql"
    Write-Host "  DB_HOST=127.0.0.1"
    Write-Host "  DB_PORT=3306"
    Write-Host "  DB_DATABASE=ubiq"
    Write-Host "  DB_USERNAME=your_username"
    Write-Host "  DB_PASSWORD=your_password"
    Write-Host ""
    Write-Host "Then run:" -ForegroundColor Cyan
    Write-Host "  cd backend"
    Write-Host "  php artisan migrate"
    Write-Host "  php artisan db:seed"
}

Set-Location ..
Print-Status "Backend setup complete!"

# ===========================================
# 2. FRONTEND SETUP
# ===========================================
Write-Host ""
Write-Host "Setting up React Frontend..." -ForegroundColor Yellow

Set-Location frontend

# Check if .env.local exists
if (-not (Test-Path ".env.local")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env.local"
        Print-Status "Created .env.local file from .env.example"
    } else {
        # Create basic .env.local
        "VITE_API_URL=http://localhost:8000/api/v1" | Out-File -FilePath ".env.local" -Encoding UTF8
        Print-Status "Created .env.local file"
    }
} else {
    Print-Warning ".env.local already exists, skipping..."
}

# Check for npm
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Print-Error "npm is not installed. Please install Node.js first."
    Write-Host "Download from: https://nodejs.org/" -ForegroundColor Cyan
    exit 1
}

# Install Node dependencies
Print-Status "Installing Node.js dependencies (this may take a while)..."
npm install

Set-Location ..
Print-Status "Frontend setup complete!"

# ===========================================
# 3. INFERENCE SERVER SETUP
# ===========================================
Write-Host ""
Write-Host "Setting up Python Inference Server..." -ForegroundColor Yellow

Set-Location inference-server

# Check for Python
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Print-Error "Python is not installed. Please install it first."
    Write-Host "Download from: https://www.python.org/downloads/" -ForegroundColor Cyan
    exit 1
}

# Check if .env exists
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Print-Status "Created .env file from .env.example"
    } else {
        # Create basic .env
        "OLLAMA_HOST=http://localhost:11434" | Out-File -FilePath ".env" -Encoding UTF8
        Print-Status "Created .env file"
    }
} else {
    Print-Warning ".env already exists, skipping..."
}

# Create virtual environment
if (-not (Test-Path "venv")) {
    Print-Status "Creating Python virtual environment..."
    python -m venv venv
}

# Activate virtual environment and install dependencies
Print-Status "Installing Python dependencies..."
& "venv\Scripts\Activate.ps1"
python -m pip install --upgrade pip
pip install -r requirements.txt
deactivate

Set-Location ..
Print-Status "Inference server setup complete!"

# ===========================================
# 4. OLLAMA CHECK
# ===========================================
Write-Host ""
Write-Host "Checking Ollama installation..." -ForegroundColor Yellow

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Print-Warning "Ollama is not installed!"
    Write-Host ""
    Write-Host "Please install Ollama from: https://ollama.ai/download" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "After installation, run in Command Prompt:" -ForegroundColor Cyan
    Write-Host "  ollama pull codellama:7b"
    Write-Host "  ollama pull deepseek-coder:6.7b"
} else {
    Print-Status "Ollama is installed"
    
    # Check if models are available
    $models = ollama list
    if ($models -match "codellama:7b") {
        Print-Status "codellama:7b model is available"
    } else {
        Print-Warning "codellama:7b model not found. Run: ollama pull codellama:7b"
    }
}

# ===========================================
# SUMMARY
# ===========================================
Write-Host ""
Write-Host "================================" -ForegroundColor Green
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host ""
Write-Host "To start the application, open 3 separate terminals:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Backend (Terminal 1 - Command Prompt):" -ForegroundColor Yellow
Write-Host "   cd backend"
Write-Host "   php artisan serve"
Write-Host ""
Write-Host "2. Frontend (Terminal 2 - Command Prompt):" -ForegroundColor Yellow
Write-Host "   cd frontend"
Write-Host "   npm run dev"
Write-Host ""
Write-Host "3. Inference Server (Terminal 3 - Command Prompt):" -ForegroundColor Yellow
Write-Host "   cd inference-server"
Write-Host "   venv\Scripts\activate"
Write-Host "   python main.py"
Write-Host ""
Write-Host "Then open in your browser: http://localhost:3000" -ForegroundColor Cyan
Write-Host ""
Write-Host "Demo credentials:" -ForegroundColor Yellow
Write-Host "  Email: demo@example.com"
Write-Host "  Password: demo123456"
Write-Host ""
Write-Host "Happy coding!" -ForegroundColor Green
Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
