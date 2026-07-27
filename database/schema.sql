-- ============================================================
-- AI Coding Platform Database Schema
-- MySQL 5.7+ Compatible with InnoDB ROW_FORMAT=DYNAMIC
-- ============================================================

-- Set proper configurations for MySQL 5.7
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET sql_mode = 'NO_AUTO_VALUE_ON_ZERO';

-- Drop existing tables if they exist (for clean install)
DROP TABLE IF EXISTS model_metrics;
DROP TABLE IF EXISTS available_models;
DROP TABLE IF EXISTS rate_limits;
DROP TABLE IF EXISTS usage_logs;
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS chat_sessions;
DROP TABLE IF EXISTS files;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS user_preferences;
DROP TABLE IF EXISTS personal_access_tokens;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- USERS TABLE
-- ============================================================
CREATE TABLE users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(191) NOT NULL,
    username VARCHAR(100) NOT NULL,
    password VARCHAR(255) NOT NULL,
    google_id VARCHAR(255) DEFAULT NULL,
    avatar VARCHAR(500) DEFAULT NULL,
    subscription_tier ENUM('free', 'pro') DEFAULT 'free' NOT NULL,
    api_key VARCHAR(100) DEFAULT NULL,
    email_verified_at TIMESTAMP NULL DEFAULT NULL,
    remember_token VARCHAR(100) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_email (email),
    UNIQUE KEY unique_username (username),
    UNIQUE KEY unique_api_key (api_key),
    UNIQUE KEY unique_google_id (google_id),
    KEY idx_email (email),
    KEY idx_username (username),
    KEY idx_subscription (subscription_tier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ============================================================
-- USER PREFERENCES TABLE
-- ============================================================
CREATE TABLE user_preferences (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    preferred_model VARCHAR(100) DEFAULT 'codellama:7b',
    theme VARCHAR(50) DEFAULT 'dark',
    editor_settings TEXT DEFAULT NULL,
    auto_complete TINYINT(1) DEFAULT 1,
    code_suggestions TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_user (user_id),
    KEY fk_user_preferences_user (user_id),
    CONSTRAINT fk_user_preferences_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ============================================================
-- PROJECTS TABLE
-- ============================================================
CREATE TABLE projects (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(191) NOT NULL,
    description TEXT DEFAULT NULL,
    language VARCHAR(50) DEFAULT NULL,
    visibility ENUM('private', 'public') DEFAULT 'private' NOT NULL,
    is_archived TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    KEY idx_user_projects (user_id, created_at),
    KEY idx_visibility (visibility),
    KEY idx_language (language),
    KEY fk_projects_user (user_id),
    CONSTRAINT fk_projects_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ============================================================
-- FILES TABLE
-- ============================================================
CREATE TABLE files (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    project_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(191) NOT NULL,
    path VARCHAR(400) NOT NULL,
    content LONGTEXT DEFAULT NULL,
    language VARCHAR(50) DEFAULT NULL,
    size_bytes INT UNSIGNED DEFAULT 0,
    is_deleted TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    KEY idx_project_files (project_id, is_deleted),
    KEY idx_language (language),
    KEY fk_files_project (project_id),
    CONSTRAINT fk_files_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ============================================================
-- CHAT SESSIONS TABLE
-- ============================================================
CREATE TABLE chat_sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED DEFAULT NULL,
    title VARCHAR(191) DEFAULT 'New Chat',
    model_used VARCHAR(100) DEFAULT NULL,
    is_archived TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    KEY idx_user_chats (user_id, created_at),
    KEY idx_project_chats (project_id),
    KEY fk_chat_sessions_user (user_id),
    KEY fk_chat_sessions_project (project_id),
    CONSTRAINT fk_chat_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_chat_sessions_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ============================================================
-- CHAT MESSAGES TABLE
-- ============================================================
CREATE TABLE chat_messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT UNSIGNED NOT NULL,
    role ENUM('user', 'assistant', 'system') NOT NULL,
    content TEXT NOT NULL,
    code_context TEXT DEFAULT NULL,
    tokens_used INT UNSIGNED DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    KEY idx_session_messages (session_id, created_at),
    KEY idx_role (role),
    KEY fk_chat_messages_session (session_id),
    CONSTRAINT fk_chat_messages_session FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ============================================================
-- USAGE LOGS TABLE
-- ============================================================
CREATE TABLE usage_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    request_type VARCHAR(50) DEFAULT NULL,
    model_used VARCHAR(100) DEFAULT NULL,
    tokens_input INT UNSIGNED DEFAULT 0,
    tokens_output INT UNSIGNED DEFAULT 0,
    latency_ms INT UNSIGNED DEFAULT 0,
    success TINYINT(1) DEFAULT 1,
    error_message TEXT DEFAULT NULL,
    ip_address VARCHAR(45) DEFAULT NULL,
    user_agent VARCHAR(191) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    KEY idx_user_usage (user_id, created_at),
    KEY idx_usage_date (created_at),
    KEY idx_request_type (request_type),
    KEY idx_model_used (model_used),
    KEY idx_success (success),
    KEY fk_usage_logs_user (user_id),
    CONSTRAINT fk_usage_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ============================================================
-- RATE LIMITS TABLE
-- ============================================================
CREATE TABLE rate_limits (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    request_count INT UNSIGNED DEFAULT 0,
    window_start TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    window_end TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    KEY idx_user_rate_limit (user_id, window_end),
    KEY idx_window_end (window_end),
    KEY fk_rate_limits_user (user_id),
    CONSTRAINT fk_rate_limits_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ============================================================
-- AVAILABLE MODELS TABLE
-- ============================================================
CREATE TABLE available_models (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    display_name VARCHAR(191) NOT NULL,
    model_type VARCHAR(50) DEFAULT 'both',
    size VARCHAR(20) DEFAULT NULL,
    context_window INT UNSIGNED DEFAULT 4096,
    is_active TINYINT(1) DEFAULT 1,
    tier_required ENUM('free', 'pro') DEFAULT 'free' NOT NULL,
    description TEXT DEFAULT NULL,
    parameters_count VARCHAR(20) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_model_name (name),
    KEY idx_is_active (is_active),
    KEY idx_tier (tier_required)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ============================================================
-- MODEL METRICS TABLE
-- ============================================================
CREATE TABLE model_metrics (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    model_name VARCHAR(100) NOT NULL,
    avg_latency_ms DECIMAL(10,2) DEFAULT 0.00,
    success_rate DECIMAL(5,2) DEFAULT 0.00,
    total_requests BIGINT UNSIGNED DEFAULT 0,
    total_tokens BIGINT UNSIGNED DEFAULT 0,
    date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_model_date (model_name, date),
    KEY idx_model_metrics (model_name, date),
    KEY idx_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ============================================================
-- PERSONAL ACCESS TOKENS TABLE (for Laravel Sanctum)
-- ============================================================
CREATE TABLE personal_access_tokens (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tokenable_type VARCHAR(191) NOT NULL,
    tokenable_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(191) NOT NULL,
    token VARCHAR(64) NOT NULL,
    abilities TEXT DEFAULT NULL,
    last_used_at TIMESTAMP NULL DEFAULT NULL,
    expires_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_token (token),
    KEY idx_tokenable (tokenable_type, tokenable_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;

-- ============================================================
-- SUCCESS MESSAGE
-- ============================================================
SELECT 'Database schema created successfully!' as Status;
SELECT 'Total tables created: 11' as Info;
SELECT 'MySQL 5.7+ Compatible' as Compatibility;