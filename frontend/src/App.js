import "@/App.css";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import AuthGate from "@/components/AuthGate";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/sonner";
import MobileAlertTray from "@/components/MobileAlertTray";
import DesktopAlertInbox from "@/components/DesktopAlertInbox";
import PwaNotifyPrompt from "@/components/PwaNotifyPrompt";
import MaintenanceScreen from "@/components/MaintenanceScreen";
import DataLoadingState from "@/components/DataLoadingState";
import { installDeskErrorLog } from "@/lib/errorLog";
import { api } from "@/lib/api";
import { loadPublicEntryAuthState } from "@/lib/authBoot";
import { isSiteWalkthroughPath } from "@/lib/siteWalkthroughApi";
import { captureMembershipAttribution } from "@/lib/membershipAttribution";

const Landing = lazy(() => import("@/pages/Landing"));
const SiteWalkthrough = lazy(() => import("@/pages/SiteWalkthrough"));
const Login = lazy(() => import("@/pages/Login"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const AdminLogin = lazy(() => import("@/pages/AdminLogin"));
const AdminSettings = lazy(() => import("@/pages/AdminSettings"));
const AdminLandingPage = lazy(() => import("@/pages/AdminLandingPage"));
const AdminSubscriptions = lazy(() => import("@/pages/AdminSubscriptions"));
const AdminMembershipAnalytics = lazy(() => import("@/pages/AdminMembershipAnalytics"));
const PublicLegalPage = lazy(() => import("@/pages/PublicLegalPage"));
const AccountSettings = lazy(() => import("@/pages/AccountSettings"));
const MemberJournal = lazy(() => import("@/pages/MemberJournal"));
const KiteCallback = lazy(() => import("@/pages/KiteCallback"));
const AboutAppModal = lazy(() => import("@/components/AboutAppModal"));

function BootFallback() {
  return <DataLoadingState />;
}

function PublicEntry() {
  const [showLanding, setShowLanding] = useState(false);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [walkthroughEnabled, setWalkthroughEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [authUnavailable, setAuthUnavailable] = useState(false);

  const loadState = useCallback(() => {
    setLoading(true);
    setAuthUnavailable(false);
    // Keep a stalled auth API from trapping the public entry on its boot spinner.
    return loadPublicEntryAuthState(api)
      .then(({ data }) => {
        setShowLanding(!!data?.public_landing_enabled);
        setMaintenanceMode(!!data?.maintenance_mode);
        setIsAdmin(!!data?.is_admin);
        setWalkthroughEnabled(data?.sitewalkthrough_enabled !== false);
      })
      .catch(() => {
        setAuthUnavailable(true);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  if (loading) return <BootFallback />;
  if (authUnavailable) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-5 text-center text-white">
        <section className="max-w-md rounded-2xl border border-white/10 bg-white/5 p-7">
          <h1 className="text-xl font-bold">StrikLenz is taking longer to connect</h1>
          <p className="mt-2 text-sm text-slate-300">The app could not reach its access service. Check that the backend is running, then retry.</p>
          <div className="mt-5 flex justify-center gap-3">
            <button type="button" onClick={loadState} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950">
              Retry
            </button>
            <a href="/login" className="rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white">
              Sign in
            </a>
          </div>
        </section>
      </main>
    );
  }
  if (maintenanceMode && !isAdmin) {
    return <MaintenanceScreen retrying={loading} onRetry={loadState} />;
  }
  return showLanding ? <Landing walkthroughEnabled={walkthroughEnabled} /> : <AdminLogin />;
}

function AppRoutes({ isAdminHost }) {
  const location = useLocation();
  const isWalkthrough = isSiteWalkthroughPath();

  useEffect(() => {
    if (!isWalkthrough) installDeskErrorLog();
  }, [isWalkthrough]);

  return (
    <>
      <Suspense fallback={<BootFallback />}>
        <Routes>
          {isAdminHost ? (
            <>
              <Route path="/sitewalkthrough" element={<SiteWalkthrough />} />
              <Route path="/legal/:document" element={<PublicLegalPage />} />
              <Route path="/" element={<AdminLogin />} />
              <Route path="/admin" element={<AdminLogin />} />
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin/settings" element={<AdminSettings />} />
              <Route path="/admin/settings/landingpage" element={<AdminLandingPage />} />
              <Route path="/admin/subscriptions" element={<AdminSubscriptions />} />
              <Route path="/admin/membership-analytics" element={<AdminMembershipAnalytics />} />
              <Route path="/kite-callback" element={<KiteCallback />} />
              <Route path="/account" element={<AuthGate><AccountSettings /></AuthGate>} />
              <Route path="/account/journal" element={<AuthGate><MemberJournal /></AuthGate>} />
              <Route
                path="/dashboard/*"
                element={
                  <AuthGate>
                    <Dashboard />
                  </AuthGate>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          ) : (
            <>
              <Route path="/sitewalkthrough" element={<SiteWalkthrough />} />
              <Route path="/legal/:document" element={<PublicLegalPage />} />
              <Route path="/" element={<PublicEntry />} />
              <Route path="/login" element={<Login />} />
              <Route path="/admin" element={<AdminLogin />} />
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin/settings" element={<AdminSettings />} />
              <Route path="/admin/settings/landingpage" element={<AdminLandingPage />} />
              <Route path="/admin/subscriptions" element={<AdminSubscriptions />} />
              <Route path="/admin/membership-analytics" element={<AdminMembershipAnalytics />} />
              <Route path="/account" element={<AuthGate><AccountSettings /></AuthGate>} />
              <Route path="/account/journal" element={<AuthGate><MemberJournal /></AuthGate>} />
              <Route path="/kite-callback" element={<KiteCallback />} />
              <Route
                path="/dashboard/*"
                element={
                  <AuthGate>
                    <Dashboard />
                  </AuthGate>
                }
              />
              <Route path="/terminal/*" element={<Navigate to="/dashboard" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Routes>
      </Suspense>
      {!isWalkthrough ? (
        <>
          <Suspense fallback={null}>
            <AboutAppModal />
          </Suspense>
          <Toaster />
          <MobileAlertTray />
          <DesktopAlertInbox />
          <PwaNotifyPrompt />
        </>
      ) : null}
    </>
  );
}

function App() {
  const isAdminHost =
    window.location.hostname === "admin.striklenz.com";

  useEffect(() => {
    // Keep first-touch campaign tags before landing-page navigation drops the query string.
    captureMembershipAttribution(
      window.location.search,
      document.referrer,
      window.location.hostname,
    );
  }, []);

  return (
    <div className="App">
      <ErrorBoundary>
        <BrowserRouter>
          <AppRoutes isAdminHost={isAdminHost} />
        </BrowserRouter>
      </ErrorBoundary>
    </div>
  );
}

export default App;
