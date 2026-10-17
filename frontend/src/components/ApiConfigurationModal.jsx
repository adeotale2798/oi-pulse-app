import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, Code2, Database, ExternalLink, Layers3, RefreshCw, Search, ServerCog, ShieldCheck, Wrench, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import AdminDialogNavigation from "@/components/AdminDialogNavigation";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { brokerSafeText } from "@/lib/brokerCopy";

const STATUS = {
  healthy: "bg-emerald-500", warning: "bg-amber-400", failed: "bg-rose-500", unknown: "bg-slate-300",
};

const TECH_STACK = [
  {
    title: "Web app",
    eyebrow: "WHAT ADMINS AND MEMBERS USE",
    icon: Code2,
    description: "The pages, dashboards, forms, charts and controls that run in the browser.",
    technologies: ["React 19", "JavaScript + JSX", "React Router 7", "Tailwind CSS 3", "Radix UI", "Recharts 3"],
  },
  {
    title: "Application server",
    eyebrow: "SECURE API AND APP LOGIC",
    icon: Layers3,
    description: "Receives app requests, applies access rules, runs backend services and returns data to the web app.",
    technologies: ["Python 3.11+", "FastAPI", "Pydantic 2", "Starlette", "Uvicorn"],
  },
  {
    title: "Database",
    eyebrow: "APP DATA STORAGE",
    icon: Database,
    description: "Stores market snapshots, account and app settings, sessions, journals and other records.",
    technologies: ["MongoDB 6+", "Motor (async access)", "PyMongo"],
  },
  {
    title: "External services",
    eyebrow: "DATA AND CONNECTIVITY",
    icon: ShieldCheck,
    description: "The server connects to these services when their related app feature is configured or used.",
    technologies: ["Broker REST API and WebSocket", "Market-data APIs", "News feeds and APIs", "Optional AI APIs", "Telegram notifications"],
  },
  {
    title: "Build and quality tools",
    eyebrow: "DEVELOPMENT AND RELEASE",
    icon: Wrench,
    description: "Used to install app packages, create production builds, and check changes with tests and linting.",
    technologies: ["Node.js 18+", "Yarn Classic 1.x", "pip", "pytest", "Jest", "ESLint"],
  },
];

function statusLabel(status) {
  return ({ healthy: "Healthy", warning: "Warning", failed: "Failed", unknown: "No telemetry yet" })[status] || "Unknown";
}

function fmtNumber(value) {
  return Number(value || 0).toLocaleString();
}

function fmtLatency(value) {
  return value == null ? "—" : `${Math.round(value)} ms`;
}

function fmtTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", day: "2-digit", month: "short" });
}

function sourceFor(provider) {
  if (provider.id === "twelve-data") return "adr";
  if (provider.id === "kite-connect") return "broker";
  if (provider.category === "News") return "market_intel";
  return "log";
}

function Metric({ label, value }) {
  return <div className="border-l border-slate-200 pl-2"><div className="text-[9px] uppercase tracking-wider text-slate-400">{label}</div><div className="font-mono-data text-xs font-semibold text-slate-800">{value}</div></div>;
}

