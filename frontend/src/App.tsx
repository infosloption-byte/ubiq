import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';

// --- COMPONENTS ---
import { SubscriptionGuard } from './components/SubscriptionGuard';

// --- PAGES (lazy-loaded for code splitting) ---
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

const DashboardPage    = lazy(() => import('./pages/DashboardPage'));
const EditorPage       = lazy(() => import('./pages/EditorPage'));
const ChatPage         = lazy(() => import('./pages/ChatPage'));
const SettingsPage     = lazy(() => import('./pages/SettingsPage'));
const ProjectsPage     = lazy(() => import('./pages/ProjectsPage'));
const ProjectEditorPage = lazy(() => import('./pages/ProjectEditorPage'));
const ProjectInfoPage  = lazy(() => import('./pages/ProjectInfoPage'));
const AuthCallbackPage = lazy(() => import('./pages/AuthCallbackPage'));
const GuidePage        = lazy(() => import('./pages/GuidePage'));
const AdminPage        = lazy(() => import('./pages/AdminPage'));
const TermsOfService   = lazy(() => import('./pages/TermsOfService'));
const PrivacyPolicy    = lazy(() => import('./pages/PrivacyPolicy'));
const RefundPolicy     = lazy(() => import('./pages/RefundPolicy'));

const PageLoader = () => (
  <div className="flex items-center justify-center h-screen bg-ubiq-950">
    <div className="w-8 h-8 border-2 border-ubiq-accent border-t-transparent rounded-full animate-spin" />
  </div>
);

function App() {
  const { token } = useAuthStore();

  return (
    <Router>
      <Suspense fallback={<PageLoader />}>
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
      </Suspense>
    </Router>
  );
}

export default App;