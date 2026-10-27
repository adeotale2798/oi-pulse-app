import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Save, Loader2, ChevronDown, ShieldCheck, KeyRound, IndianRupee, PlugZap } from "lucide-react";
import "@/styles/landing.css";
import OiPulseLogo from "@/components/OiPulseLogo";
import { api } from "@/lib/api";
import { brokerSafeText } from "@/lib/brokerCopy";
import {
  PUBLIC_ENTRY_AUTH_TIMEOUT_DEFAULT_SECONDS,
  PUBLIC_ENTRY_AUTH_TIMEOUT_MAX_SECONDS,
  PUBLIC_ENTRY_AUTH_TIMEOUT_MIN_SECONDS,
} from "@/lib/authBoot";

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

const inputCls = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";

const MEMBER_FEATURES = [
  { id: "oi_change", label: "OI Change", group: "Dashboard pages" },
  { id: "open_interest", label: "Open Interest", group: "Dashboard pages" },
  { id: "strike_table", label: "Strike Table", group: "Dashboard pages" },
  { id: "buildup", label: "Build-up", group: "Dashboard pages" },
  { id: "straddle", label: "Straddle", group: "Dashboard pages" },
  { id: "index_risk", label: "Index Risk", group: "Dashboard pages" },
  { id: "events", label: "Events calendar", group: "Dashboard pages" },
  { id: "activity", label: "Activity feed", group: "Dashboard pages" },
  { id: "alerts", label: "Alerts inbox", group: "Insights and alerts" },
  { id: "alert_sounds", label: "Alert sound preferences", group: "Insights and alerts" },
  { id: "market_intel", label: "Market Intel", group: "Insights and alerts" },
  { id: "global_markets", label: "Global Markets", group: "Insights and alerts" },
  { id: "oi_shift_alerts", label: "OI Shift alerts", group: "Insights and alerts" },
  { id: "oi_change_alerts", label: "OI Change alerts", group: "Insights and alerts" },
  { id: "event_alerts", label: "Event alerts", group: "Insights and alerts" },
  { id: "overnight_position_risk", label: "Overnight position risk", group: "Pro tools" },
  { id: "positions", label: "Positions", group: "Pro tools" },
  { id: "trade_journal", label: "Trade Journal", group: "Pro tools" },
  { id: "desk_ai", label: "Desk AI", group: "Pro tools" },
];

const DEFAULT_PLAN_FEATURES = {
  normal: ["oi_change", "open_interest", "strike_table", "buildup", "straddle", "index_risk", "events", "activity"],
  premium: ["oi_change", "open_interest", "strike_table", "buildup", "straddle", "index_risk", "events", "activity", "alerts", "alert_sounds", "market_intel", "global_markets", "oi_shift_alerts", "oi_change_alerts", "event_alerts"],
  pro: ["oi_change", "open_interest", "strike_table", "buildup", "straddle", "index_risk", "events", "activity", "alerts", "alert_sounds", "market_intel", "global_markets", "oi_shift_alerts", "oi_change_alerts", "event_alerts", "overnight_position_risk", "positions", "trade_journal", "desk_ai"],
};

