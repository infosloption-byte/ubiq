import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import EditorPage from './pages/EditorPage';
import ChatPage from './pages/ChatPage';
import SettingsPage from './pages/SettingsPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectEditorPage from './pages/ProjectEditorPage';

function App() {
  const { token } = useAuthStore();

  return (
    <Router>
      <Routes>
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
        <Route 
          path="/editor" 
          element={token ? <EditorPage /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/editor/:projectId" 
          element={token ? <EditorPage /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/chat" 
          element={token ? <ChatPage /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/settings" 
          element={token ? <SettingsPage /> : <Navigate to="/login" />} 
        />

        {/* Default redirect */}
        <Route 
          path="/" 
          element={<Navigate to={token ? "/dashboard" : "/login"} />} 
        />

        {/* Project Routes */}
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectEditorPage />} />
        
        {/* 404 */}
        <Route 
          path="*" 
          element={<Navigate to="/" />} 
        />
      </Routes>
    </Router>
  );
}

export default App;
