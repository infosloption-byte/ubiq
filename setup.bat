@echo off
REM Ubiq Platform - Windows Setup Script (Batch File)
REM Run this from Command Prompt (cmd.exe)

echo ================================
echo Ubiq Platform Setup Script
echo Windows Batch Version
echo ================================
echo.

REM Check if running from project root
if not exist "backend" (
    echo [ERROR] backend directory not found!
    echo Please run this script from the project root directory
    pause
    exit /b 1
)

echo [*] Starting setup process...
echo.

REM ===========================================
REM 1. BACKEND SETUP
REM ===========================================
echo ================================
echo Setting up Laravel Backend
echo ================================
echo.

cd backend

REM Create .env file
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo [OK] Created .env file
    ) else (
        echo [ERROR] .env.example not found!
        pause
        exit /b 1
    )
) else (
    echo [SKIP] .env already exists
)

REM Check for composer
where composer >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Composer not found!
    echo.
    echo Please install Composer from: https://getcomposer.org/download/
    echo.
    pause
    exit /b 1
)

REM Install dependencies
echo [*] Installing PHP dependencies...
call composer install --no-interaction
if %errorlevel% neq 0 (
    echo [ERROR] Composer install failed!
    pause
    exit /b 1
)

REM Generate key
echo [*] Generating application key...
call php artisan key:generate

REM Create storage directories
echo [*] Creating storage directories...
if not exist "storage\framework\sessions" mkdir "storage\framework\sessions"
if not exist "storage\framework\views" mkdir "storage\framework\views"
if not exist "storage\framework\cache" mkdir "storage\framework\cache"
if not exist "storage\logs" mkdir "storage\logs"
if not exist "bootstrap\cache" mkdir "bootstrap\cache"

REM Database setup
echo.
echo Select database type:
echo [1] SQLite (default)
echo [2] MySQL
echo.
set /p db_choice="Enter your choice (1 or 2) [default: 1]: "

if "%db_choice%"=="" set db_choice=1
if "%db_choice%"=="2" goto mysql_setup

REM SQLite setup
:sqlite_setup
echo.
echo [*] Setting up SQLite database...

REM Create database file
if not exist "database\database.sqlite" (
    type nul > "database\database.sqlite"
    echo [OK] Created database file
)

REM Update .env for SQLite (requires PowerShell)
powershell -Command "(Get-Content .env) -replace 'DB_CONNECTION=.*', 'DB_CONNECTION=sqlite' | Set-Content .env"

REM Run migrations
echo [*] Running migrations...
call php artisan migrate --force
if %errorlevel% neq 0 (
    echo [WARNING] Migration failed - you may need to configure database manually
)

REM Seed database
echo [*] Seeding database...
call php artisan db:seed --force

goto db_done

REM MySQL setup
:mysql_setup
echo.
echo [*] Setting up MySQL database...
echo.
echo Please enter your MySQL database credentials:
echo.

set /p db_host="Database Host [default: 127.0.0.1]: "
if "%db_host%"=="" set db_host=127.0.0.1

set /p db_port="Database Port [default: 3306]: "
if "%db_port%"=="" set db_port=3306

set /p db_name="Database Name [default: ubiq]: "
if "%db_name%"=="" set db_name=ubiq

set /p db_user="Database Username [default: root]: "
if "%db_user%"=="" set db_user=root

set /p db_pass="Database Password: "

echo.
echo [*] Updating .env file with MySQL configuration...

REM Update .env for MySQL
powershell -Command "$content = Get-Content .env; $content = $content -replace 'DB_CONNECTION=.*', 'DB_CONNECTION=mysql'; $content = $content -replace 'DB_HOST=.*', 'DB_HOST=%db_host%'; $content = $content -replace 'DB_PORT=.*', 'DB_PORT=%db_port%'; $content = $content -replace 'DB_DATABASE=.*', 'DB_DATABASE=%db_name%'; $content = $content -replace 'DB_USERNAME=.*', 'DB_USERNAME=%db_user%'; $content = $content -replace 'DB_PASSWORD=.*', 'DB_PASSWORD=%db_pass%'; $content | Set-Content .env"

echo [OK] Database configuration updated

