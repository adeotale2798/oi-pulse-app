import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import OiPulseLogo from "@/components/OiPulseLogo";
import { api, deleteUserKiteCredentials, logoutGuest, memberBrokerCredentialsStatus } from "@/lib/api";
import { safeHttpUrl } from "@/lib/safeUrl";

const INDEX_OPTIONS = ["NIFTY", "SENSEX", "BANKNIFTY"];
const ALERT_TYPES = [
  ["oi_change", "OI change"],
  ["oi_shift", "OI shift"],
  ["market_intel", "Market Intel"],
  ["event", "Events"],
];

function formatProviderDate(value) {
  const parsed = typeof value === "number" ? value * 1000 : Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString() : "—";
}

function subscriptionHistoryLabel(event) {
  const details = event.details || {};
  const planName = details.plan === "pro" ? "Pro" : details.plan === "premium" ? "Premium" : "paid";
  if (event.event_type === "subscription_checkout_created") {
    return `${planName} checkout started${details.cadence ? ` · ${details.cadence}` : ""}`;
  }
  if (event.event_type === "subscription_renewal_cancelled") {
    return "Subscription cancelled · paid access ended immediately and Basic resumed";
  }
  const status = String(details.status || "").toLowerCase();
  if (status === "active") return `${planName} subscription activated · paid access began`;
  if (status === "past_due" || status === "halted") return "Payment failed · paid access ended and Basic resumed";
  if (status === "refunded") return "Payment refunded · paid access ended";
  if (["cancelled", "completed", "expired"].includes(status)) {
    return "Subscription ended · Basic access resumed";
  }
  return status ? `Subscription status changed · ${status.replaceAll("_", " ")}` : "Subscription status updated";
}

