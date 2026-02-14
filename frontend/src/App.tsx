import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';

// --- PAGES ---
import LandingPage from './pages/LandingPage'; // <--- Import Landing Page
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import EditorPage from './pages/EditorPage'; 
import ChatPage from './pages/ChatPage';
import SettingsPage from './pages/SettingsPage';
import ProjectsPage from './pages/ProjectsPage'; 
import ProjectEditorPage from './pages/ProjectEditorPage'; 
import ProjectInfoPage from './pages/ProjectInfoPage'; 
import AuthCallbackPage from './pages/AuthCallbackPage';
import GuidePage from './pages/GuidePage';
import AdminPage from './pages/AdminPage';

function App() {
  const { token } = useAuthStore();

  return (
    <Router>
      <Routes>
        
        <Route path="/admin" element={
            // Simple check: if not logged in, it will fail API calls anyway. 
            // Ideally wrap in a <AdminRoute> component, but standard <Route> works if backend returns 403.
            <AdminPage />
        } />

        {/* --- ROOT ROUTE (LANDING PAGE) --- */}
        <Route path="/" element={<LandingPage />} />

        <Route path="/guide" element={<GuidePage />} />

        <Route path="/auth/callback" element={<AuthCallbackPage />} />

        {/* Public routes */}
        <Route 
          path="/login" 
          element={!token ? <LoginPage /> : <Navigate to="/dashboard" />} 
        />
        <Route 
          path="/register" 
          element={!token ? <RegisterPage /> : <Navigate to="/dashboard" />} 
        />

        {/* Protected routes */}
        <Route 
          path="/dashboard" 
          element={token ? <DashboardPage /> : <Navigate to="/login" />} 
        />
        
        {/* Legacy Editor */}
        <Route 
          path="/legacy-editor" 
          element={token ? <EditorPage /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/legacy-editor/:projectId" 
          element={token ? <EditorPage /> : <Navigate to="/login" />} 
        />

        {/* --- CHAT ROUTES --- */}
        <Route 
          path="/chat" 
          element={token ? <ChatPage /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/chat/:sessionId" 
          element={token ? <ChatPage /> : <Navigate to="/login" />} 
        />

        <Route 
          path="/settings" 
          element={token ? <SettingsPage /> : <Navigate to="/login" />} 
        />

        {/* --- NEW PROJECT ROUTES --- */}
        <Route 
            path="/projects" 
            element={token ? <ProjectsPage /> : <Navigate to="/login" />} 
        />
        
        <Route 
            path="/projects/:id" 
            element={token ? <ProjectInfoPage /> : <Navigate to="/login" />} 
        />
        
        <Route 
            path="/editor/:id" 
            element={token ? <ProjectEditorPage /> : <Navigate to="/login" />} 
        />
        
        {/* 404 - Redirect to Landing Page */}
        <Route 
          path="*" 
          element={<Navigate to="/" />} 
        />
      </Routes>
    </Router>
  );
}

export default App;