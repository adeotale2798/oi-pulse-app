import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowDown, ArrowLeft, ArrowUp, Database, Loader2, RefreshCw, Save } from "lucide-react";
import "@/styles/landing.css";
import OiPulseLogo from "@/components/OiPulseLogo";
import { api } from "@/lib/api";
import { brokerSafeText } from "@/lib/brokerCopy";
import { LANDING_COPY_FIELDS, normalizeLandingCopy } from "@/lib/landingCopy";
import { PLAN_FEATURE_DETAILS } from "@/components/landing/planFeatureDetails";
import PlanWalkthrough from "@/components/landing/PlanWalkthrough";
import { captureLandingPlanSnapshot } from "@/lib/landingPlanPreview";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const SECTION_OPTIONS = [
  ["navigation", "Top navigation", "Brand, page links, login and demo links."],
  ["hero", "Hero introduction", "Main headline, introductory copy and start buttons."],
  ["ticker", "Market ticker", "Live shared-market prices for the required market references and all Admin-enabled indices below the hero."],
  ["features", "Feature cards", "Product feature grid; individual cards can be selected below."],
  ["product_demo", "Product demo", "Interactive screenshots and tour."],
  ["pro_showcase", "Pro showcase", "Pro positions, private journal and market-context preview."],
  ["broker_connect", "Connect your broker section", "Broker directory and broker-connection copy. Off by default."],
  ["pricing", "Plan pricing", "Basic, Premium and Pro comparison. Plan availability and features remain in Admin Settings."],
  ["faq", "Frequently asked questions", "Questions and answers about the product and plans."],
  ["bottom_cta", "Bottom call to action", "Sign-up prompt above the footer."],
  ["footer", "Footer", "Brand, risk notice and footer links."],
];

const FEATURE_CARD_OPTIONS = [
  ["option_chain", "Full Option Chain"],
  ["strike_pressure", "Strike Pressure"],
  ["global_markets", "Global Markets"],
  ["straddle", "Straddle"],
  ["market_events", "Market & Global Events"],
  ["desk_ai", "Desk AI"],
];
const PLAN_SCREENSHOT_LIMIT = 3;
const PLAN_SCREENSHOT_MAX_BYTES = 600 * 1024;
const PLAN_OPTIONS = [
  ["normal", "Basic"],
  ["premium", "StrikLenz Premium"],
  ["pro", "StrikLenz Pro"],
];

const FALLBACK_SECTIONS = Object.fromEntries(
  SECTION_OPTIONS.map(([id]) => [id, id !== "broker_connect"]),
);

function normalizeConfig(raw, membership) {
  const planFeatures = Object.fromEntries(PLAN_OPTIONS.map(([planId]) => {
    const available = (membership?.plans?.[planId]?.features || [])
      .filter((featureId) => PLAN_FEATURE_DETAILS[featureId]);
    const configured = raw?.plan_walkthrough_features?.[planId];
    return [
      planId,
      Array.isArray(configured)
        ? configured.filter((featureId) => available.includes(featureId))
        : available,
    ];
  }));
  const featureCopy = Object.fromEntries(
    Object.entries(PLAN_FEATURE_DETAILS).map(([featureId, detail]) => {
      const configured = featureId === "desk_ai" ? {} : raw?.plan_walkthrough_copy?.[featureId] || {};
      return [featureId, {
        description: typeof configured.description === "string" ? configured.description : detail.description,
        edge: typeof configured.edge === "string" ? configured.edge : detail.edge,
      }];
    }),
  );
  return {
    sections: Object.fromEntries(
      SECTION_OPTIONS.map(([id]) => [id, raw?.sections?.[id] ?? FALLBACK_SECTIONS[id]]),
    ),
    plan_more_info_enabled: raw?.plan_more_info_enabled !== false,
    feature_cards: Array.isArray(raw?.feature_cards)
      ? raw.feature_cards
        .map((id) => id === "market_structure" ? "global_markets" : id)
        .flatMap((id) => id === "oi_distribution" ? ["straddle", "market_events"] : [id])
        .filter((id) => FEATURE_CARD_OPTIONS.some(([known]) => known === id))
      : FEATURE_CARD_OPTIONS.map(([id]) => id),
    broker_ids: Array.isArray(raw?.broker_ids) ? raw.broker_ids : [],
    plan_screenshots: Object.fromEntries(PLAN_OPTIONS.map(([id]) => [
      id,
      (Array.isArray(raw?.plan_screenshots?.[id]) ? raw.plan_screenshots[id] : [])
        .filter((shot) => shot && typeof shot.id === "string"
          && typeof shot.title === "string"
          && /^data:image\/(png|jpeg|webp);base64,/.test(shot.data_url || ""))
        .slice(0, PLAN_SCREENSHOT_LIMIT),
    ])),
    plan_walkthrough_features: planFeatures,
    plan_walkthrough_copy: featureCopy,
    copy: normalizeLandingCopy(raw?.copy),
    plan_demo_snapshot: raw?.plan_demo_snapshot || null,
  };
}

