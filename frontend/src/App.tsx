import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';

import { SubscriptionGuard } from './components/SubscriptionGuard';
import PlanLimitModal from './components/PlanLimitModal';

import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

const DashboardPage    = lazy(() => import('./pages/DashboardPage'));
const ChatPage         = lazy(() => import('./pages/ChatPage'));
const SettingsPage     = lazy(() => import('./pages/SettingsPage'));
const ProjectsPage     = lazy(() => import('./pages/ProjectsPage'));
const SandboxesPage    = lazy(() => import('./pages/SandboxesPage'));
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
    const { token, user } = useAuthStore();

    return (
        <Router>
            <Suspense fallback={<PageLoader />}>
                <Routes>
                    {/* Public routes */}
                    <Route path="/" element={<LandingPage />} />
                    <Route path="/guide" element={<GuidePage />} />
                    <Route path="/auth/callback" element={<AuthCallbackPage />} />
                    <Route path="/terms" element={<TermsOfService />} />
                    <Route path="/privacy" element={<PrivacyPolicy />} />
                    <Route path="/refund" element={<RefundPolicy />} />

                    {/* FIX: Admin route now requires token AND is_admin flag.
                        Previously this was an open route — any visitor could reach the page.
                        The backend API calls would fail (correctly) but the page itself rendered,
                        which is bad UX and leaks error details in the network tab.
                        is_admin was also missing from the User type in authStore — fixed there too. */}
                    <Route
                        path="/admin"
                        element={token && user?.is_admin ? <AdminPage /> : <Navigate to="/dashboard" />}
                    />

                    <Route
                        path="/login"
                        element={!token ? <LoginPage /> : <Navigate to="/dashboard" />}
                    />
                    <Route
                        path="/register"
                        element={!token ? <RegisterPage /> : <Navigate to="/dashboard" />}
                    />

                    {/* Protected — no subscription guard */}
                    <Route
                        path="/dashboard"
                        element={token ? <DashboardPage /> : <Navigate to="/login" />}
                    />
                    <Route
                        path="/settings"
                        element={token ? <SettingsPage /> : <Navigate to="/login" />}
                    />

                    {/* Protected — with subscription guard */}
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
                        path="/sandboxes"
                        element={token ? <SubscriptionGuard><SandboxesPage /></SubscriptionGuard> : <Navigate to="/login" />}
                    />
                    <Route
                        path="/editor/:id"
                        element={token ? <SubscriptionGuard><ProjectEditorPage /></SubscriptionGuard> : <Navigate to="/login" />}
                    />

                    <Route path="*" element={<Navigate to="/" />} />
                </Routes>
            </Suspense>
            <PlanLimitModal />
        </Router>
    );
}

export default App;