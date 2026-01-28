-- ============================================================
-- AI Coding Platform Database Seed Data
-- MySQL 5.7+ Compatible with Fixed Index Sizes
-- This file populates the database with initial data
-- ============================================================

-- Set proper configurations
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET sql_mode = 'NO_AUTO_VALUE_ON_ZERO';

-- Clear existing data (optional - comment out if you want to keep existing data)
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE model_metrics;
TRUNCATE TABLE available_models;
TRUNCATE TABLE rate_limits;
TRUNCATE TABLE usage_logs;
TRUNCATE TABLE chat_messages;
TRUNCATE TABLE chat_sessions;
TRUNCATE TABLE files;
TRUNCATE TABLE projects;
TRUNCATE TABLE user_preferences;
TRUNCATE TABLE personal_access_tokens;
TRUNCATE TABLE users;
SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- SEED AVAILABLE MODELS
-- ============================================================
INSERT INTO available_models (
    name, 
    display_name, 
    model_type, 
    size, 
    context_window, 
    is_active, 
    tier_required, 
    description,
    parameters_count
) VALUES
-- Free tier models
(
    'codellama:7b',
    'CodeLlama 7B',
    'both',
    '7b',
    4096,
    1,
    'free',
    'Fast and efficient code generation model by Meta. Great for code completion, chat, and basic code review.',
    '7 billion'
),
(
    'deepseek-coder:6.7b',
    'DeepSeek Coder 6.7B',
    'both',
    '6.7b',
    4096,
    1,
    'free',
    'Excellent performance with very efficient resource usage. Trained specifically for coding tasks across multiple languages.',
    '6.7 billion'
),
(
    'starcoder2:7b',
    'StarCoder2 7B',
    'both',
    '7b',
    4096,
    1,
    'free',
    'Strong multi-language support with focus on code completion. Developed by BigCode project.',
    '7 billion'
),
(
    'starcoder2:3b',
    'StarCoder2 3B',
    'both',
    '3b',
    4096,
    1,
    'free',
    'Lightweight version of StarCoder2, faster inference with good quality for basic tasks.',
    '3 billion'
),

-- Premium tier models
(
    'codellama:13b',
    'CodeLlama 13B',
    'both',
    '13b',
    4096,
    1,
    'premium',
    'More capable code generation with better understanding of complex code patterns and requirements.',
    '13 billion'
),
(
    'codellama:34b',
    'CodeLlama 34B',
    'both',
    '34b',
    4096,
    1,
    'premium',
    'Most powerful CodeLlama model. Excellent for complex code generation, refactoring, and detailed explanations.',
    '34 billion'
),
(
    'qwen-coder:7b',
    'Qwen Coder 7B',
    'both',
    '7b',
    8192,
    1,
    'premium',
    'Good balance of size and capability with extended context window. Strong in Asian languages as well.',
    '7 billion'
),
(
    'deepseek-coder:33b',
    'DeepSeek Coder 33B',
    'both',
    '33b',
    4096,
    1,
    'premium',
    'Large, highly capable model with exceptional code understanding and generation capabilities.',
    '33 billion'
),
(
    'starcoder2:15b',
    'StarCoder2 15B',
    'both',
    '15b',
    4096,
    1,
    'premium',
    'Larger StarCoder2 variant with improved accuracy and better handling of complex coding scenarios.',
    '15 billion'
);

-- ============================================================
-- SEED DEMO USERS
-- ============================================================

-- Demo User 1: Free tier
-- Email: demo@example.com
-- Password: demo123456
-- (Password hash generated with bcrypt, cost 10)
INSERT INTO users (
    email,
    username,
    password,
    subscription_tier,
    api_key,
    email_verified_at
) VALUES (
    'demo@example.com',
    'demo',
    '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'free',
    'demo_api_key_1234567890abcdef',
    NOW()
);

SET @demo_user_id = LAST_INSERT_ID();

-- Demo User 2: Premium tier
-- Email: premium@example.com
-- Password: premium123
INSERT INTO users (
    email,
    username,
    password,
    subscription_tier,
    api_key,
    email_verified_at
) VALUES (
    'premium@example.com',
    'premium_user',
    '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'premium',
    'premium_api_key_0987654321fedcba',
    NOW()
);

SET @premium_user_id = LAST_INSERT_ID();

-- Demo User 3: Developer account
-- Email: developer@example.com
-- Password: dev123456
INSERT INTO users (
    email,
    username,
    password,
    subscription_tier,
    api_key,
    email_verified_at
) VALUES (
    'developer@example.com',
    'developer',
    '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'free',
    'dev_api_key_abcdef1234567890',
    NOW()
);

SET @dev_user_id = LAST_INSERT_ID();

-- ============================================================
-- SEED USER PREFERENCES
-- ============================================================