export default function ApiConfigurationModal({ open, onOpenChange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [mode, setMode] = useState("apis");
  const [section, setSection] = useState("api");
  const [selected, setSelected] = useState(null);
  const [mobileMetricsOpen, setMobileMetricsOpen] = useState(false);
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const r = await api.get("/external-api-registry", { timeout: 15000, params: { _: Date.now() } });
      setData(r.data);
    } catch (e) {
      setError(brokerSafeText(e?.response?.data?.detail || "Could not load the external API registry"));
    } finally { setLoading(false); }
  };

  useEffect(() => { if (open && section === "api" && !data) load(); }, [open, data, section]);
  useEffect(() => {
    if (!open) {
      setSelected(null);
      setSection("api");
    }
  }, [open]);

  const providers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.providers || []).filter((provider) => {
      if (category !== "all" && provider.category !== category) return false;
      if (status !== "all" && provider.status !== status) return false;
      const haystack = [provider.name, provider.category, ...provider.modules, ...provider.endpoints.flatMap((x) => [x.endpoint, ...x.modules, ...x.purposes])].join(" ").toLowerCase();
      return !needle || haystack.includes(needle);
    });
  }, [data, query, category, status]);

  const moduleRows = useMemo(() => {
    const grouped = {};
    providers.forEach((provider) => provider.endpoints.forEach((endpoint) => endpoint.modules.forEach((module) => {
      const row = grouped[module] ||= { module, endpoints: [] };
      row.endpoints.push({ provider: provider.name, endpoint: endpoint.endpoint, purpose: endpoint.purposes.join(" ") });
    })));
    return Object.values(grouped).sort((a, b) => a.module.localeCompare(b.module));
  }, [providers]);

  const categories = [...new Set((data?.providers || []).map((p) => p.category))].sort();
  const summary = data?.summary || {};
  const viewErrors = (provider) => {
    window.dispatchEvent(new CustomEvent("oi-open-error-log", { detail: { source: sourceFor(provider) } }));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(94vw,78rem)] w-[94vw] h-[min(90dvh,56rem)] max-h-[90dvh] overflow-hidden flex flex-col rounded-xl max-md:w-screen max-md:max-w-none max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:rounded-none max-md:p-3 max-md:pt-[calc(env(safe-area-inset-top)+0.75rem)]" data-testid="api-configuration-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">API Config &amp; Stack<AdminDialogNavigation /></DialogTitle>
          <DialogDescription>Explore configured API activity or review the technologies used to build this app.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="API configuration and technology stack">
          <button
            type="button"
            data-testid="tile-api-configuration"
            aria-pressed={section === "api"}
            onClick={() => setSection("api")}
            className={`flex min-h-16 items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
              section === "api" ? "border-emerald-600 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <ServerCog aria-hidden="true" className="h-5 w-5 shrink-0" />
            <span><span className="block text-sm font-semibold">API Configuration</span><span className="mt-0.5 block text-xs opacity-75">Provider activity, endpoints and telemetry</span></span>
          </button>
          <button
            type="button"
            data-testid="tile-tech-stack"
            aria-pressed={section === "stack"}
            onClick={() => setSection("stack")}
            className={`flex min-h-16 items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
              section === "stack" ? "border-emerald-600 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <Layers3 aria-hidden="true" className="h-5 w-5 shrink-0" />
            <span><span className="block text-sm font-semibold">Tech Stack</span><span className="mt-0.5 block text-xs opacity-75">Frameworks, services and developer tooling</span></span>
          </button>
        </div>
        {section === "stack" ? (
          <div data-testid="tech-stack-content" className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
            <section className="rounded-lg border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white p-3 sm:p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-800">StrikLenz at a glance</div>
              <p className="mt-1 text-sm leading-relaxed text-slate-700">
                A browser-based trading desk. The web app talks to a Python server, which stores app data and connects to market and account services.
              </p>
              <div className="mt-3 grid gap-2 text-center text-xs font-semibold text-slate-700 sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] sm:items-center">
                <div className="rounded-md border border-slate-200 bg-white px-2 py-2">Your browser<span className="mt-0.5 block text-[10px] font-normal text-slate-500">Web app</span></div>
                <span aria-hidden="true" className="hidden text-emerald-700 sm:block">→</span>
                <div className="rounded-md border border-slate-200 bg-white px-2 py-2">App server<span className="mt-0.5 block text-[10px] font-normal text-slate-500">FastAPI</span></div>
                <span aria-hidden="true" className="hidden text-emerald-700 sm:block">↔</span>
                <div className="rounded-md border border-slate-200 bg-white px-2 py-2">App database<span className="mt-0.5 block text-[10px] font-normal text-slate-500">MongoDB</span></div>
                <span aria-hidden="true" className="hidden text-emerald-700 sm:block">↔</span>
                <div className="rounded-md border border-slate-200 bg-white px-2 py-2">External services<span className="mt-0.5 block text-[10px] font-normal text-slate-500">Market and account data</span></div>
              </div>
            </section>
            <div className="grid gap-3 sm:grid-cols-2">
              {TECH_STACK.map(({ title, eyebrow, description, icon: Icon, technologies }) => (
                <section key={title} className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Icon aria-hidden="true" className="h-4 w-4" /></span>
                    <div className="min-w-0">
                      <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">{eyebrow}</div>
                      <h3 className="mt-0.5 text-sm font-semibold text-slate-900">{title}</h3>
                    </div>
                  </div>
                  <p className="mt-2 min-h-10 text-xs leading-relaxed text-slate-600">{description}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {technologies.map((technology) => (
                      <span key={technology} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700">{technology}</span>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
              Versions shown are the app’s declared major versions and runtime minimums. The complete dependency list and exact package versions are in STACK.md in the project repository.
            </p>
          </div>
        ) : selected ? (
          <>
            <DialogHeader><DialogTitle className="flex items-center gap-2"><ServerCog className="w-4 h-4" />{brokerSafeText(selected.name)}<AdminDialogNavigation /></DialogTitle><DialogDescription>{brokerSafeText(selected.category)} · {brokerSafeText(selected.host)} · {brokerSafeText(selected.auth)}</DialogDescription></DialogHeader>
            <div className="flex items-center justify-between"><Button size="sm" variant="outline" onClick={() => setSelected(null)}><ArrowLeft className="w-3.5 h-3.5 mr-1" />All providers</Button><span className="inline-flex items-center gap-1.5 text-xs font-medium"><i className={`h-2 w-2 rounded-full ${STATUS[selected.status]}`} />{statusLabel(selected.status)}</span></div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-md border border-slate-200 bg-slate-50/70 p-2.5"><Metric label="Requests today" value={fmtNumber(selected.requests_today)} /><Metric label="Errors today" value={fmtNumber(selected.errors_today)} /><Metric label="Average latency" value={fmtLatency(selected.avg_latency_ms)} /><Metric label="Endpoints" value={selected.endpoints.length} /></div>
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => viewErrors(selected)}>View errors</Button><span className="text-[11px] text-slate-500 self-center">Errors open in the existing Error Log, filtered to this integration where a source is available.</span></div>
            <div className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-200 overscroll-contain">
              <table className="w-full min-w-[47rem] text-[11px]"><thead className="sticky top-0 bg-slate-50 text-[9px] uppercase tracking-wide text-slate-500"><tr><th className="text-left px-2 py-2">Endpoint</th><th className="text-left px-2 py-2">Used by / purpose</th><th className="text-right px-2 py-2">Requests</th><th className="text-right px-2 py-2">Errors</th><th className="text-right px-2 py-2">Latency</th><th className="text-left px-2 py-2">Status</th></tr></thead><tbody>
                {selected.endpoints.map((endpoint) => <tr key={`${endpoint.method}-${endpoint.endpoint}`} className="border-t border-slate-100 align-top"><td className="px-2 py-2 font-mono-data text-slate-800"><b>{endpoint.method}</b> {endpoint.endpoint}{!/\b(?:kite|zerodha)\b/i.test(selected.id) && <div className="mt-1 text-[9px] text-slate-400">{endpoint.code_references.join(" · ")}</div>}</td><td className="px-2 py-2"><div className="font-medium">{endpoint.modules.map(brokerSafeText).join(" · ")}</div><div className="mt-0.5 text-slate-500">{endpoint.purposes.map(brokerSafeText).join(" ")}</div></td><td className="px-2 py-2 text-right font-mono-data">{fmtNumber(endpoint.requests_today)}</td><td className="px-2 py-2 text-right font-mono-data">{fmtNumber(endpoint.errors_today)}</td><td className="px-2 py-2 text-right font-mono-data">{fmtLatency(endpoint.avg_latency_ms)}</td><td className="px-2 py-2"><span className="inline-flex items-center gap-1"><i className={`h-1.5 w-1.5 rounded-full ${STATUS[endpoint.status]}`} />{statusLabel(endpoint.status)}</span><div className="mt-1 text-[9px] text-slate-400">Last: {fmtTime(endpoint.last_request)}</div></td></tr>)}
              </tbody></table>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-slate-500">Tracked providers are discovered from source. “Called today” counts providers with telemetry-recorded requests since local midnight; it does not indicate configuration or future availability.</p>
            <button type="button" className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-700 md:hidden" onClick={() => setMobileMetricsOpen((open) => !open)} aria-expanded={mobileMetricsOpen}>Summary <ChevronDown className={`h-4 w-4 transition-transform ${mobileMetricsOpen ? "rotate-180" : ""}`} /></button>
            <div className={`${mobileMetricsOpen ? "grid" : "hidden"} md:grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200`}>{[["Tracked providers", summary.providers], ["Endpoints", summary.endpoints], ["Modules", summary.modules], ["Called today", summary.active], ["Healthy", summary.healthy], ["Warning", summary.warning], ["Errors today", summary.errors_today], ["Avg latency", fmtLatency(summary.avg_latency_ms)]].map(([label, value]) => <div key={label} className="bg-white px-2 py-2"><div className="text-[9px] uppercase tracking-wide text-slate-400">{label}</div><div className="mt-0.5 font-mono-data text-sm font-bold text-slate-800">{value ?? "—"}</div></div>)}</div>
            <button type="button" className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-700 md:hidden" onClick={() => setMobileControlsOpen((open) => !open)} aria-expanded={mobileControlsOpen}>Search and filters <ChevronDown className={`h-4 w-4 transition-transform ${mobileControlsOpen ? "rotate-180" : ""}`} /></button>
            <div className={`${mobileControlsOpen ? "flex" : "hidden"} md:flex flex-wrap items-center gap-2`}><div className="relative flex-1 min-w-[12rem]"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search APIs, endpoints, modules…" className="h-8 w-full rounded-md border border-slate-200 pl-8 pr-2 text-xs outline-none focus:border-emerald-500" /></div><select value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"><option value="all">All categories</option>{categories.map((x) => <option key={x}>{x}</option>)}</select><select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"><option value="all">All health</option><option value="healthy">Healthy</option><option value="warning">Warning</option><option value="failed">Failed</option><option value="unknown">No telemetry</option></select><Button size="sm" variant="outline" onClick={load} disabled={loading}>{loading ? "Loading…" : <><RefreshCw className="w-3.5 h-3.5 mr-1" />Refresh</>}</Button></div>
            <div className="flex gap-1 border-b border-slate-200"><button className={`px-3 py-1.5 text-xs font-medium border-b-2 ${mode === "apis" ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500"}`} onClick={() => setMode("apis")}>APIs</button><button className={`px-3 py-1.5 text-xs font-medium border-b-2 ${mode === "modules" ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500"}`} onClick={() => setMode("modules")}>Modules</button></div>
            {error ? <div className="text-xs text-rose-600">{error}</div> : null}
            <div className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-200 overscroll-contain">
              {mode === "apis" ? <div className="divide-y divide-slate-100">{providers.map((provider) => <button key={provider.id} onClick={() => setSelected(provider)} className="w-full text-left px-3 py-2.5 hover:bg-emerald-50/50 transition-colors"><div className="flex items-start gap-2"><i className={`mt-1 h-2 w-2 shrink-0 rounded-full ${STATUS[provider.status]}`} /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-xs font-semibold text-slate-800">{brokerSafeText(provider.name)}</span><span className="text-[10px] text-slate-400">{brokerSafeText(provider.category)}</span></div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500"><span>{provider.endpoints.length} endpoint{provider.endpoints.length === 1 ? "" : "s"}</span><span>{provider.modules.map(brokerSafeText).join(" · ")}</span><span>{fmtNumber(provider.requests_today)} requests today</span><span>{fmtLatency(provider.avg_latency_ms)}</span></div><div className="mt-1 font-mono-data text-[10px] text-slate-500 truncate">{provider.endpoints.map((x) => `${x.method} ${x.endpoint}`).join("  ·  ")}</div></div><ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400" /></div></button>)}{!loading && providers.length === 0 ? <div className="p-8 text-center text-xs text-slate-400">No providers match these filters.</div> : null}</div> : <div className="divide-y divide-slate-100">{moduleRows.map((row) => <div key={row.module} className="px-3 py-2.5"><div className="text-xs font-semibold text-slate-800">{brokerSafeText(row.module)}</div><div className="mt-1 space-y-1">{row.endpoints.map((endpoint, i) => <div key={`${endpoint.provider}-${endpoint.endpoint}-${i}`} className="text-[11px] text-slate-600"><b>{brokerSafeText(endpoint.provider)}</b> <span className="font-mono-data">{endpoint.endpoint}</span> <span className="text-slate-400">— {brokerSafeText(endpoint.purpose)}</span></div>)}</div></div>)}</div>}
            </div>
            <p className="text-[10px] text-slate-500">Telemetry begins after this version starts. It stores only provider, route, method, response code, duration and error class—never credentials, headers, request bodies or responses.</p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