export default function AccountSettings() {
  const [searchParams] = useSearchParams();
  const [profile, setProfile] = useState(null);
  const [siteConfig, setSiteConfig] = useState(null);
  const [brokerCredentials, setBrokerCredentials] = useState(null);
  const [preferences, setPreferences] = useState(null);
  const [plan, setPlan] = useState("premium");
  const [cadence, setCadence] = useState("monthly");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [removeBrokerBusy, setRemoveBrokerBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [meResponse, configResponse] = await Promise.all([
        api.get("/membership/me"),
        api.get("/public/site-config"),
      ]);
      const brokerResponse = await memberBrokerCredentialsStatus();
      setProfile(meResponse.data);
      setPreferences(meResponse.data?.preferences || {});
      setSiteConfig(configResponse.data);
      setBrokerCredentials(brokerResponse);
      const requestedPlan = searchParams.get("plan");
      const requestedCadence = searchParams.get("cadence");
      if (requestedPlan !== "premium" && requestedPlan !== "pro") {
        const savedPlan = meResponse.data?.subscription?.plan;
        if (savedPlan === "premium" || savedPlan === "pro") setPlan(savedPlan);
      }
      if (!["monthly", "quarterly", "yearly"].includes(requestedCadence)) {
        const savedCadence = meResponse.data?.subscription?.cadence;
        if (["monthly", "quarterly", "yearly"].includes(savedCadence)) setCadence(savedCadence);
      }
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not load your account settings.");
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    load();
    const requestedPlan = searchParams.get("plan");
    const requestedCadence = searchParams.get("cadence");
    if (requestedPlan === "premium" || requestedPlan === "pro") setPlan(requestedPlan);
    if (["monthly", "quarterly", "yearly"].includes(requestedCadence)) setCadence(requestedCadence);
  }, [load, searchParams]);

  const updatePreference = (key, value) => {
    setPreferences((current) => ({ ...current, [key]: value }));
  };

  const removeBrokerCredentials = async () => {
    if (!window.confirm("Permanently remove your saved encrypted broker API key and secret? Your journal and subscription data will remain.")) return;
    setRemoveBrokerBusy(true);
    try {
      await deleteUserKiteCredentials();
      setBrokerCredentials({
        credentials_configured: false,
        connected: false,
        expired: false,
        kite_user_id: null,
        valid_until: null,
      });
      toast.success("Saved broker credentials permanently removed.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not remove saved broker credentials.");
    } finally {
      setRemoveBrokerBusy(false);
    }
  };

  const savePreferences = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.put("/membership/preferences", preferences);
      setPreferences(data.preferences);
      toast.success("Preferences saved.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not save preferences.");
    } finally {
      setSaving(false);
    }
  };

  const startCheckout = async () => {
    setCheckoutBusy(true);
    try {
      const { data } = await api.post("/billing/checkout", { plan, cadence });
      window.location.assign(data.short_url);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not start checkout.");
      setCheckoutBusy(false);
    }
  };

  const cancelSubscription = async () => {
    if (!window.confirm("Cancel your subscription now? Paid access will end immediately and your account will return to Basic.")) return;
    setCancelBusy(true);
    try {
      await api.post("/billing/cancel");
      toast.success("Subscription cancelled. Your account is now on Basic.");
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not cancel the subscription.");
    } finally {
      setCancelBusy(false);
    }
  };

  const member = profile?.member || {};
  const subscription = profile?.subscription || {};
  const paidBillingReady = !!siteConfig?.membership?.paid_subscriptions_enabled
    && !!siteConfig?.features?.razorpay_enabled;
  const currentPlan = profile?.plan || "normal";
  const currentPlanLabel = currentPlan === "normal"
    ? "Basic"
    : currentPlan === "pro" ? "Pro" : "Premium";
  const checkoutUrl = safeHttpUrl(subscription.checkout_url);
  const currentEnd = typeof subscription.current_end === "number"
    ? subscription.current_end * 1000
    : Date.parse(subscription.current_end || "");
  const accessContinues = ["premium", "pro"].includes(currentPlan)
    && subscription.status === "active"
    && Number.isFinite(currentEnd)
    && currentEnd > Date.now();
  const pendingPayment = ["created", "authenticated"].includes(subscription.status);
  const paymentNeedsAttention = ["past_due", "halted", "paused", "refunded", "expired"].includes(subscription.status);
  const renewalReminder = subscription.status === "active"
    && Number.isFinite(currentEnd)
    && currentEnd > Date.now()
    && currentEnd <= Date.now() + 7 * 24 * 60 * 60 * 1000;

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 text-slate-600" aria-live="polite">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading account…
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-center justify-between gap-3">
          <div>
            <Link to="/dashboard" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
              <ArrowLeft className="h-4 w-4" /> Back to desk
            </Link>
            <div className="flex items-center gap-3">
              <OiPulseLogo className="h-9 w-9" pulse={false} />
              <div>
                <h1 className="text-2xl font-bold">Account & preferences</h1>
                <p className="text-sm text-slate-500">{member.email || member.name}</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
            onClick={async () => { await logoutGuest(); window.location.assign("/login"); }}
          >
            Sign out
          </button>
        </header>

        <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Current plan</p>
              <h2 className="mt-1 text-2xl font-bold">{currentPlanLabel}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {["cancelled", "completed", "expired"].includes(subscription.status) && currentPlan === "normal"
                    ? "Subscription ended · Basic access is active"
                  : subscription.status === "past_due"
                    ? "Payment failed · paid access ended and Basic access is active"
                    : subscription.status === "refunded"
                      ? "Payment refunded · paid features are no longer active"
                      : subscription.status
                        ? `Payment status: ${subscription.status.replaceAll("_", " ")}`
                  : profile?.is_local_test_account
                    ? "Local test account"
                    : currentPlan === "normal" ? "Free account" : "Granted access"}
                {subscription.cadence ? ` · ${subscription.cadence}` : ""}
                {subscription.current_end && ["active", "authenticated"].includes(subscription.status)
                  ? ` · ${subscription.status === "active" ? "Renews" : "Billing starts"} ${formatProviderDate(subscription.current_end)}`
                  : ""}
              </p>
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold capitalize text-emerald-700">
              {currentPlanLabel} access
            </span>
          </div>
          {currentPlan === "pro" && (
            <Link to="/account/journal" className="mt-4 inline-flex rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Open personal trade journal
            </Link>
          )}
          {subscription.id && ["active", "authenticated"].includes(subscription.status) && (
            <button type="button" disabled={cancelBusy} onClick={cancelSubscription}
              className="ml-2 mt-4 rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50">
              {cancelBusy ? "Cancelling…" : "Cancel subscription"}
            </button>
          )}
          {paymentNeedsAttention && (
            <p role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {currentPlan === "normal"
                ? "Your paid subscription has ended and your account is on Basic. "
                : "Your plan access is currently provided by an administrator override. "}
              Select a paid plan below to start a new secure checkout. This message is shown in your account; email reminders are not configured.
            </p>
          )}
          {pendingPayment && (
            <p role="status" className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
              Checkout is awaiting provider confirmation. Paid access starts only after a verified Razorpay webhook.
              {checkoutUrl && (
                <a href={checkoutUrl} target="_blank" rel="noreferrer" className="ml-1 font-semibold underline">
                  Resume secure checkout
                </a>
              )}
              {renewalReminder && (
                <p role="status" className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                  Your {subscription.cadence || "subscription"} renewal is due by {formatProviderDate(subscription.current_end)}.
                  {" "}Cancel the subscription above to return to Basic immediately. Email reminders are not configured.
                </p>
              )}
            </p>
          )}
        </section>

        <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Subscription history">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Subscription history</h2>
              <p className="mt-1 text-sm text-slate-500">A private record of checkout and verified billing changes for this account.</p>
            </div>
            {currentPlan === "normal" && (
              <a href="#subscription-options" className="text-sm font-semibold text-emerald-800 underline">
                Subscribe again
              </a>
            )}
          </div>
          {profile?.subscription_history?.length ? (
            <ol className="mt-4 space-y-3">
              {profile.subscription_history.map((event, index) => (
                <li key={`${event.event_type}-${event.created_at}-${index}`} className="border-l-2 border-slate-200 pl-3">
                  <p className="text-sm font-semibold text-slate-800">{subscriptionHistoryLabel(event)}</p>
                  <time className="text-xs text-slate-500" dateTime={event.created_at}>
                    {formatProviderDate(event.created_at)}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-slate-600">Billing changes will appear here after your first checkout.</p>
          )}
        </section>

        {brokerCredentials?.credentials_configured && (
          <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Saved broker credentials</h2>
            <p className="mt-1 text-sm text-slate-600">
              Encrypted app credentials are saved{brokerCredentials.api_key_hint ? ` · API key ${brokerCredentials.api_key_hint}` : ""}.
              {brokerCredentials.connected && brokerCredentials.kite_user_id
                ? ` Connected account ${brokerCredentials.kite_user_id}.`
                : " The daily broker session is not currently connected."}
              {brokerCredentials.linked_kite_user_id
                ? ` This Google account is locked to Zerodha ID ${brokerCredentials.linked_kite_user_id}.`
                : ""}
              {" "}These credentials remain stored after a plan lapse until you remove them.
            </p>
            <button type="button" disabled={removeBrokerBusy} onClick={removeBrokerCredentials}
              className="mt-3 rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50">
              {removeBrokerBusy ? "Removing…" : "Permanently remove broker credentials"}
            </button>
          </section>
        )}

        <form onSubmit={savePreferences} className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Alert preferences</h2>
            <p className="mt-1 text-sm text-slate-500">These choices apply only to your account and do not change the shared market feed.</p>
            <div className="mt-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Indices</p>
              <div className="flex flex-wrap gap-3">
                {INDEX_OPTIONS.map((index) => (
                  <label key={index} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={(preferences?.alert_indices || []).includes(index)}
                      onChange={(event) => {
                        const indices = preferences?.alert_indices || [];
                        updatePreference("alert_indices", event.target.checked
                          ? [...indices, index]
                          : indices.filter((item) => item !== index));
                      }}
                    />
                    {index}
                  </label>
                ))}
              </div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">
                OI change alert threshold (%)
                <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" type="number" min="1" max="100" step="0.5"
                  value={preferences?.oi_change_threshold_pct ?? 15}
                  onChange={(event) => updatePreference("oi_change_threshold_pct", event.target.value)} />
              </label>
              <label className="text-sm font-medium">
                OI shift threshold (contracts)
                <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" type="number" min="1" max="100000000"
                  value={preferences?.oi_shift_threshold_contracts ?? 100000}
                  onChange={(event) => updatePreference("oi_shift_threshold_contracts", event.target.value)} />
              </label>
              <label className="text-sm font-medium">
                Alert cooldown (seconds)
                <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" type="number" min="30" max="3600"
                  value={preferences?.alert_cooldown_seconds ?? 300}
                  onChange={(event) => updatePreference("alert_cooldown_seconds", event.target.value)} />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              {ALERT_TYPES.map(([key, label]) => (
                <label key={key} className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={preferences?.alert_types?.[key] !== false}
                    onChange={(event) => updatePreference("alert_types", {
                      ...(preferences?.alert_types || {}),
                      [key]: event.target.checked,
                    })} />
                  {label}
                </label>
              ))}
            </div>
          </section>

          {currentPlan === "pro" && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold">Pro desk display</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {[
                  ["overnight_position_risk_enabled", "Overnight position risk"],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={preferences?.[key] !== false}
                      onChange={(event) => updatePreference(key, event.target.checked)} />
                    {label}
                  </label>
                ))}
              </div>
            </section>
          )}

          <div className="flex justify-end">
            <button disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save preferences
            </button>
          </div>
        </form>

        <section id="subscription-options" className="mt-6 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">{currentPlan === "normal" ? "Choose a paid plan" : "Change paid plan"}</h2>
            <p className="mt-1 text-sm text-slate-500">Secure checkout is provided by Razorpay. Your plan changes only after a verified provider webhook.</p>
            {accessContinues && (
              <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                To avoid overlapping subscriptions, plan changes are available after your current paid period ends
                {subscription.current_end ? ` on ${formatProviderDate(subscription.current_end)}` : ""}. Cancel your subscription above to return to Basic immediately.
              </p>
            )}
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <label className="text-sm font-medium">
                Plan
                <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={plan} onChange={(event) => setPlan(event.target.value)}>
                  <option value="premium">Premium</option>
                  <option value="pro">Pro</option>
                </select>
              </label>
              <label className="text-sm font-medium">
                Billing
                <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={cadence} onChange={(event) => setCadence(event.target.value)}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </label>
              <div className="flex items-end">
                <button type="button" disabled={!paidBillingReady || checkoutBusy || accessContinues || pendingPayment}
                  onClick={startCheckout}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
                  {checkoutBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {paidBillingReady ? "Continue to checkout" : "Checkout unavailable"}
                </button>
              </div>
            </div>
            {!paidBillingReady && <p className="mt-3 text-xs text-amber-700">Paid plans are not enabled or billing is not fully configured yet.</p>}
        </section>
      </div>
    </main>
  );
}
