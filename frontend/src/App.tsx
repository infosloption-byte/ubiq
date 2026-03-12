import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';

// --- COMPONENTS ---
import { SubscriptionGuard } from './components/SubscriptionGuard';

// --- PAGES ---
import LandingPage from './pages/LandingPage';
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
import TermsOfService from './pages/TermsOfService';
import PrivacyPolicy from './pages/PrivacyPolicy';
import RefundPolicy from './pages/RefundPolicy';

function App() {
  const { token } = useAuthStore();

  return (
    <Router>
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/" element={<LandingPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />

        <Route path="/terms" element={<TermsOfService />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/refund" element={<RefundPolicy />} />

        {/* Public routes */}
        <Route 
          path="/login" 
          element={!token ? <LoginPage /> : <Navigate to="/dashboard" />} 
        />
        <Route 
          path="/register" 
          element={!token ? <RegisterPage /> : <Navigate to="/dashboard" />} 
        />

        {/* Protected routes - NO GUARD */}
        <Route 
          path="/dashboard" 
          element={token ? <DashboardPage /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/settings" 
          element={token ? <SettingsPage /> : <Navigate to="/login" />} 
        />

        {/* Protected routes - WITH SUBSCRIPTION GUARD */}
        <Route 
          path="/chat" 
          element={token ? <SubscriptionGuard><ChatPage /></SubscriptionGuard> : <Navigate to="/login" />} 
        />
        <Route 
          path="/chat/:sessionId" 
          element={token ? <SubscriptionGuard><ChatPage /></SubscriptionGuard> : <Navigate to="/login" />} 
        />

        <Route 
            path="/projects" 
            element={token ? <SubscriptionGuard><ProjectsPage /></SubscriptionGuard> : <Navigate to="/login" />} 
        />
        
        <Route 
            path="/projects/:id" 
            element={token ? <SubscriptionGuard><ProjectInfoPage /></SubscriptionGuard> : <Navigate to="/login" />} 
        />
        
        <Route 
            path="/editor/:id" 
            element={token ? <SubscriptionGuard><ProjectEditorPage /></SubscriptionGuard> : <Navigate to="/login" />} 
        />

        <Route 
          path="/legacy-editor" 
          element={token ? <SubscriptionGuard><EditorPage /></SubscriptionGuard> : <Navigate to="/login" />} 
        />
        
        <Route 
          path="*" 
          element={<Navigate to="/" />} 
        />
      </Routes>
    </Router>
  );
}

export default App;