-- Preferences for demo user
INSERT INTO user_preferences (
    user_id,
    preferred_model,
    theme,
    editor_settings,
    auto_complete,
    code_suggestions
) VALUES (
    @demo_user_id,
    'codellama:7b',
    'dark',
    '{"fontSize":14,"tabSize":4,"wordWrap":"on","minimap":{"enabled":false},"lineNumbers":"on","formatOnSave":true}',
    1,
    1
);

-- Preferences for premium user
INSERT INTO user_preferences (
    user_id,
    preferred_model,
    theme,
    editor_settings,
    auto_complete,
    code_suggestions
) VALUES (
    @premium_user_id,
    'codellama:34b',
    'dark',
    '{"fontSize":15,"tabSize":2,"wordWrap":"on","minimap":{"enabled":true},"lineNumbers":"on","formatOnSave":true}',
    1,
    1
);

-- Preferences for developer
INSERT INTO user_preferences (
    user_id,
    preferred_model,
    theme,
    editor_settings,
    auto_complete,
    code_suggestions
) VALUES (
    @dev_user_id,
    'deepseek-coder:6.7b',
    'light',
    '{"fontSize":13,"tabSize":4,"wordWrap":"off","minimap":{"enabled":false},"lineNumbers":"on","formatOnSave":false}',
    1,
    1
);

-- ============================================================
-- SEED SAMPLE PROJECTS
-- ============================================================

-- Project 1: Python Web App
INSERT INTO projects (
    user_id,
    name,
    description,
    language,
    visibility
) VALUES (
    @demo_user_id,
    'Python Web App',
    'A Flask-based web application for task management',
    'python',
    'private'
);

SET @project_python = LAST_INSERT_ID();

-- Project 2: JavaScript Game
INSERT INTO projects (
    user_id,
    name,
    description,
    language,
    visibility
) VALUES (
    @demo_user_id,
    'JavaScript Game',
    'Simple 2D game using HTML5 Canvas',
    'javascript',
    'public'
);

SET @project_js = LAST_INSERT_ID();

-- Project 3: React Dashboard
INSERT INTO projects (
    user_id,
    name,
    description,
    language,
    visibility
) VALUES (
    @premium_user_id,
    'React Dashboard',
    'Admin dashboard with data visualization',
    'typescript',
    'private'
);

SET @project_react = LAST_INSERT_ID();

-- Project 4: REST API
INSERT INTO projects (
    user_id,
    name,
    description,
    language,
    visibility
) VALUES (
    @dev_user_id,
    'REST API Service',
    'Node.js REST API with Express and MongoDB',
    'javascript',
    'private'
);

SET @project_api = LAST_INSERT_ID();

-- ============================================================
-- SEED SAMPLE FILES
-- ============================================================