function Toggle({ checked, onChange, label, disabled = false }) {
  return (
    <button type="button" aria-label={label} aria-pressed={checked} disabled={disabled} onClick={() => onChange(!checked)} className={`relative h-6 w-11 rounded-full transition disabled:cursor-wait disabled:opacity-60 ${checked ? "bg-emerald-500" : "bg-slate-300"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export default function AdminSettings() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [walkthroughSaving, setWalkthroughSaving] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [openBroker, setOpenBroker] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/admin/platform/config");
        setCfg(normalise(data));
      } catch (err) {
        if (err?.response?.status === 401) {
          toast.error("Admin sign-in required");
          nav("/admin", { replace: true });
          return;
        }
        toast.error("Could not load settings");
      } finally {
        setLoading(false);
      }
    })();
  }, [nav]);

  function normalise(d) {
    return {
      pricing: {
        currency: d?.pricing?.currency || "INR",
        premium: {
          monthly: d?.pricing?.premium?.monthly ?? 999,
          quarterly: d?.pricing?.premium?.quarterly ?? 2499,
          yearly: d?.pricing?.premium?.yearly ?? 7999,
          offer_prices: {
            monthly: d?.pricing?.premium?.offer_prices?.monthly ?? "",
            quarterly: d?.pricing?.premium?.offer_prices?.quarterly ?? "",
            yearly: d?.pricing?.premium?.offer_prices?.yearly ?? "",
          },
          razorpay_plan_ids: {
            monthly: d?.pricing?.premium?.razorpay_plan_ids?.monthly || "",
            quarterly: d?.pricing?.premium?.razorpay_plan_ids?.quarterly || "",
            yearly: d?.pricing?.premium?.razorpay_plan_ids?.yearly || "",
          },
          razorpay_offer_ids: {
            monthly: d?.pricing?.premium?.razorpay_offer_ids?.monthly || "",
            quarterly: d?.pricing?.premium?.razorpay_offer_ids?.quarterly || "",
            yearly: d?.pricing?.premium?.razorpay_offer_ids?.yearly || "",
          },
        },
        pro: {
          monthly: d?.pricing?.pro?.monthly ?? 0,
          quarterly: d?.pricing?.pro?.quarterly ?? 0,
          yearly: d?.pricing?.pro?.yearly ?? 0,
          offer_prices: {
            monthly: d?.pricing?.pro?.offer_prices?.monthly ?? "",
            quarterly: d?.pricing?.pro?.offer_prices?.quarterly ?? "",
            yearly: d?.pricing?.pro?.offer_prices?.yearly ?? "",
          },
          razorpay_plan_ids: {
            monthly: d?.pricing?.pro?.razorpay_plan_ids?.monthly || "",
            quarterly: d?.pricing?.pro?.razorpay_plan_ids?.quarterly || "",
            yearly: d?.pricing?.pro?.razorpay_plan_ids?.yearly || "",
          },
          razorpay_offer_ids: {
            monthly: d?.pricing?.pro?.razorpay_offer_ids?.monthly || "",
            quarterly: d?.pricing?.pro?.razorpay_offer_ids?.quarterly || "",
            yearly: d?.pricing?.pro?.razorpay_offer_ids?.yearly || "",
          },
        },
      },
      sitewalkthrough_enabled: d?.sitewalkthrough_enabled !== false,
      public_landing_enabled: !!d?.public_landing_enabled,
      guest_login_enabled: d?.guest_login_enabled === true,
      public_entry_auth_timeout_seconds: d?.public_entry_auth_timeout_seconds
        ?? PUBLIC_ENTRY_AUTH_TIMEOUT_DEFAULT_SECONDS,
      membership: {
        experience_enabled: !!d?.membership?.experience_enabled,
        signup_enabled: !!d?.membership?.signup_enabled,
        paid_subscriptions_enabled: !!d?.membership?.paid_subscriptions_enabled,
        plans: Object.fromEntries(["normal", "premium", "pro"].map((plan) => [
          plan,
          {
            enabled: d?.membership?.plans?.[plan]?.enabled !== false,
            features: d?.membership?.plans?.[plan]?.features || DEFAULT_PLAN_FEATURES[plan],
          },
        ])),
        early_access: {
          enabled: !!d?.membership?.early_access?.enabled,
          discount_percent: d?.membership?.early_access?.discount_percent ?? 0,
        },
        preference_defaults: {
          alert_indices: d?.membership?.preference_defaults?.alert_indices || ["NIFTY", "SENSEX", "BANKNIFTY"],
          oi_change_threshold_pct: d?.membership?.preference_defaults?.oi_change_threshold_pct ?? 15,
          alert_cooldown_seconds: d?.membership?.preference_defaults?.alert_cooldown_seconds ?? 300,
          oi_shift_threshold_contracts: d?.membership?.preference_defaults?.oi_shift_threshold_contracts ?? 100000,
          alert_types: {
            oi_change: d?.membership?.preference_defaults?.alert_types?.oi_change !== false,
            oi_shift: d?.membership?.preference_defaults?.alert_types?.oi_shift !== false,
            market_intel: d?.membership?.preference_defaults?.alert_types?.market_intel !== false,
            event: d?.membership?.preference_defaults?.alert_types?.event !== false,
          },
        },
      },
      billing_readiness: {
        ready: !!d?.billing_readiness?.ready,
        credentials_ready: !!d?.billing_readiness?.credentials_ready,
        plan_ids_and_prices_ready: !!d?.billing_readiness?.plan_ids_and_prices_ready,
        offer_ids_ready: d?.billing_readiness?.offer_ids_ready !== false,
      },
      google: {
        enabled: !!d?.google?.enabled,
        client_id: d?.google?.client_id || "",
        client_secret_set: d?.google?.client_secret === "set",
        client_secret: "",
        redirect_uri: d?.google?.redirect_uri || "https://striklenz.com/login",
      },
      razorpay: {
        enabled: !!d?.razorpay?.enabled,
        key_id: d?.razorpay?.key_id || "",
        key_secret_set: d?.razorpay?.key_secret === "set",
        key_secret: "",
        webhook_secret_set: d?.razorpay?.webhook_secret === "set",
        webhook_secret: "",
      },
      brokers: (d?.brokers || []).map((b) => ({
        id: b.id, name: b.name, capabilities: b.capabilities || [],
        enabled: !!b.enabled,
        client_id: b.client_id || "",
        client_secret_set: b.client_secret === "set",
        client_secret: "",
        redirect_uri: b.redirect_uri || "",
      })),
    };
  }

  const set = (path, val) => setCfg((c) => {
    const n = JSON.parse(JSON.stringify(c));
    let o = n; const parts = path.split(".");
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = val;
    return n;
  });
  const setBroker = (i, key, val) => setCfg((c) => {
    const n = JSON.parse(JSON.stringify(c));
    n.brokers[i][key] = val; return n;
  });

  const toggleWalkthrough = async (enabled) => {
    const previous = cfg.sitewalkthrough_enabled;
    set("sitewalkthrough_enabled", enabled);
    setWalkthroughSaving(true);
    try {
      const { data } = await api.post("/settings", { sitewalkthrough_enabled: enabled });
      const saved = typeof data?.sitewalkthrough_enabled === "boolean"
        ? data.sitewalkthrough_enabled
        : enabled;
      set("sitewalkthrough_enabled", saved);
      window.dispatchEvent(new CustomEvent("oi-settings-saved", {
        detail: { ...data, sitewalkthrough_enabled: saved },
      }));
      toast.success(`Site walkthrough ${saved ? "enabled" : "disabled"}`);
    } catch (error) {
      set("sitewalkthrough_enabled", previous);
      toast.error(error?.response?.data?.detail || "Could not update the site walkthrough");
    } finally {
      setWalkthroughSaving(false);
    }
  };

  const save = async () => {
    const authTimeoutSeconds = Number(cfg.public_entry_auth_timeout_seconds);
    if (
      !Number.isInteger(authTimeoutSeconds)
      || authTimeoutSeconds < PUBLIC_ENTRY_AUTH_TIMEOUT_MIN_SECONDS
      || authTimeoutSeconds > PUBLIC_ENTRY_AUTH_TIMEOUT_MAX_SECONDS
    ) {
      toast.error(`Public entry wait must be ${PUBLIC_ENTRY_AUTH_TIMEOUT_MIN_SECONDS}–${PUBLIC_ENTRY_AUTH_TIMEOUT_MAX_SECONDS} seconds`);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        pricing: {
          currency: cfg.pricing.currency,
          premium: {
            monthly: Number(cfg.pricing.premium.monthly) || 0,
            quarterly: Number(cfg.pricing.premium.quarterly) || 0,
            yearly: Number(cfg.pricing.premium.yearly) || 0,
            offer_prices: cfg.pricing.premium.offer_prices,
            razorpay_plan_ids: cfg.pricing.premium.razorpay_plan_ids,
            razorpay_offer_ids: cfg.pricing.premium.razorpay_offer_ids,
          },
          pro: {
            monthly: Number(cfg.pricing.pro.monthly) || 0,
            quarterly: Number(cfg.pricing.pro.quarterly) || 0,
            yearly: Number(cfg.pricing.pro.yearly) || 0,
            offer_prices: cfg.pricing.pro.offer_prices,
            razorpay_plan_ids: cfg.pricing.pro.razorpay_plan_ids,
            razorpay_offer_ids: cfg.pricing.pro.razorpay_offer_ids,
          },
        },
        membership: cfg.membership,
        guest_login_enabled: cfg.guest_login_enabled,
        google: {
          enabled: cfg.google.enabled,
          client_id: cfg.google.client_id,
          redirect_uri: cfg.google.redirect_uri,
          ...(cfg.google.client_secret ? { client_secret: cfg.google.client_secret } : {}),
        },
        razorpay: {
          enabled: cfg.razorpay.enabled,
          key_id: cfg.razorpay.key_id,
          ...(cfg.razorpay.key_secret ? { key_secret: cfg.razorpay.key_secret } : {}),
          ...(cfg.razorpay.webhook_secret ? { webhook_secret: cfg.razorpay.webhook_secret } : {}),
        },
        brokers: cfg.brokers.map((b) => ({
          id: b.id, enabled: b.enabled, client_id: b.client_id, redirect_uri: b.redirect_uri,
          ...(b.client_secret ? { client_secret: b.client_secret } : {}),
        })),
        public_landing_enabled: cfg.public_landing_enabled,
        public_entry_auth_timeout_seconds: authTimeoutSeconds,
      };
      await api.post("/admin/platform/config", payload);
      toast.success("Settings saved");
      const { data } = await api.get("/admin/platform/config");
      setCfg(normalise(data));
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="slz slz-light flex min-h-screen items-center justify-center text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading settings…</div>;
  }
  if (!cfg) return null;

  return (
    <div className="slz slz-light min-h-screen pb-20">
      <header className="sticky top-0 z-30 slz-glass border-b border-slate-200">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-y-2 px-3 py-3 sm:flex-nowrap sm:px-5 sm:py-3.5">
          <div className="flex min-w-0 items-center gap-2">
            <OiPulseLogo className="h-8 w-8" pulse={false} />
            <span className="text-sm font-bold text-slate-900 sm:text-lg">Strik<span className="text-emerald-600">Lenz</span> <span className="text-slate-400">/ Admin Settings</span></span>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Dashboard</Link>
            <button onClick={save} disabled={saving} className="slz-btn-primary inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-3 pt-4 sm:px-5 sm:pt-8">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div>
            <h2 className="font-bold text-emerald-950">Member accounts</h2>
            <p className="mt-0.5 text-xs text-emerald-800">Manage subscribers, plan overrides, linked broker account status, and trade-cycle storage consent.</p>
          </div>
          <Link to="/admin/subscriptions" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
            Open subscriptions
          </Link>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <h2 className="text-lg font-bold text-slate-900">Public entry connection</h2>
          <p className="mb-3 mt-1 text-xs text-slate-500">Choose how long the main site waits for its access service before showing the retry message. This setting is only editable by Admin.</p>
          <Field
            label="Wait before showing connection message (seconds)"
            hint={`Allowed range: ${PUBLIC_ENTRY_AUTH_TIMEOUT_MIN_SECONDS}–${PUBLIC_ENTRY_AUTH_TIMEOUT_MAX_SECONDS} seconds. Applies to the next public entry or retry.`}
          >
            <input
              type="number"
              min={PUBLIC_ENTRY_AUTH_TIMEOUT_MIN_SECONDS}
              max={PUBLIC_ENTRY_AUTH_TIMEOUT_MAX_SECONDS}
              step="1"
              className={`${inputCls} max-w-xs`}
              value={cfg.public_entry_auth_timeout_seconds}
              onChange={(event) => set("public_entry_auth_timeout_seconds", event.target.value)}
              aria-label="Public entry connection wait"
            />
          </Field>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Public landing page</h2>
              <p className="mb-3 mt-1 text-xs text-slate-500">When enabled, visitors to the main site see the public plan and feature page first. Plan buttons continue to member sign-in. This does not open guest access or enable member sign-up by itself.</p>
            </div>
            <Link to="/admin/settings/landingpage" className="rounded-lg border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">
              Configure landing-page content
            </Link>
          </div>
          <div className="flex items-center justify-between gap-5 border-t border-slate-100 py-3">
            <div>
              <div className="text-sm font-semibold text-slate-800">Show the public landing page at the main site</div>
              <div className="text-xs text-slate-500">Save changes to publish the setting. The dashboard header toggle controls the same setting.</div>
            </div>
            <Toggle
              checked={cfg.public_landing_enabled}
              onChange={(value) => set("public_landing_enabled", value)}
            />
          </div>
          <div className="flex items-center justify-between gap-5 border-t border-slate-100 py-3">
            <div>
              <div className="text-sm font-semibold text-slate-800">Enable site walkthrough</div>
              <div className="text-xs text-slate-500">Uses the same setting as the dashboard Admin toggle. When off, demo and interactive-demo links are hidden from the public landing page.</div>
            </div>
            <Toggle
              label="Enable site walkthrough"
              checked={cfg.sitewalkthrough_enabled}
              disabled={walkthroughSaving}
              onChange={toggleWalkthrough}
            />
          </div>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <h2 className="text-lg font-bold text-slate-900">Member rollout controls</h2>
          <p className="mb-3 mt-1 text-xs text-slate-500">These controls are separate from Public guest access. Keep rollout off while testing; active members can remain able to sign in when new sign-ups or sales are paused.</p>
          <div className="divide-y divide-slate-100">
            {[
              ["experience_enabled", "Enable Basic / Premium / Pro experience", "When off, registered-member routes stay unavailable."],
              ["signup_enabled", "Allow registered member sign-up", "New Google-verified accounts can start on the Basic plan."],
              ["paid_subscriptions_enabled", "Enable paid subscriptions", "Requires Razorpay credentials, webhook verification, plan IDs, and paid plan prices."],
            ].map(([key, label, hint]) => (
              <div key={key} className="flex items-center justify-between gap-5 py-3">
                <div><div className="text-sm font-semibold text-slate-800">{label}</div><div className="text-xs text-slate-500">{hint}</div></div>
                <Toggle checked={cfg.membership[key]} onChange={(value) => set(`membership.${key}`, value)} />
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <h2 className="text-lg font-bold text-slate-900">Plan features</h2>
          <p className="mb-5 mt-1 text-xs text-slate-500">Configure each tier independently. MCX, poll cadence, tracked instruments, and publisher credentials remain admin-only and are never member entitlements.</p>
          <div className="grid gap-5 lg:grid-cols-3">
            {["normal", "premium", "pro"].map((plan) => {
              const planTitle = plan === "normal" ? "Basic" : plan === "premium" ? "StrikLenz Premium" : "StrikLenz Pro";
              return (
                <article key={plan} className="rounded-xl border border-slate-200 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-bold text-slate-900">{planTitle}</h3>
                    <Toggle checked={cfg.membership.plans[plan].enabled} onChange={(value) => set(`membership.plans.${plan}.enabled`, value)} />
                  </div>
                  {plan !== "normal" && (
                    <div className="mb-4 space-y-3">
                      <div className="grid grid-cols-3 gap-2">
                        {["monthly", "quarterly", "yearly"].map((cadence) => (
                          <Field key={cadence} label={`${cadence} ₹`}>
                            <input type="number" min="0" step="1" className={inputCls} value={cfg.pricing[plan][cadence]} onChange={(e) => set(`pricing.${plan}.${cadence}`, e.target.value)} />
                          </Field>
                        ))}
                      </div>
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                        <p className="text-[11px] leading-4 text-slate-600">
                          Optional first-period price. Verify the matching Razorpay Dashboard offer is a single-use flat discount equal to regular price minus this price. Set offer failure to block payment, so a customer cannot be charged the regular amount by mistake. StrikLenz can check that an offer ID is present, but cannot inspect its provider-side discount.
                        </p>
                        <div className="mt-3 grid grid-cols-3 gap-2" data-testid={`offer-price-grid-${plan}`}>
                          {["monthly", "quarterly", "yearly"].map((cadence) => (
                            <Field
                              key={`offer-price-${cadence}`}
                              label={`${cadence} first period ₹`}
                              hint={Number(cfg.pricing[plan].offer_prices[cadence]) > 0
                                && Number(cfg.pricing[plan].offer_prices[cadence]) < Number(cfg.pricing[plan][cadence])
                                ? `Use a single-use flat Razorpay discount of ₹${(Number(cfg.pricing[plan][cadence]) - Number(cfg.pricing[plan].offer_prices[cadence])).toLocaleString("en-IN", { maximumFractionDigits: 2 })}.`
                                : "Leave blank to charge the regular cadence price."}
                            >
                              <input
                                type="number"
                                min="0.01"
                                max={Math.max(0, Number(cfg.pricing[plan][cadence]) - 0.01)}
                                step="0.01"
                                className={inputCls}
                                value={cfg.pricing[plan].offer_prices[cadence]}
                                onChange={(e) => set(`pricing.${plan}.offer_prices.${cadence}`, e.target.value)}
                                placeholder="No offer"
                                aria-label={`${plan} ${cadence} first-period offer price`}
                              />
                            </Field>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-[11px] leading-4 text-slate-600" data-testid={`razorpay-offer-help-${plan}`}>
                          Add the matching offer ID for each billing cadence with a first-period price. The provider offer must match the discount above; offers are also needed when the separate percentage promotion is enabled.
                        </p>
                        <div className="mt-3 grid grid-cols-3 gap-2" data-testid={`razorpay-offer-grid-${plan}`}>
                          {["monthly", "quarterly", "yearly"].map((cadence) => (
                            <Field key={`offer-${cadence}`} label={`${cadence} offer ID`}>
                              <input className={inputCls} value={cfg.pricing[plan].razorpay_offer_ids[cadence]} onChange={(e) => set(`pricing.${plan}.razorpay_offer_ids.${cadence}`, e.target.value)} placeholder="offer_..." />
                            </Field>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {plan !== "normal" && (
                    <details className="mb-3">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-600">Razorpay plan IDs</summary>
                      <div className="mt-3 space-y-2">
                        {["monthly", "quarterly", "yearly"].map((cadence) => (
                          <Field key={cadence} label={`${cadence} provider plan ID`}>
                            <input className={inputCls} value={cfg.pricing[plan].razorpay_plan_ids[cadence]} onChange={(e) => set(`pricing.${plan}.razorpay_plan_ids.${cadence}`, e.target.value)} placeholder="plan_..." />
                          </Field>
                        ))}
                      </div>
                    </details>
                  )}
                  <div className="space-y-1">
                    {MEMBER_FEATURES.map((feature) => (
                      <label key={feature.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={cfg.membership.plans[plan].features.includes(feature.id)}
                          onChange={(e) => {
                            const old = cfg.membership.plans[plan].features;
                            const features = e.target.checked ? [...old, feature.id] : old.filter((id) => id !== feature.id);
                            set(`membership.plans.${plan}.features`, features);
                          }}
                        />
                        {feature.label}
                      </label>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <h2 className="text-lg font-bold text-slate-900">Early-access discount</h2>
          <p className="mb-4 mt-1 text-xs text-slate-500">Applied to the first paid billing period only; future renewals use the configured plan price.</p>
          <div className="grid items-end gap-4 sm:grid-cols-[1fr_220px]">
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
              <span className="text-sm font-semibold text-slate-800">Promotion active</span>
              <Toggle checked={cfg.membership.early_access.enabled} onChange={(value) => set("membership.early_access.enabled", value)} />
            </div>
            <Field label="First-period discount (%)">
              <input type="number" min="0" max="100" step="1" className={inputCls} value={cfg.membership.early_access.discount_percent} onChange={(e) => set("membership.early_access.discount_percent", e.target.value)} />
            </Field>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <h2 className="text-lg font-bold text-slate-900">New-member preference defaults</h2>
          <p className="mb-4 mt-1 text-xs text-slate-500">Copied when an account is created. Later changes here will not overwrite a member’s saved preferences. These settings do not include poll or MCX controls.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Default alert indices</div>
              <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-xl border border-slate-300 px-3 py-2.5">
                {["NIFTY", "SENSEX", "BANKNIFTY"].map((index) => (
                  <label key={index} className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={cfg.membership.preference_defaults.alert_indices.includes(index)}
                      onChange={(e) => {
                        const old = cfg.membership.preference_defaults.alert_indices;
                        const indices = e.target.checked ? [...old, index] : old.filter((item) => item !== index);
                        set("membership.preference_defaults.alert_indices", indices);
                      }}
                    />
                    {index}
                  </label>
                ))}
              </div>
            </div>
            <Field label="Default OI-change threshold (%)">
              <input type="number" min="1" max="100" className={inputCls} value={cfg.membership.preference_defaults.oi_change_threshold_pct} onChange={(e) => set("membership.preference_defaults.oi_change_threshold_pct", e.target.value)} />
            </Field>
            <Field label="Default alert cooldown (seconds)">
              <input type="number" min="30" max="3600" className={inputCls} value={cfg.membership.preference_defaults.alert_cooldown_seconds} onChange={(e) => set("membership.preference_defaults.alert_cooldown_seconds", e.target.value)} />
            </Field>
            <Field label="Default OI-shift threshold (contracts)">
              <input type="number" min="1" max="100000000" className={inputCls} value={cfg.membership.preference_defaults.oi_shift_threshold_contracts} onChange={(e) => set("membership.preference_defaults.oi_shift_threshold_contracts", e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <div className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Default alert types</div>
              <div className="flex flex-wrap gap-3 rounded-xl border border-slate-300 px-3 py-2.5">
                {[
                  ["oi_change", "OI change"],
                  ["oi_shift", "OI shift"],
                  ["market_intel", "Market Intel"],
                  ["event", "Events"],
                ].map(([key, label]) => (
                  <label key={key} className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={cfg.membership.preference_defaults.alert_types[key]}
                      onChange={(e) => set(`membership.preference_defaults.alert_types.${key}`, e.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Legacy pricing */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <div className="mb-4 flex items-center gap-2"><IndianRupee className="h-5 w-5 text-emerald-600" /><h2 className="text-lg font-bold text-slate-900">Payment provider</h2></div>
          <p className="mb-3 text-xs text-slate-500">Pricing and provider plan IDs are configured with the paid tiers above. Sales stay unavailable to users until credentials, webhook verification, and every enabled paid plan/cadence are ready.</p>
          <div className={`mb-4 rounded-lg border px-3 py-2 text-xs ${cfg.billing_readiness.ready ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`} role="status">
            Razorpay credentials: {cfg.billing_readiness.credentials_ready ? "configured" : "incomplete"} · Plan prices and IDs: {cfg.billing_readiness.plan_ids_and_prices_ready ? "configured" : "incomplete"}
            {(cfg.membership.early_access.enabled && cfg.membership.early_access.discount_percent > 0
              || ["premium", "pro"].some((plan) => ["monthly", "quarterly", "yearly"].some(
                (cadence) => Number(cfg.pricing[plan].offer_prices[cadence]) > 0,
              )))
              ? ` · First-period offer IDs: ${cfg.billing_readiness.offer_ids_ready ? "present" : "incomplete"}`
              : ""}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Currency"><input className={inputCls} value={cfg.pricing.currency} onChange={(e) => set("pricing.currency", e.target.value.toUpperCase())} /></Field>
          </div>
        </section>

        {/* Google */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-600" /><h2 className="text-lg font-bold text-slate-900">Google Sign-In</h2></div>
            <Toggle label="Google Sign-In" checked={cfg.google.enabled} onChange={(v) => set("google.enabled", v)} />
          </div>
          <div className="mb-4 flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">Allow guest sign-in</p>
              <p className="mt-0.5 text-xs text-slate-500">When off, new visitors can sign in only with Google. Existing sessions are not revoked.</p>
            </div>
            <Toggle label="Allow guest sign-in" checked={cfg.guest_login_enabled} onChange={(v) => set("guest_login_enabled", v)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client ID"><input className={inputCls} value={cfg.google.client_id} onChange={(e) => set("google.client_id", e.target.value)} placeholder="xxxx.apps.googleusercontent.com" /></Field>
            <Field label="Client Secret" hint={cfg.google.client_secret_set ? "A secret is saved. Leave blank to keep it." : "Not set yet."}>
              <input type="password" className={inputCls} value={cfg.google.client_secret} onChange={(e) => set("google.client_secret", e.target.value)} placeholder={cfg.google.client_secret_set ? "•••••••• (saved)" : "Paste secret"} />
            </Field>
            <Field label="Redirect URI" hint="Add this exact URI to your Google OAuth client."><input className={inputCls} value={cfg.google.redirect_uri} onChange={(e) => set("google.redirect_uri", e.target.value)} /></Field>
          </div>
        </section>

        {/* Razorpay */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-indigo-600" /><h2 className="text-lg font-bold text-slate-900">Razorpay (Premium payments)</h2></div>
            <Toggle checked={cfg.razorpay.enabled} onChange={(v) => set("razorpay.enabled", v)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Key ID"><input className={inputCls} value={cfg.razorpay.key_id} onChange={(e) => set("razorpay.key_id", e.target.value)} placeholder="rzp_live_xxx" /></Field>
            <Field label="Key Secret" hint={cfg.razorpay.key_secret_set ? "A secret is saved. Leave blank to keep it." : "Not set yet."}>
              <input type="password" className={inputCls} value={cfg.razorpay.key_secret} onChange={(e) => set("razorpay.key_secret", e.target.value)} placeholder={cfg.razorpay.key_secret_set ? "•••••••• (saved)" : "Paste secret"} />
            </Field>
            <Field label="Webhook Secret" hint={cfg.razorpay.webhook_secret_set ? "A webhook secret is saved. Leave blank to keep it." : "Not set yet. Payments cannot be enabled until it is configured."}>
              <input type="password" className={inputCls} value={cfg.razorpay.webhook_secret} onChange={(e) => set("razorpay.webhook_secret", e.target.value)} placeholder={cfg.razorpay.webhook_secret_set ? "•••••••• (saved)" : "Paste webhook secret"} />
            </Field>
          </div>
        </section>

        {/* Brokers */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <div className="mb-4 flex items-center gap-2"><PlugZap className="h-5 w-5 text-emerald-600" /><h2 className="text-lg font-bold text-slate-900">Broker integrations</h2></div>
          <p className="mb-4 text-xs text-slate-400">Enable a broker and paste its OAuth credentials. The active broker connection is managed by the existing integration.</p>
          <div className="space-y-2">
            {cfg.brokers.map((b, i) => (
              <div key={b.id} className="rounded-xl border border-slate-200">
                <div className="flex items-center justify-between px-4 py-3">
                  <button className="flex items-center gap-2 text-left" onClick={() => setOpenBroker(openBroker === b.id ? null : b.id)}>
                    <ChevronDown className={`h-4 w-4 text-slate-400 transition ${openBroker === b.id ? "rotate-180" : ""}`} />
                    <span className="font-semibold text-slate-800">{b.id === "zerodha" ? "Zerodha" : brokerSafeText(b.name)}</span>
                    <span className="hidden gap-1 sm:flex">{b.capabilities.slice(0, 4).map((c) => <span key={c} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-500">{c}</span>)}</span>
                  </button>
                  <Toggle checked={b.enabled} onChange={(v) => setBroker(i, "enabled", v)} />
                </div>
                {openBroker === b.id && (
                  <div className="grid gap-4 border-t border-slate-100 px-4 py-4 sm:grid-cols-2">
                    <Field label="Client / API Key"><input className={inputCls} value={b.client_id} onChange={(e) => setBroker(i, "client_id", e.target.value)} /></Field>
                    <Field label="API Secret" hint={b.client_secret_set ? "Saved. Leave blank to keep." : "Not set yet."}>
                      <input type="password" className={inputCls} value={b.client_secret} onChange={(e) => setBroker(i, "client_secret", e.target.value)} placeholder={b.client_secret_set ? "•••••••• (saved)" : "Paste secret"} />
                    </Field>
                    <Field label="Redirect URI"><input className={inputCls} value={b.redirect_uri} onChange={(e) => setBroker(i, "redirect_uri", e.target.value)} placeholder="https://striklenz.com/broker/callback" /></Field>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