function compressPlanScreenshot(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024) {
      reject(new Error("Choose an image smaller than 20 MB"));
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxDimension = 1440;
      let scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      let dataUrl = "";
      for (let attempt = 0; attempt < 10; attempt += 1) {
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Could not prepare this screenshot"));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const quality = Math.max(0.5, 0.84 - (attempt % 4) * 0.1);
        dataUrl = canvas.toDataURL("image/webp", quality);
        if (!dataUrl.startsWith("data:image/webp,")) {
          dataUrl = canvas.toDataURL("image/jpeg", quality);
        }
        const encodedLength = dataUrl.split(",", 2)[1]?.length || 0;
        const estimatedBytes = Math.floor(encodedLength * 3 / 4);
        if (estimatedBytes <= PLAN_SCREENSHOT_MAX_BYTES) {
          const id = typeof globalThis.crypto?.randomUUID === "function"
            ? globalThis.crypto.randomUUID()
            : `shot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          resolve({ id, title: file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "Plan screenshot", data_url: dataUrl });
          return;
        }
        scale *= 0.82;
      }
      reject(new Error("Could not compress this image below 600 KB"));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("This image could not be opened"));
    };
    image.src = objectUrl;
  });
}

function VisibilityToggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-emerald-500" : "bg-slate-300"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function CheckOption({ checked, label, onChange, disabled = false }) {
  return (
    <label className={`flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function sourceCount(items, label) {
  const count = Array.isArray(items) ? items.length : 0;
  return count ? `${count} ${label}` : "no current data";
}

export default function AdminLandingPage() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [config, setConfig] = useState(null);
  const [brokers, setBrokers] = useState([]);
  const [membership, setMembership] = useState(null);
  const [previewPlan, setPreviewPlan] = useState("");

  useEffect(() => {
    let alive = true;
    api.get("/admin/platform/config")
      .then(({ data }) => {
        if (!alive) return;
        setMembership(data?.membership || null);
        setConfig(normalizeConfig(data?.landing_page, data?.membership));
        setBrokers(Array.isArray(data?.brokers) ? data.brokers : []);
      })
      .catch((error) => {
        if (error?.response?.status === 401) {
          toast.error("Admin sign-in required");
          nav("/admin", { replace: true });
        } else {
          toast.error("Could not load landing-page settings");
        }
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [nav]);

  const updateSection = (id, value) => setConfig((current) => ({
    ...current,
    sections: { ...current.sections, [id]: value },
  }));

  const updateList = (key, id, checked) => setConfig((current) => {
    const values = new Set(current[key]);
    if (checked) values.add(id);
    else values.delete(id);
    return { ...current, [key]: [...values] };
  });

  const updatePlanScreenshots = (planId, screenshots) => setConfig((current) => ({
    ...current,
    plan_screenshots: { ...current.plan_screenshots, [planId]: screenshots },
  }));

  const updatePlanScreenshotTitle = (planId, screenshotId, title) => {
    const screenshots = config.plan_screenshots[planId] || [];
    updatePlanScreenshots(planId, screenshots.map((shot) => (
      shot.id === screenshotId ? { ...shot, title } : shot
    )));
  };

  const updatePlanFeature = (planId, featureId, enabled) => setConfig((current) => {
    const features = current.plan_walkthrough_features[planId] || [];
    const next = enabled
      ? [...features, featureId]
      : features.filter((value) => value !== featureId);
    return {
      ...current,
      plan_walkthrough_features: {
        ...current.plan_walkthrough_features,
        [planId]: next,
      },
    };
  });

  const movePlanFeature = (planId, featureId, offset) => setConfig((current) => {
    const features = [...(current.plan_walkthrough_features[planId] || [])];
    const index = features.indexOf(featureId);
    const nextIndex = index + offset;
    if (index < 0 || nextIndex < 0 || nextIndex >= features.length) return current;
    [features[index], features[nextIndex]] = [features[nextIndex], features[index]];
    return {
      ...current,
      plan_walkthrough_features: {
        ...current.plan_walkthrough_features,
        [planId]: features,
      },
    };
  });

  const updatePlanFeatureCopy = (featureId, field, value) => setConfig((current) => ({
    ...current,
    plan_walkthrough_copy: {
      ...current.plan_walkthrough_copy,
      [featureId]: {
        ...current.plan_walkthrough_copy[featureId],
        [field]: value,
      },
    },
  }));

  const updateLandingCopy = (key, value) => setConfig((current) => ({
    ...current,
    copy: { ...current.copy, [key]: value },
  }));

  const capturePlanDemo = async () => {
    setCapturing(true);
    try {
      const snapshot = await captureLandingPlanSnapshot();
      const { data } = await api.post("/admin/platform/landing-plan-preview", { snapshot });
      setConfig((current) => ({ ...current, plan_demo_snapshot: data.snapshot }));
      const unavailable = [];
      Object.entries(data.snapshot.indices || {}).forEach(([index, sources]) => {
        if (!sources.oi_change?.current?.strikes?.length) unavailable.push(`${index} OI`);
        if ((sources.straddle?.data?.history || []).length < 2) unavailable.push(`${index} straddle`);
        if (!(sources.events?.data?.events || []).length) unavailable.push(`${index} events`);
      });
      if (!(data.snapshot.market_intel?.data?.items || []).length) unavailable.push("Market Intel");
      if (!(data.snapshot.global_markets?.data?.items || []).length) unavailable.push("Global Markets");
      if (!(data.snapshot.holidays?.data?.holidays || []).length) unavailable.push("holidays");
      if (!(data.snapshot.activity?.data?.items || []).length) unavailable.push("shared Activity");
      if (
        !(data.snapshot.desk_market?.data?.movers || []).length
        || !Object.keys(data.snapshot.desk_market?.data?.breadth || {}).length
      ) unavailable.push("Desk AI market context");
      toast.success(unavailable.length
        ? `Snapshot saved; no current data for: ${unavailable.join(", ")}. Those tabs will use labeled examples.`
        : "Shared market-data snapshot captured and saved");
    } catch (error) {
      toast.error(error?.response?.data?.detail || error?.message || "Could not capture plan preview data");
    } finally {
      setCapturing(false);
    }
  };

  const addPlanScreenshots = async (planId, files) => {
    const current = config.plan_screenshots[planId] || [];
    if (current.length + files.length > PLAN_SCREENSHOT_LIMIT) {
      toast.error(`Add up to ${PLAN_SCREENSHOT_LIMIT} screenshots per plan`);
      return;
    }
    try {
      const screenshots = [];
      for (const file of files) screenshots.push(await compressPlanScreenshot(file));
      updatePlanScreenshots(planId, [...current, ...screenshots]);
    } catch (error) {
      toast.error(error?.message || "Could not add this screenshot");
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/admin/platform/config", { landing_page: config });
      const { data } = await api.get("/admin/platform/config");
      setMembership(data?.membership || null);
      setConfig(normalizeConfig(data?.landing_page, data?.membership));
      setBrokers(Array.isArray(data?.brokers) ? data.brokers : []);
      toast.success("Landing-page settings saved");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not save landing-page settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="slz slz-light flex min-h-screen items-center justify-center text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading landing-page settings…</div>;
  }
  if (!config) return null;

  return (
    <div className="slz slz-light min-h-screen pb-20">
      <header className="sticky top-0 z-30 slz-glass border-b border-slate-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <OiPulseLogo className="h-8 w-8" pulse={false} />
            <span className="text-lg font-bold text-slate-900">Strik<span className="text-emerald-600">lenz</span> <span className="text-slate-400">/ Landing page</span></span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/admin/settings" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Admin Settings</Link>
            <button type="button" onClick={save} disabled={saving} className="slz-btn-primary inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-5 pt-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Landing-page content</h1>
          <p className="mt-1 text-sm text-slate-600">Edit the public page copy, choose which sections and cards visitors see, and manage each plan walkthrough. These settings do not change app access, broker integrations, or plan entitlements.</p>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">Landing-page text</h2>
          <p className="mt-1 text-xs text-slate-500">Edit public headings, descriptions, buttons, feature-card text, FAQs and notices here. Changes publish when you select Save at the top of this page.</p>
          <div className="mt-4 space-y-3">
            {LANDING_COPY_FIELDS.map(({ group, fields }) => (
              <details key={group} className="rounded-xl border border-slate-200 p-3" open={group === "Hero"}>
                <summary className="cursor-pointer text-sm font-semibold text-slate-800">{group}</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {fields.map(([key, label]) => {
                    const multiline = /description|answer|headline/i.test(label);
                    return (
                      <label key={key} className={`block text-[10px] font-semibold uppercase tracking-wide text-slate-500 ${multiline ? "sm:col-span-2" : ""}`}>
                        {label}
                        {multiline ? (
                          <textarea
                            value={config.copy[key] || ""}
                            maxLength={800}
                            rows={3}
                            onChange={(event) => updateLandingCopy(key, event.target.value)}
                            className="mt-1 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal normal-case leading-5 text-slate-700"
                          />
                        ) : (
                          <input
                            value={config.copy[key] || ""}
                            maxLength={800}
                            onChange={(event) => updateLandingCopy(key, event.target.value)}
                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal normal-case text-slate-700"
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              </details>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">Page sections</h2>
          <div className="mt-4 divide-y divide-slate-100">
            {SECTION_OPTIONS.map(([id, label, description]) => (
              <div key={id} className="flex items-center justify-between gap-5 py-3">
                <div>
                  <div className="text-sm font-semibold text-slate-800">{label}</div>
                  <p className="mt-0.5 text-xs text-slate-500">{description}</p>
                </div>
                <VisibilityToggle checked={config.sections[id]} onChange={(value) => updateSection(id, value)} label={`Show ${label}`} />
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">Feature cards</h2>
          <p className="mt-1 text-xs text-slate-500">Shown only when the Feature cards section is enabled.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURE_CARD_OPTIONS.map(([id, label]) => (
              <CheckOption key={id} checked={config.feature_cards.includes(id)} label={label} onChange={(value) => updateList("feature_cards", id, value)} disabled={!config.sections.features} />
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between gap-5">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Plan “More info” buttons</h2>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
                Show or hide the interactive plan walkthrough buttons on the public pricing cards. Turning this off also prevents the public walkthrough data and screenshot endpoints from loading. Plan pricing and entitlements are unchanged.
              </p>
            </div>
            <VisibilityToggle
              checked={config.plan_more_info_enabled}
              onChange={(value) => setConfig((current) => ({
                ...current,
                plan_more_info_enabled: value,
              }))}
              label="Show plan More info buttons"
            />
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Captured plan walkthrough data</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                Capture the shared app feeds below and keep them fixed in plan details until you refresh them here. Activity uses the publisher desk alert tape from this Admin-only action; member-filtered inboxes and broker data are never captured. Positions and journals use fictional examples; Desk AI previews shared market context only and never accesses member positions.
              </p>
            </div>
            <button
              type="button"
              onClick={capturePlanDemo}
              disabled={capturing}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-emerald-700 bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {capturing ? <Loader2 className="h-4 w-4 animate-spin" /> : config.plan_demo_snapshot ? <RefreshCw className="h-4 w-4" /> : <Database className="h-4 w-4" />}
              {capturing ? "Capturing feeds…" : config.plan_demo_snapshot ? "Refresh captured data" : "Capture current app data"}
            </button>
          </div>
          {config.plan_demo_snapshot ? (
            <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold text-emerald-950">
                  Last captured {new Date(config.plan_demo_snapshot.captured_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST
                </p>
                <span className="text-[10px] font-semibold text-emerald-800">Public snapshot · static until refreshed</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(config.plan_demo_snapshot.indices || {}).map(([index, sources]) => (
                  <div key={index} className="rounded-lg border border-emerald-100 bg-white px-3 py-2 text-[11px]">
                    <div className="font-bold text-slate-800">{index}</div>
                    <div className="mt-1 text-slate-600">
                      OI: {sourceCount(sources.oi_change?.current?.strikes, "strikes")}
                      {" · "}Straddle: {sourceCount(sources.straddle?.data?.history, "points")}
                      {" · "}Events: {sourceCount(sources.events?.data?.events, "events")}
                    </div>
                  </div>
                ))}
                <div className="rounded-lg border border-emerald-100 bg-white px-3 py-2 text-[11px] text-slate-600">
                  Market Intel: {sourceCount(config.plan_demo_snapshot.market_intel?.data?.items, "stories")}
                  {" · "}Global Markets: {sourceCount(config.plan_demo_snapshot.global_markets?.data?.items, "instruments")}
                  {" · "}Holiday calendar: {sourceCount(config.plan_demo_snapshot.holidays?.data?.holidays, "dates")}
                  {" · "}Shared Activity: {sourceCount(config.plan_demo_snapshot.activity?.data?.items, "alerts")}
                  {" · "}Desk AI context: {sourceCount(config.plan_demo_snapshot.desk_market?.data?.movers, "movers")}
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
              No shared-feed snapshot has been captured yet. The public walkthrough will show clearly labeled illustrative samples until you capture shared app data here.
            </p>
          )}
          <div className="mt-6 space-y-6">
            {PLAN_OPTIONS.map(([planId, planLabel]) => {
              const available = (membership?.plans?.[planId]?.features || [])
                .filter((featureId) => PLAN_FEATURE_DETAILS[featureId]);
              const selected = config.plan_walkthrough_features[planId] || [];
              return (
                <div key={planId} className="border-t border-slate-100 pt-5 first:border-0 first:pt-0">
                  <h3 className="text-sm font-bold text-slate-800">{planLabel} · walkthrough features</h3>
                  <p className="mt-1 text-xs text-slate-500">Choose and order the entitled features shown in this plan&apos;s “More info” view.</p>
                  <button type="button" onClick={() => setPreviewPlan(planId)} className="mt-2 rounded-full border border-emerald-700 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50">Preview this plan here</button>
                  <div className="mt-3 space-y-2">
                    {available.map((featureId) => {
                      const detail = PLAN_FEATURE_DETAILS[featureId];
                      const selectedIndex = selected.indexOf(featureId);
                      return (
                        <div key={featureId} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2">
                          <CheckOption
                            checked={selectedIndex >= 0}
                            label={detail.title}
                            onChange={(checked) => updatePlanFeature(planId, featureId, checked)}
                          />
                          {selectedIndex >= 0 && (
                            <>
                              <span className="ml-auto text-[10px] text-slate-500">Position {selectedIndex + 1}</span>
                              <button
                                type="button"
                                aria-label={`Move ${detail.title} earlier in ${planLabel}`}
                                disabled={selectedIndex === 0}
                                onClick={() => movePlanFeature(planId, featureId, -1)}
                                className="rounded border border-slate-200 p-1.5 text-slate-600 disabled:opacity-40"
                              ><ArrowUp className="h-3.5 w-3.5" /></button>
                              <button
                                type="button"
                                aria-label={`Move ${detail.title} later in ${planLabel}`}
                                disabled={selectedIndex === selected.length - 1}
                                onClick={() => movePlanFeature(planId, featureId, 1)}
                                className="rounded border border-slate-200 p-1.5 text-slate-600 disabled:opacity-40"
                              ><ArrowDown className="h-3.5 w-3.5" /></button>
                            </>
                          )}
                        </div>
                      );
                    })}
                    {!available.length && <p className="text-xs text-slate-500">No walkthrough-capable features are currently entitled to this plan.</p>}
                  </div>
                  {selected.length > 0 && (
                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      {selected.map((featureId) => {
                        const detail = PLAN_FEATURE_DETAILS[featureId];
                        const copy = config.plan_walkthrough_copy[featureId] || {};
                        return (
                          <div key={featureId} className="rounded-xl border border-slate-200 p-3">
                            <h4 className="text-xs font-bold text-slate-800">{detail.title} · shared copy</h4>
                            {featureId === "desk_ai" && <p className="mt-1 text-[10px] leading-4 text-slate-500">Desk AI copy stays fixed: it uses shared market context and never accesses or comments on member positions.</p>}
                            <label className="mt-2 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              What it does
                              <textarea
                                value={copy.description || ""}
                                maxLength={600}
                                rows={3}
                                disabled={featureId === "desk_ai"}
                                onChange={(event) => updatePlanFeatureCopy(featureId, "description", event.target.value)}
                                className="mt-1 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal normal-case leading-5 text-slate-700 disabled:bg-slate-50 disabled:text-slate-500"
                              />
                            </label>
                            <label className="mt-2 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              User edge
                              <textarea
                                value={copy.edge || ""}
                                maxLength={600}
                                rows={2}
                                disabled={featureId === "desk_ai"}
                                onChange={(event) => updatePlanFeatureCopy(featureId, "edge", event.target.value)}
                                className="mt-1 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal normal-case leading-5 text-slate-700 disabled:bg-slate-50 disabled:text-slate-500"
                              />
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">Optional plan-detail screenshots</h2>
          <p className="mt-1 text-sm text-slate-600">Add up to three compressed PNG, JPEG, or WebP images per plan as supporting illustrations; captured app data powers the feature walkthrough, and these images remain optional.</p>
          <div className="mt-5 space-y-6">
            {PLAN_OPTIONS.map(([planId, planLabel]) => {
              const screenshots = config.plan_screenshots[planId] || [];
              return (
                <div key={planId} className="border-t border-slate-100 pt-5 first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">{planLabel}</h3>
                      <p className="text-xs text-slate-500">{screenshots.length}/{PLAN_SCREENSHOT_LIMIT} screenshots · 600 KB maximum each after compression</p>
                    </div>
                    <label className={`inline-flex cursor-pointer items-center rounded-full border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-emerald-500 hover:text-emerald-700 ${screenshots.length >= PLAN_SCREENSHOT_LIMIT ? "cursor-not-allowed opacity-50" : ""}`}>
                      Add screenshot
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        multiple
                        disabled={screenshots.length >= PLAN_SCREENSHOT_LIMIT}
                        className="sr-only"
                        onChange={(event) => {
                          const files = Array.from(event.target.files || []);
                          if (files.length) addPlanScreenshots(planId, files);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                  {screenshots.length ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {screenshots.map((shot) => (
                        <figure key={shot.id} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                          <img src={shot.data_url} alt={shot.title} className="h-40 w-full bg-white object-contain p-2" />
                          <figcaption className="flex items-center justify-between gap-2 px-3 py-2">
                            <input
                              aria-label={`Screenshot title for ${shot.title}`}
                              value={shot.title}
                              maxLength={120}
                              onChange={(event) => updatePlanScreenshotTitle(planId, shot.id, event.target.value)}
                              className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700"
                            />
                            <button
                              type="button"
                              onClick={() => updatePlanScreenshots(planId, screenshots.filter((item) => item.id !== shot.id))}
                              className="shrink-0 text-xs font-semibold text-rose-600 hover:text-rose-800"
                              aria-label={`Remove ${shot.title}`}
                            >
                              Remove
                            </button>
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">No screenshots added for this plan.</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">Broker directory cards</h2>
          <p className="mt-1 text-xs text-slate-500">The whole Connect your broker section is off by default and stays hidden if no cards are selected. These choices control marketing cards only; Live/Soon status and broker login configuration remain in Admin Settings → Broker integrations.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {brokers.map((broker) => (
              <CheckOption
                key={broker.id}
                checked={config.broker_ids.includes(broker.id)}
                label={brokerSafeText(broker.name)}
                onChange={(value) => updateList("broker_ids", broker.id, value)}
                disabled={!config.sections.broker_connect}
              />
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
          <h2 className="font-bold text-indigo-950">Where plan details are configured</h2>
          <p className="mt-1 text-sm text-indigo-900">Plan names, prices, plan availability and feature entitlements stay in the existing Admin Settings page.</p>
          <Link to="/admin/settings" className="mt-3 inline-flex text-sm font-semibold text-indigo-800 underline">Open Admin Settings</Link>
        </section>
      </main>
      <Dialog open={Boolean(previewPlan)} onOpenChange={(open) => { if (!open) setPreviewPlan(""); }}>
        <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
          <DialogTitle>{PLAN_OPTIONS.find(([id]) => id === previewPlan)?.[1] || "Plan"} walkthrough preview</DialogTitle>
          <DialogDescription>Previewing the current Admin-page selections and shared-feed capture. Capture saves the sanitized market snapshot to public plan details immediately; other page selections and copy remain private until you save the page.</DialogDescription>
          <button
            type="button"
            onClick={capturePlanDemo}
            disabled={capturing}
            className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-700 bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {capturing ? <Loader2 className="h-4 w-4 animate-spin" /> : config.plan_demo_snapshot ? <RefreshCw className="h-4 w-4" /> : <Database className="h-4 w-4" />}
            {capturing ? "Capturing shared feeds…" : config.plan_demo_snapshot ? "Refresh shared feed data" : "Capture shared feed data"}
          </button>
          {previewPlan && (
            <PlanWalkthrough
              planId={previewPlan}
              features={(membership?.plans?.[previewPlan]?.features || [])
                .filter((featureId) => PLAN_FEATURE_DETAILS[featureId])
                .map((id) => ({ id, label: PLAN_FEATURE_DETAILS[id].title }))}
              previewSettings={{
                features: config.plan_walkthrough_features[previewPlan] || [],
                copy: config.plan_walkthrough_copy,
                snapshot: config.plan_demo_snapshot,
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