-- Files for Python Web App
INSERT INTO files (project_id, name, path, content, language, size_bytes) VALUES
(@project_python, 'app.py', 'app.py', 'from flask import Flask, render_template

app = Flask(__name__)

@app.route("/")
def home():
    return render_template("index.html")

if __name__ == "__main__":
    app.run(debug=True)', 'python', 185),

(@project_python, 'models.py', 'models.py', 'from datetime import datetime

class Task:
    def __init__(self, title, description):
        self.title = title
        self.description = description
        self.created_at = datetime.now()
        self.completed = False
        
    def complete(self):
        self.completed = True
        return self', 'python', 225),

(@project_python, 'requirements.txt', 'requirements.txt', 'Flask==2.3.0
Flask-SQLAlchemy==3.0.3
Flask-Login==0.6.2
python-dotenv==1.0.0', 'text', 89);

-- Files for JavaScript Game
INSERT INTO files (project_id, name, path, content, language, size_bytes) VALUES
(@project_js, 'game.js', 'game.js', 'const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

let player = {
    x: 50,
    y: 50,
    width: 30,
    height: 30,
    speed: 5
};

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "blue";
    ctx.fillRect(player.x, player.y, player.width, player.height);
    requestAnimationFrame(gameLoop);
}

gameLoop();', 'javascript', 330),

(@project_js, 'index.html', 'index.html', '<!DOCTYPE html>
<html>
<head>
    <title>Simple Game</title>
    <style>
        canvas { border: 1px solid black; }
    </style>
</head>
<body>
    <canvas id="gameCanvas" width="800" height="600"></canvas>
    <script src="game.js"></script>
</body>
</html>', 'html', 280),

(@project_js, 'style.css', 'style.css', 'body {
    margin: 0;
    padding: 20px;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    background: #f0f0f0;
    font-family: Arial, sans-serif;
}

canvas {
    background: white;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
}', 'css', 245);

-- Files for React Dashboard
INSERT INTO files (project_id, name, path, content, language, size_bytes) VALUES
(@project_react, 'App.tsx', 'src/App.tsx', 'import React from "react";
import Dashboard from "./components/Dashboard";

function App() {
  return (
    <div className="App">
      <Dashboard />
    </div>
  );
}

export default App;', 'typescript', 165),

(@project_react, 'Dashboard.tsx', 'src/components/Dashboard.tsx', 'import React from "react";

interface DashboardProps {
  title?: string;
}

const Dashboard: React.FC<DashboardProps> = ({ title = "Dashboard" }) => {
  return (
    <div className="dashboard">
      <h1>{title}</h1>
      <div className="stats">
        <div className="stat-card">
          <h3>Users</h3>
          <p>1,234</p>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;', 'typescript', 345),

(@project_react, 'package.json', 'package.json', '{
  "name": "react-dashboard",
  "version": "1.0.0",
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "typescript": "^5.0.0"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build"
  }
}', 'json', 245);

-- Files for REST API
INSERT INTO files (project_id, name, path, content, language, size_bytes) VALUES
(@project_api, 'server.js', 'server.js', 'const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});', 'javascript', 290),

(@project_api, 'routes.js', 'routes.js', 'const express = require("express");
const router = express.Router();

router.get("/users", async (req, res) => {
  res.json({ users: [] });
});

router.post("/users", async (req, res) => {
  const user = req.body;
  res.status(201).json(user);
});

module.exports = router;', 'javascript', 265),

(@project_api, 'package.json', 'package.json', '{
  "name": "rest-api",
  "version": "1.0.0",
  "main": "server.js",
  "dependencies": {
    "express": "^4.18.2",
    "mongodb": "^5.0.0",
    "dotenv": "^16.0.3"
  },
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  }
}', 'json', 265);

-- ============================================================
-- SEED SAMPLE CHAT SESSIONS
-- ============================================================

-- Chat session 1
INSERT INTO chat_sessions (user_id, project_id, title, model_used) VALUES
(@demo_user_id, @project_python, 'Help with Flask routing', 'codellama:7b');

SET @chat_session_1 = LAST_INSERT_ID();

-- Chat messages for session 1
INSERT INTO chat_messages (session_id, role, content, tokens_used) VALUES
(@chat_session_1, 'user', 'How do I add a POST route in Flask?', 12),
(@chat_session_1, 'assistant', 'To add a POST route in Flask, use the @app.route decorator with methods parameter:

```python
@app.route("/submit", methods=["POST"])
def submit_form():
    data = request.json
    return {"message": "Data received"}, 200
```

Make sure to import request from flask.', 65);

-- Chat session 2
INSERT INTO chat_sessions (user_id, project_id, title, model_used) VALUES
(@premium_user_id, @project_react, 'TypeScript type definitions', 'codellama:34b');

SET @chat_session_2 = LAST_INSERT_ID();

-- Chat messages for session 2
INSERT INTO chat_messages (session_id, role, content, tokens_used) VALUES
(@chat_session_2, 'user', 'How do I define props with TypeScript?', 11),
(@chat_session_2, 'assistant', 'In TypeScript with React, define props using an interface:

```typescript
interface Props {
  name: string;
  age?: number; // Optional
  onSubmit: (data: FormData) => void;
}

const MyComponent: React.FC<Props> = ({ name, age, onSubmit }) => {
  return <div>Hello {name}</div>;
};
```', 95);

-- ============================================================
-- SEED USAGE LOGS (Sample data for analytics)
-- ============================================================

INSERT INTO usage_logs (user_id, request_type, model_used, tokens_input, tokens_output, latency_ms, success) VALUES
(@demo_user_id, 'completion', 'codellama:7b', 45, 120, 850, 1),
(@demo_user_id, 'completion', 'codellama:7b', 38, 95, 720, 1),
(@demo_user_id, 'chat', 'codellama:7b', 25, 180, 1200, 1),
(@premium_user_id, 'completion', 'codellama:34b', 60, 250, 2100, 1),
(@premium_user_id, 'chat', 'codellama:34b', 40, 320, 2800, 1),
(@dev_user_id, 'completion', 'deepseek-coder:6.7b', 50, 140, 950, 1),
(@dev_user_id, 'completion', 'deepseek-coder:6.7b', 42, 110, 800, 1);

-- ============================================================
-- SEED MODEL METRICS
-- ============================================================

INSERT INTO model_metrics (model_name, avg_latency_ms, success_rate, total_requests, total_tokens, date) VALUES
('codellama:7b', 850.50, 98.50, 150, 45000, CURDATE()),
('deepseek-coder:6.7b', 780.25, 99.20, 120, 38000, CURDATE()),
('starcoder2:7b', 920.75, 97.80, 95, 32000, CURDATE()),
('codellama:34b', 2200.00, 99.50, 45, 28000, CURDATE());

-- ============================================================
-- SUCCESS MESSAGE
-- ============================================================
SELECT 'Database seeded successfully!' as Status;
SELECT CONCAT('Created ', COUNT(*), ' users') as Info FROM users;
SELECT CONCAT('Created ', COUNT(*), ' projects') as Info FROM projects;
SELECT CONCAT('Created ', COUNT(*), ' files') as Info FROM files;
SELECT CONCAT('Loaded ', COUNT(*), ' AI models') as Info FROM available_models;