echo.
echo [*] Testing database connection...
php artisan db:show
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Database connection failed!
    echo Please check your credentials and make sure:
    echo   1. MySQL server is running
    echo   2. Database '%db_name%' exists (create it if needed)
    echo   3. User '%db_user%' has access to the database
    echo.
    echo To create the database manually, run in MySQL:
    echo   CREATE DATABASE %db_name%;
    echo   GRANT ALL PRIVILEGES ON %db_name%.* TO '%db_user%'@'localhost';
    echo.
    pause
    goto db_done
)

echo [OK] Database connection successful!

echo.
echo [*] Running migrations...
call php artisan migrate --force
if %errorlevel% neq 0 (
    echo [ERROR] Migration failed!
    echo Please check the error messages above.
    pause
    goto db_done
)

echo [*] Seeding database...
call php artisan db:seed --force
if %errorlevel% neq 0 (
    echo [WARNING] Seeding failed - you may need to seed manually
)

:db_done
echo [OK] Database setup complete!

cd ..
echo [OK] Backend setup complete!
echo.

REM ===========================================
REM 2. FRONTEND SETUP
REM ===========================================
echo ================================
echo Setting up React Frontend
echo ================================
echo.

cd frontend

REM Create .env.local
if not exist ".env.local" (
    if exist ".env.example" (
        copy ".env.example" ".env.local" >nul
        echo [OK] Created .env.local file
    ) else (
        echo VITE_API_URL=http://localhost:8000/api/v1 > ".env.local"
        echo [OK] Created .env.local file
    )
) else (
    echo [SKIP] .env.local already exists
)

REM Check for npm
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] npm not found!
    echo.
    echo Please install Node.js from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM Install dependencies
echo [*] Installing Node.js dependencies (this may take several minutes)...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] npm install failed!
    pause
    exit /b 1
)

cd ..
echo [OK] Frontend setup complete!
echo.

REM ===========================================
REM 3. INFERENCE SERVER SETUP
REM ===========================================
echo ================================
echo Setting up Python Inference Server
echo ================================
echo.

cd inference-server

REM Create .env
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo [OK] Created .env file
    ) else (
        echo OLLAMA_HOST=http://localhost:11434 > ".env"
        echo [OK] Created .env file
    )
) else (
    echo [SKIP] .env already exists
)

REM Check for Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python not found!
    echo.
    echo Please install Python from: https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation
    echo.
    pause
    exit /b 1
)

REM Create virtual environment
if not exist "venv" (
    echo [*] Creating Python virtual environment...
    python -m venv venv
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create virtual environment!
        pause
        exit /b 1
    )
)

REM Install dependencies
echo [*] Installing Python dependencies...
call venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [ERROR] pip install failed!
    call deactivate
    pause
    exit /b 1
)
call deactivate

cd ..
echo [OK] Inference server setup complete!
echo.

REM ===========================================
REM 4. OLLAMA CHECK
REM ===========================================
echo ================================
echo Checking Ollama Installation
echo ================================
echo.

where ollama >nul 2>nul
if %errorlevel% neq 0 (
    echo [WARNING] Ollama is not installed!
    echo.
    echo Please install Ollama from: https://ollama.ai/download
    echo.
    echo After installation, run these commands:
    echo   ollama pull codellama:7b
    echo   ollama pull deepseek-coder:6.7b
    echo.
) else (
    echo [OK] Ollama is installed
)

REM ===========================================
REM SUMMARY
REM ===========================================
echo.
echo ================================
echo Setup Complete!
echo ================================
echo.
echo IMPORTANT: Make sure MySQL server is running before starting the backend!
echo.
echo To start the application, open 3 separate Command Prompt windows:
echo.
echo Terminal 1 - Backend:
echo   cd backend
echo   php artisan serve
echo.
echo Terminal 2 - Frontend:
echo   cd frontend
echo   npm run dev
echo.
echo Terminal 3 - Inference Server:
echo   cd inference-server
echo   venv\Scripts\activate
echo   python main.py
echo.
echo Then open in your browser: http://localhost:3000
echo.
echo Demo credentials:
echo   Email: demo@example.com
echo   Password: demo123456
echo.
echo NOTE: If using MySQL, ensure your MySQL server is running
echo       (WAMP/XAMPP MySQL service should be started)
echo.
echo Happy coding!
echo.
pause
