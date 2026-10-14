import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";
import "@/styles/landing.css";
import { api, persistGuestAuth } from "@/lib/api";
import useLiveDemo, { isMarketOpenNow } from "@/hooks/useLiveDemo";
import OiPulseLogo from "@/components/OiPulseLogo";
import BrowserMock from "@/components/landing/BrowserMock";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 5.1 29.3 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 20-7.6 20-21 0-1.2-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 5.1 29.3 3 24 3 15.9 3 8.9 7.6 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 45c5.2 0 9.9-2 13.5-5.2l-6.2-5.3C29.2 36 26.7 37 24 37c-5.3 0-9.7-3.6-11.3-8.4l-6.6 5.1C8.8 40.3 15.8 45 24 45z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.2 5.3C41.3 36.8 44 31 44 24c0-1.2-.1-2.3-.4-3.5z"/>
    </svg>
  );
}

export default function Login() {
  const nav = useNavigate();
  const marketOpen = isMarketOpenNow();
  const snap = useLiveDemo(1600, marketOpen);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const [exchanging, setExchanging] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [guestLoginEnabled, setGuestLoginEnabled] = useState(false);
  const [localTestAccounts, setLocalTestAccounts] = useState([]);
  const [localTestEmail, setLocalTestEmail] = useState("");
  const [localTestPassword, setLocalTestPassword] = useState("");
  const [localTestBusy, setLocalTestBusy] = useState(false);

  const redirectUri = typeof window !== "undefined" ? `${window.location.origin}/login` : "";

  useEffect(() => {
    api.get("/auth/state", { timeout: 3500 })
      .then(({ data }) => {
        setGoogleEnabled(!!data?.google_login_enabled);
        setGuestLoginEnabled(data?.guest_login_enabled === true);
        const accounts = data?.local_dev_member_login_enabled
          ? data?.local_dev_member_accounts || []
          : [];
        setLocalTestAccounts(accounts);
        setLocalTestEmail((current) => current || accounts[0] || "");
      })
      .catch(() => {
        setGoogleEnabled(false);
        setGuestLoginEnabled(false);
      });
  }, []);

  // Handle Google OAuth redirect back (?code=...)
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const code = qs.get("code");
    if (!code) return;
    const returnedState = qs.get("state");
    let expectedState = null;
    try {
      expectedState = sessionStorage.getItem("oi_google_oauth_state");
      sessionStorage.removeItem("oi_google_oauth_state");
    } catch (_) { /* state validation below fails closed */ }
    if (!expectedState || !returnedState || returnedState !== expectedState) {
      toast.error("Google sign-in could not be verified. Please try again.");
      window.history.replaceState({}, "", "/login");
      return;
    }
    setExchanging(true);
    (async () => {
      try {
        const { data } = await api.post("/auth/google/exchange", { code, redirect_uri: redirectUri });
        if (data?.token) {
          persistGuestAuth({ token: data.token, name: data.name, expiresInSeconds: data.expires_in_seconds, expiresAt: data.expires_at });
          toast.success(`Welcome, ${data.name || "trader"}`);
          window.history.replaceState({}, "", "/login");
          const requestedPlan = sessionStorage.getItem("oi_checkout_plan");
          const requestedCadence = sessionStorage.getItem("oi_checkout_cadence");
          sessionStorage.removeItem("oi_checkout_plan");
          sessionStorage.removeItem("oi_checkout_cadence");
          nav(requestedPlan
            ? `/account?plan=${encodeURIComponent(requestedPlan)}&cadence=${encodeURIComponent(requestedCadence || "monthly")}`
            : "/dashboard");
          return;
        }
      } catch (err) {
        toast.error(err?.response?.data?.detail || "Google sign-in failed");
      } finally {
        setExchanging(false);
        window.history.replaceState({}, "", "/login");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doGoogle = async () => {
    try {
      const bytes = new Uint8Array(24);
      window.crypto.getRandomValues(bytes);
      const state = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      sessionStorage.setItem("oi_google_oauth_state", state);
      const search = new URLSearchParams(window.location.search);
      const plan = search.get("plan");
      const cadence = search.get("cadence");
      sessionStorage.removeItem("oi_checkout_plan");
      sessionStorage.removeItem("oi_checkout_cadence");
      if (plan === "premium" || plan === "pro") sessionStorage.setItem("oi_checkout_plan", plan);
      if (["monthly", "quarterly", "yearly"].includes(cadence)) sessionStorage.setItem("oi_checkout_cadence", cadence);
      const { data } = await api.get("/auth/google/login-url", { params: { redirect_uri: redirectUri, state } });
      if (data?.configured && data?.url) {
        window.location.assign(data.url);
        return;
      }
      toast.message("Google sign-in coming soon", { description: "An admin needs to finish connecting Google. Please try again later." });
    } catch (_) {
      toast.error("Could not start Google sign-in");
    }
  };

  const doGuest = async (e) => {
    e?.preventDefault();
    const full = name.trim();
    if (full.length < 2 || !full.includes(" ")) {
      toast.error("Please enter your full name (first + last).");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/auth/guest", { name: full });
      if (data?.token) {
        persistGuestAuth({ token: data.token, name: data.name || full, expiresInSeconds: data.expires_in_seconds, expiresAt: data.expires_at });
        toast.success(`Welcome, ${data.name || full}`);
        nav("/dashboard");
        return;
      }
      if (data?.status === "pending" && data.request_id) {
        setPending({ id: data.request_id, name: data.name || full });
        toast.message("Request sent", { description: "Waiting for admin approval…" });
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not sign in");
    } finally {
      setBusy(false);
    }
  };

  const doLocalTestLogin = async (event) => {
    event.preventDefault();
    setLocalTestBusy(true);
    try {
      const { data } = await api.post("/auth/local-test-login", {
        email: localTestEmail,
        password: localTestPassword,
      }, { timeout: 5000 });
      if (!data?.token) throw new Error("Local test login returned no session");
      persistGuestAuth({
        token: data.token,
        name: data.name,
        expiresInSeconds: data.expires_in_seconds,
        expiresAt: data.expires_at,
      });
      toast.success(`Signed in as ${data.email}`);
      nav("/dashboard");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Local test sign-in failed.");
    } finally {
      setLocalTestBusy(false);
    }
  };

  // Poll pending approval
  useEffect(() => {
    if (!pending?.id) return undefined;
    const t = setInterval(async () => {
      try {
        const { data } = await api.get(`/auth/access-request/${pending.id}`);
        if ((data.status === "approved" || data.status === "consumed") && data.token) {
          clearInterval(t);
          persistGuestAuth({ token: data.token, name: data.name || pending.name, expiresInSeconds: data.expires_in_seconds, expiresAt: data.expires_at });
          toast.success("Approved — entering…");
          nav("/dashboard");
        } else if (data.status === "rejected") {
          clearInterval(t);
          setPending(null);
          toast.error("Access request was rejected.");
        }
      } catch (err) {
        if (err?.response?.status === 403) {
          clearInterval(t);
          setPending(null);
          toast.error(err?.response?.data?.detail || "Guest sign-in is disabled.");
        }
      }
    }, 2500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.id]);

  return (
    <div className="slz slz-light relative flex min-h-screen items-stretch overflow-x-hidden">
      <div className="slz-aurora" />
      {/* Left brand / product */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-slate-900 p-10 text-white lg:flex">
        <div className="pointer-events-none absolute inset-0 opacity-50" style={{ background: "radial-gradient(40rem 24rem at 70% 0%, rgba(16,185,129,0.35), transparent), radial-gradient(36rem 24rem at 10% 100%, rgba(79,70,229,0.35), transparent)" }} />
        <Link to="/" className="relative flex w-full items-center justify-center gap-2">
          <OiPulseLogo className="h-9 w-9" pulse={false} />
          <span className="text-xl font-bold"><span className="text-white">Strik</span><span className="text-emerald-400">Lenz</span></span>
        </Link>
        <div className="relative w-full max-w-lg self-center text-center">
          <h2 className="text-3xl font-black leading-tight">Read the market.<br />Then read your book.</h2>
          <p className="mx-auto mt-3 max-w-md text-slate-300">Live OI, Strike Pressure and your positions on the OI wall — the moment you sign in.</p>
          <motion.div className="mx-auto mt-8 w-full max-w-md" animate={{ y: [0, -8, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
            <BrowserMock id="dashboard" snap={snap} title="Live Market Dashboard" chipIndex="SENSEX" marketOpen={marketOpen} />
          </motion.div>
        </div>
        <div className="relative text-center text-xs text-slate-400">Information only, not investment advice.</div>
      </div>

      {/* Right auth card */}
      <div className="relative flex w-full items-center justify-center px-3 py-5 sm:px-6 sm:py-8 lg:w-1/2 lg:px-10">
        <div className="w-full max-w-md rounded-[2rem] border border-white/80 bg-white/85 p-5 shadow-[0_24px_70px_-34px_rgba(15,23,42,0.45)] backdrop-blur-xl sm:p-9">
          <div className="relative mb-7 flex items-center justify-center sm:mb-8">
            <div className="flex items-center gap-2.5">
              <OiPulseLogo className="h-9 w-9" pulse={false} />
              <span className="text-lg font-bold tracking-tight"><span className="text-slate-950">Strik</span><span className="text-emerald-600">Lenz</span></span>
            </div>
            <span className="absolute right-0 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-emerald-700 sm:px-3 sm:text-[10px] sm:tracking-[0.14em]">
              Sign in
            </span>
          </div>

          <div className="mb-7">
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">Your market desk</p>
            <h1 className="text-[1.75rem] font-bold leading-tight tracking-[-0.035em] text-slate-950 sm:text-[2rem]">Welcome to <span className="text-slate-950">Strik</span><span className="text-emerald-600">Lenz</span></h1>
            <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
              {googleEnabled
                ? "Sign in securely with your Google account to open your market desk."
                : guestLoginEnabled
                  ? "Enter your full name to access the guest market desk."
                  : "Sign-in options are managed by the StrikLenz administrator."}
            </p>
          </div>

          {googleEnabled && (
            <>
              <button
                onClick={doGoogle}
                disabled={exchanging}
                className="flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50/30 hover:shadow-md disabled:opacity-60"
              >
                {exchanging ? <Loader2 className="h-5 w-5 animate-spin" /> : <GoogleIcon />}
                {exchanging ? "Signing you in…" : "Continue with Google"}
              </button>

              {guestLoginEnabled && (
                <div className="my-6 flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
                  <div className="h-px flex-1 bg-slate-200" /> or guest access <div className="h-px flex-1 bg-slate-200" />
                </div>
              )}
            </>
          )}

          {/* The backend exposes test identities only to loopback development requests. */}
          {localTestAccounts.length > 0 && (
            <form onSubmit={doLocalTestLogin} className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-amber-900">Local subscription testing</p>
              <p className="mt-1 text-xs leading-5 text-amber-800">Development-only test identities; available only from this computer.</p>
              <label htmlFor="local-test-email" className="mb-1 mt-3 block text-xs font-semibold text-slate-700">Test account</label>
              <select
                id="local-test-email"
                value={localTestEmail}
                onChange={(event) => setLocalTestEmail(event.target.value)}
                className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm"
              >
                {localTestAccounts.map((email) => <option key={email} value={email}>{email}</option>)}
              </select>
              <label htmlFor="local-test-password" className="mb-1 mt-3 block text-xs font-semibold text-slate-700">Test password</label>
              <input
                id="local-test-password"
                type="password"
                autoComplete="current-password"
                value={localTestPassword}
                onChange={(event) => setLocalTestPassword(event.target.value)}
                className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm"
                required
              />
              <button
                type="submit"
                disabled={localTestBusy || !localTestEmail}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-700 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-60"
              >
                {localTestBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                {localTestBusy ? "Signing in…" : "Sign in to test this plan"}
              </button>
            </form>
          )}

          {pending ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
              <div className="flex items-center gap-2 font-semibold"><span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" /> Waiting for admin approval…</div>
              <p className="mt-1 text-xs opacity-80">Requested as <b>{pending.name}</b>. Keep this page open — you'll enter automatically.</p>
              <button onClick={() => setPending(null)} className="mt-2 text-xs underline opacity-70 hover:opacity-100">Cancel</button>
            </div>
          ) : guestLoginEnabled && (
            <form onSubmit={doGuest} className="space-y-4">
              <div>
                <label htmlFor="guest-name" className="mb-2 block text-xs font-semibold text-slate-700">Full name</label>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="guest-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Rahul Sharma"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 py-3.5 pl-11 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100/70"
                    autoFocus
                  />
                </div>
              </div>
              <button type="submit" disabled={busy} className="slz-btn-primary flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-bold shadow-lg transition disabled:cursor-not-allowed disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {busy ? "Entering…" : "Enter the desk"}
              </button>
            </form>
          )}
          {!googleEnabled && !guestLoginEnabled && localTestAccounts.length === 0 && (
            <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Sign-in is currently unavailable. Please contact the administrator.
            </p>
          )}

          <div className="mt-8 flex items-start gap-2.5 border-t border-slate-100 pt-5 lg:hidden">
            <span className="mt-0.5 text-emerald-600">✓</span>
            <p className="text-[11px] leading-5 text-slate-400">Information only, not investment advice.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
