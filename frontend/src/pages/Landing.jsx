import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight, Check, Menu, X, Layers, Gauge, Activity,
  Bot, Zap, LineChart, PlugZap, CalendarDays, Smartphone, Tablet,
} from "lucide-react";
import "@/styles/landing.css";
import useLiveDemo from "@/hooks/useLiveDemo";
import OiPulseLogo from "@/components/OiPulseLogo";
import BrowserMock from "@/components/landing/BrowserMock";
import MotionFilm from "@/components/landing/MotionFilm";
import ProductScreen from "@/components/landing/ProductScreen";
import AnalyzeShowcasePreview from "@/components/landing/AnalyzeShowcasePreview";
import ShotTour from "@/components/landing/ShotTour";
import PlanWalkthrough from "@/components/landing/PlanWalkthrough";
import { normalizeLandingCopy } from "@/lib/landingCopy";
import { BRAND, NAV_LINKS, FAQS, PRICING_FALLBACK, money } from "@/config/site";
import { api, fetchExtras, fetchTickers } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const reveal = {
  initial: { opacity: 0, y: 26 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.2 },
  transition: { duration: 0.6 },
};

function Logo({ className = "" }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <OiPulseLogo className="h-9 w-9" pulse={false} />
      <span className="text-xl font-bold tracking-tight text-slate-900">
        Strik<span className="text-emerald-600">Lenz</span>
      </span>
    </div>
  );
}

function Nav({ walkthroughEnabled, sectionVisibility, copy }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState("");
  const sectionForNavLink = {
    product: "product_demo",
    features: "features",
    premium: "pro_showcase",
    pricing: "pricing",
    faq: "faq",
  };
  const visibleLinks = NAV_LINKS.filter((link) => {
    const section = sectionForNavLink[link.id];
    return !section || sectionVisibility[section];
  });
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const visibleSectionIds = visibleLinks.map((link) => link.href.slice(1)).join("|");
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return undefined;
    const sections = visibleSectionIds
      .split("|")
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    const observer = new IntersectionObserver((entries) => {
      const current = entries
        .filter((entry) => entry.isIntersecting)
        .sort((first, second) => second.intersectionRatio - first.intersectionRatio)[0];
      if (current) setActiveSection(current.target.id);
    }, { rootMargin: "-18% 0px -68% 0px", threshold: [0, 0.2, 0.5, 0.8] });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [visibleSectionIds]);
  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition ${scrolled ? "slz-glass shadow-sm" : "bg-transparent"}`}>
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5">
        <Logo />
        <nav className="hidden items-center gap-7 md:flex">
          {visibleLinks.map((l) => (
            <a key={l.id} href={l.href} aria-current={activeSection === l.href.slice(1) ? "location" : undefined} className="slz-nav-link text-sm font-medium text-slate-600 transition hover:text-slate-900">{copy[`nav_${l.id}`] || l.label}</a>
          ))}
        </nav>
        <div className="hidden items-center gap-3 md:flex">
          {walkthroughEnabled && <Link to="/sitewalkthrough" className="text-sm font-semibold text-emerald-700 hover:text-emerald-800">{copy.nav_demo}</Link>}
          <Link to="/login" className="text-sm font-semibold text-slate-700 hover:text-slate-900">{copy.nav_login}</Link>
          <Link to="/login" className="slz-btn-primary inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition">
            {copy.nav_start} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <button className="md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
          {open ? <X className="h-6 w-6 text-slate-800" /> : <Menu className="h-6 w-6 text-slate-800" />}
        </button>
      </div>
      {open && (
        <div className="slz-glass border-t border-slate-200 px-5 py-4 md:hidden">
          <div className="flex flex-col gap-3">
            {visibleLinks.map((l) => (
              <a key={l.id} href={l.href} onClick={() => setOpen(false)} aria-current={activeSection === l.href.slice(1) ? "location" : undefined} className="slz-nav-link text-sm font-medium text-slate-700">{copy[`nav_${l.id}`] || l.label}</a>
            ))}
            {walkthroughEnabled && <Link to="/sitewalkthrough" onClick={() => setOpen(false)} className="text-sm font-semibold text-emerald-700">{copy.nav_demo}</Link>}
            <Link to="/login" className="slz-btn-primary mt-2 rounded-full px-4 py-2.5 text-center text-sm font-semibold">{copy.nav_start}</Link>
          </div>
        </div>
      )}
    </header>
  );
}

// Keep the five requested market references visible even when quote feeds are down.
const REQUIRED_TICKERS = [
  { key: "NIFTY", label: "NIFTY 50" },
  { key: "BANKNIFTY", label: "BANK NIFTY" },
  { key: "SENSEX", label: "SENSEX" },
  { key: "INDIAVIX", label: "INDIA VIX" },
  { key: "GIFTNIFTY", label: "GIFT NIFTY" },
];

function tickerKey(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function tickerNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildTickerItems(tickers, extras) {
  const byKey = new Map();
  (Array.isArray(tickers) ? tickers : []).forEach((ticker) => {
    const key = tickerKey(ticker.index || ticker.label);
    if (!key) return;
    byKey.set(key, {
      key,
      label: ticker.label || ticker.index,
      price: tickerNumber(ticker.ltp),
      changePct: tickerNumber(ticker.change_pct),
    });
  });

  [
    ["INDIAVIX", extras?.vix, (quote) => quote?.last ?? quote?.ltp],
    ["GIFTNIFTY", extras?.gift_nifty, (quote) => quote?.last ?? quote?.ltp],
  ].forEach(([key, quote, getPrice]) => {
    if (!quote) return;
    const existing = byKey.get(key);
    byKey.set(key, {
      key,
      label: existing?.label,
      price: existing?.price ?? tickerNumber(getPrice(quote)),
      changePct: existing?.changePct ?? tickerNumber(quote.change_pct),
    });
  });

  const requiredKeys = new Set(REQUIRED_TICKERS.map(({ key }) => key));
  const required = REQUIRED_TICKERS.map(({ key, label }) => ({
    key,
    label,
    price: byKey.get(key)?.price ?? null,
    changePct: byKey.get(key)?.changePct ?? null,
  }));
  const enabled = [...byKey.values()]
    .filter((ticker) => !requiredKeys.has(ticker.key))
    .map((ticker) => ({ ...ticker, price: ticker.price ?? null, changePct: ticker.changePct ?? null }));
  return [...required, ...enabled];
}

function Ticker({ items }) {
  const row = [...items, ...items];
  return (
    <div className="slz-market-ticker overflow-hidden border-y border-slate-200 bg-white/60 py-2" data-testid="landing-market-ticker">
      <div className="slz-marquee slz-mono text-sm">
        {row.map((ticker, idx) => {
          const up = ticker.changePct !== null && ticker.changePct >= 0;
          const hasChange = ticker.changePct !== null;
          return (
            <span key={`${ticker.key}-${idx}`} className="flex items-center gap-2 text-slate-700" data-testid="landing-market-ticker-item" data-ticker-key={ticker.key} aria-hidden={idx >= items.length ? "true" : undefined}>
              <b className="font-semibold">{ticker.label}</b>
              <span>{ticker.price === null ? "—" : ticker.price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <em className={`not-italic font-semibold ${hasChange ? (up ? "text-emerald-600" : "text-rose-600") : "text-slate-400"}`}>
                {hasChange ? `${up ? "▲" : "▼"} ${up ? "+" : ""}${ticker.changePct.toFixed(2)}%` : "—"}
              </em>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Hero({ snap, walkthroughEnabled, pricingVisible, copy }) {
  // Keep the floating mockup shadow visible while preventing horizontal overflow.
  return (
    <section className="relative overflow-x-clip overflow-y-visible pt-28 pb-20 md:pt-36 md:pb-24">
      <div className="slz-aurora" />
      <div className="absolute inset-0 slz-grid-dots opacity-60" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-5 lg:grid-cols-[1.05fr_1fr]">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
          <span className="slz-chip mb-4" style={{ background: "rgba(16,185,129,0.12)", color: "#047857" }}>
            <span className="slz-live-dot" /> {copy.hero_eyebrow}
          </span>
          <h1 className="slz-section-heading slz-section-heading-left text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            {copy.hero_title}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
            {copy.hero_description}
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link to="/login" className="slz-btn-primary inline-flex items-center gap-2 rounded-full px-6 py-3 text-base font-semibold transition">
              {copy.hero_start} <ArrowRight className="h-5 w-5" />
            </Link>
            {walkthroughEnabled && (
              <Link to="/sitewalkthrough" className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-6 py-3 text-base font-semibold text-emerald-800 transition hover:border-emerald-400 hover:bg-emerald-50">
                {copy.hero_demo} <ArrowRight className="h-5 w-5" />
              </Link>
            )}
            {pricingVisible && (
              <a href="#pricing" className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-800 transition hover:border-emerald-400">
                {copy.hero_compare}
              </a>
            )}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-500">
            <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-emerald-600" /> {copy.hero_no_broker}</span>
          </div>
        </motion.div>

        <div className="slz-scene relative">
          <div className="slz-orbit slz-orbit-one" aria-hidden="true" />
          <div className="slz-orbit slz-orbit-two" aria-hidden="true" />
          <motion.div
            className="slz-tilt"
            animate={{ y: [0, -12, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          >
            <BrowserMock id="dashboard" snap={snap} title="Market Dashboard" chipIndex="SENSEX" />
          </motion.div>
          <motion.div
            className="slz-tilt-soft absolute -bottom-10 -left-6 w-60 md:w-72"
            animate={{ y: [0, 10, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
          >
            <BrowserMock id="oi" snap={snap} title="OI Change" showChip={false} />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

const FEATURE_CARDS = [
  { id: "option_chain", icon: Layers, title: "Full Option Chain", desc: "OI, OI change, volume and PCR for every strike — instantly readable." },
  { id: "strike_pressure", icon: Gauge, title: "Strike Pressure", desc: "Compare call- and put-side open-interest concentration by strike." },
  { id: "global_markets", icon: Activity, title: "Global Markets", desc: "Track global indices, currencies, commodities and ADRs alongside the Indian session." },
  { id: "straddle", icon: LineChart, title: "Straddle", desc: "Track the ATM straddle premium through the session and review its recent range." },
  { id: "market_events", icon: CalendarDays, title: "Market & Global Events", desc: "Keep key India-market dates and global catalysts in view alongside the trading session." },
  { id: "desk_ai", icon: Bot, title: "Desk AI", desc: "Desk AI brings Market Intel, Global Markets and Indian index movers together in one consolidated market briefing." },
];

function Features({ visibleCards, copy }) {
  return (
    <section id="features" className="relative mx-auto max-w-7xl px-5 pt-14 pb-8 sm:pt-16 sm:pb-10">
      <motion.div {...reveal} className="mx-auto max-w-2xl text-center">
        <h2 className="slz-section-heading text-3xl font-bold tracking-tight sm:text-4xl">{copy.features_title}</h2>
        <p className="mt-4 text-slate-600">{copy.features_description}</p>
      </motion.div>
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURE_CARDS.filter((feature) => visibleCards.includes(feature.id)).map((f, i) => (
          <motion.div key={f.id} {...reveal} transition={{ duration: 0.5, delay: i * 0.05 }}
            className="group rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:border-emerald-300 hover:shadow-xl hover:shadow-emerald-500/5">
            <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-50 to-indigo-50 text-emerald-600 ring-1 ring-emerald-100">
              <f.icon className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900">{copy[`card_${f.id}_title`] || f.title}</h3>
            <p className="mt-1.5 text-sm leading-6 text-slate-600">{copy[`card_${f.id}_description`] || f.desc}</p>
          </motion.div>
        ))}
      </div>
      <div
        className="mt-7 flex items-center justify-center gap-2 text-sm font-semibold text-slate-600"
        data-testid="mobile-tablet-compatibility"
      >
        <span className="inline-flex items-center gap-1.5 text-emerald-700" aria-hidden="true">
          <Smartphone className="h-4 w-4" />
          <Tablet className="h-4 w-4" />
        </span>
        <span>Mobile / Tablet compatible</span>
      </div>
    </section>
  );
}

// This public landing preview stays fictional and never receives member Positions data.
function PositionMeterPreview() {
  const metrics = [
    ["Premium captured", "₹5,813", "text-emerald-700"],
    ["Today's P&L", "₹8,790", "text-emerald-700"],
    ["Open P&L", "₹5,202", "text-emerald-700"],
    ["Premium left to decay", "₹16,922", "text-slate-800"],
    ["Net Delta · ₹ / 1%", "Unavailable", "text-amber-700"],
    ["Alerts to check", "7", "text-amber-700"],
  ];
  const reviewItems = [
    ["SENSEX 15TH OCT 71500 PE", "Expiry today + near strike", "Expiry is today and spot is 1.76% from the sold strike."],
    ["SENSEX 15TH OCT 71400 PE", "Data unavailable", "Stale or incomplete option quotes; risk cannot be checked reliably."],
    ["SENSEX 15TH OCT 74100 CE", "Data unavailable", "Stale or incomplete option quotes; risk cannot be checked reliably."],
  ];

  return (
    <div className="slz-position-meter" data-testid="position-meter-preview">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <div className="flex min-w-0 items-center gap-2 text-[10px] font-semibold text-slate-600">
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white" aria-hidden="true">
            <Activity className="h-3 w-3" />
          </span>
          <span>Positions</span><span className="text-slate-300">/</span><span className="truncate">PositionMeter</span>
        </div>
        <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[9px] font-semibold text-slate-700">My Positions</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-extrabold tracking-tight text-slate-900 sm:text-lg">PositionMeter</h3>
          <p className="mt-0.5 text-[9px] leading-4 text-slate-500">Seller view · sold options and bought hedges by expiry and strike</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[8px] font-bold text-amber-800">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Fictional sample
        </span>
      </div>

      <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[8px] leading-3 text-amber-950">
        Illustrative sample only · Live risk checks require current broker Positions and option quotes.
      </div>

      <div className="mt-1.5 grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-6">
        {metrics.map(([label, value, tone]) => (
      <div key={label} className="min-w-0 rounded-md border border-slate-200 bg-white px-1.5 py-1.5">
            <div className="truncate text-[8px] font-medium text-slate-500">{label}</div>
        <div className={`mt-0.5 truncate text-[10px] font-extrabold ${tone}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="mt-1.5 rounded-md border border-slate-200 bg-white p-2">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div>
        <div className="text-[9px] font-bold text-slate-800">Daily loss &amp; margin guard</div>
        <div className="text-[7px] text-slate-500">Booked P&amp;L after charges · not open MTM</div>
          </div>
      <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[7px] font-bold text-emerald-800">No threshold reached</span>
        </div>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
          <div>
        <div className="text-[7px] text-slate-500">Booked today</div>
        <div className="text-[9px] font-bold text-slate-800">+0.08% of wallet</div>
        <div className="mt-0.5 h-1 rounded-full bg-slate-100"><div className="h-1 w-[34%] rounded-full bg-emerald-500" /></div>
        <div className="mt-0.5 text-[7px] text-slate-500">Caution −3% · stop adds −5% · defend −8%</div>
          </div>
          <div>
        <div className="text-[7px] text-slate-500">Broker available margin</div>
        <div className="text-[9px] font-bold text-slate-800">₹39,577 · 1.08% of wallet</div>
        <div className="mt-0.5 text-[7px] leading-3 text-slate-500">Low-margin stop is available below 0.5% of wallet.</div>
          </div>
        </div>
      </div>

      <div className="mt-1.5 rounded-md border border-slate-200 bg-white p-2">
        <div className="flex items-center justify-between gap-2">
          <div>
        <div className="text-[9px] font-bold text-slate-800">Check now</div>
        <p className="text-[7px] leading-3 text-slate-500">Sample sold legs that need a closer look.</p>
          </div>
      <span className="text-[7px] font-bold text-sky-700">Show full book</span>
        </div>
        <div className="mt-1 grid gap-1 sm:grid-cols-3">
          {reviewItems.map(([symbol, status, detail], index) => (
        <article key={symbol} className={`min-w-0 rounded border p-1.5 ${index === 0 ? "border-amber-300 bg-amber-50/70" : "border-slate-200 bg-slate-50"}`}>
          <div className="flex items-start justify-between gap-1">
            <h4 className="min-w-0 text-[7px] font-bold leading-3 text-slate-800">{symbol}</h4>
            <span className={`shrink-0 rounded px-1 py-0.5 text-[7px] font-bold ${index === 0 ? "bg-amber-100 text-amber-900" : "bg-slate-200 text-slate-700"}`}>{status}</span>
              </div>
          <p className="mt-0.5 text-[7px] leading-3 text-slate-600">{detail}</p>
        </article>
      ))}
        </div>
        <p className="mt-1 text-[7px] text-slate-500">Same-strike bought quantity is a comparison only, not proof of a hedge.</p>
      </div>
    </div>
  );
}

function ProductDemo({ snap, copy }) {
  return (
    <section id="product" className="relative overflow-hidden bg-slate-50 pt-8 pb-14 sm:pt-10 sm:pb-16">
      <div className="mx-auto max-w-7xl px-5">
        <motion.div {...reveal} className="mx-auto max-w-2xl text-center">
          <span className="slz-chip mb-3" style={{ background: "rgba(79,70,229,0.1)", color: "#4338ca" }}>{copy.product_eyebrow}</span>
          <h2 className="slz-section-heading text-3xl font-bold tracking-tight sm:text-4xl">{copy.product_title}</h2>
          <p className="mt-4 text-slate-600">{copy.product_description}</p>
        </motion.div>
        <MotionFilm copy={copy} />
        <motion.div {...reveal} className="mt-8">
          <ShotTour snap={snap} />
        </motion.div>
      </div>
    </section>
  );
}

function ProShowcase({ snap, copy }) {
  const previewTile = (id) => (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-3 text-slate-700 shadow-xl">
      <ProductScreen id={id} snap={snap} />
    </div>
  );
  return (
    <section id="pro" className="relative overflow-hidden bg-slate-900 py-20 text-white">
      <div className="pointer-events-none absolute inset-0 opacity-40" style={{ background: "radial-gradient(60rem 30rem at 70% -10%, rgba(79,70,229,0.35), transparent), radial-gradient(50rem 30rem at 10% 110%, rgba(16,185,129,0.3), transparent)" }} />
      <div className="relative mx-auto max-w-7xl px-5">
        <motion.div {...reveal} className="mx-auto max-w-2xl text-center">
          <span className="slz-chip mb-3" style={{ background: "rgba(129,140,248,0.18)", color: "#c7d2fe" }}>{copy.pro_eyebrow}</span>
          <h2 className="slz-section-heading slz-section-heading-dark text-3xl font-bold tracking-tight sm:text-4xl">{copy.pro_title}</h2>
          <p className="mt-4 text-slate-300">{copy.pro_description}</p>
        </motion.div>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          <motion.div {...reveal}>
            <div className="mb-3">
              <div className="text-sm font-semibold text-indigo-200">{copy.pro_oi_label}</div>
              <p className="mt-0.5 text-xs text-slate-400">{copy.pro_oi_description}</p>
            </div>
            <AnalyzeShowcasePreview />
            <div className="mt-4 mb-3 text-sm font-semibold text-emerald-200">{copy.pro_market_intel_label}</div>
            <div className="mt-3" data-testid="pro-market-intel-tile">{previewTile("market-intel")}</div>
          </motion.div>
          <div className="grid content-start gap-4">
            <motion.div {...reveal}>
              <div className="mb-3 text-sm font-semibold text-emerald-200">{copy.pro_journal_label}</div>
              <div data-testid="pro-journal-tile">{previewTile("journal")}</div>
            </motion.div>
            <motion.div {...reveal} transition={{ duration: 0.6, delay: 0.08 }}>
              <div className="mb-3 text-sm font-semibold text-emerald-200">{copy.pro_positions_label}</div>
              <div data-testid="pro-position-meter-tile"><PositionMeterPreview /></div>
            </motion.div>
          </div>
        </div>

        <motion.div {...reveal} className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: PlugZap, t: "Connect broker", d: "Your broker account powers your private book" },
            { icon: LineChart, t: "Position P&L", d: "Review per-leg performance in your workspace" },
            { icon: Gauge, t: "Neutral risk view", d: "See the factors behind your exposure summary" },
            { icon: Bot, t: "Desk AI", d: "One briefing across Market Intel, Global Markets and Indian movers" },
          ].map((c) => (
            <div key={c.t} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <c.icon className="h-5 w-5 text-emerald-400" />
              <div className="mt-3 font-semibold">{c.t}</div>
              <div className="text-sm text-slate-400">{c.d}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function Brokers({ brokers, visibleBrokerIds, copy }) {
  const list = (brokers || []).filter((broker) => visibleBrokerIds.includes(broker.id));
  return (
    <section id="brokers" className="mx-auto max-w-7xl px-5 py-20">
      <motion.div {...reveal} className="mx-auto max-w-2xl text-center">
        <span className="slz-chip mb-3" style={{ background: "rgba(16,185,129,0.12)", color: "#047857" }}>{copy.broker_eyebrow}</span>
        <h2 className="slz-section-heading text-3xl font-bold tracking-tight sm:text-4xl">{copy.broker_title}</h2>
        <p className="mt-4 text-slate-600">{copy.broker_description}</p>
      </motion.div>
      <motion.div {...reveal} className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {list.map((b) => (
          <div key={b.id} className={`flex items-center justify-between rounded-2xl border p-4 ${b.enabled ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-white"}`}>
            <span className="font-semibold text-slate-800">{brokerSafeText(b.name)}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${b.enabled ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"}`}>{b.enabled ? "Live" : "Soon"}</span>
          </div>
        ))}
      </motion.div>
    </section>
  );
}

const MEMBER_FEATURE_LABELS = {
  oi_change: "OI Change dashboard",
  open_interest: "Open Interest",
  strike_table: "Strike Table",
  buildup: "Build-up",
  straddle: "Straddle",
  index_risk: "Index Risk",
  events: "Events calendar",
  activity: "Activity feed",
  alerts: "Personal in-app alerts",
  alert_sounds: "Alert sound preferences",
  market_intel: "Market Intel",
  global_markets: "Global Markets",
  overnight_position_risk: "Overnight risk-factor summary",
  oi_shift_alerts: "OI Shift alerts",
  oi_change_alerts: "OI Change alerts",
  event_alerts: "Event alerts",
  positions: "Your open positions",
  trade_journal: "Personal Trade Journal",
  desk_ai: "Desk AI",
};

const DEFAULT_PLAN_FEATURES = {
  normal: ["oi_change", "open_interest", "strike_table", "buildup", "straddle", "index_risk", "events", "activity"],
  premium: ["oi_change", "open_interest", "strike_table", "buildup", "straddle", "index_risk", "events", "activity", "alerts", "market_intel", "global_markets", "oi_shift_alerts", "oi_change_alerts", "event_alerts"],
  pro: ["oi_change", "open_interest", "strike_table", "buildup", "straddle", "index_risk", "events", "activity", "alerts", "market_intel", "global_markets", "oi_shift_alerts", "oi_change_alerts", "event_alerts", "overnight_position_risk", "positions", "trade_journal", "desk_ai"],
};

function Pricing({ pricing, membership, googleLoginEnabled, moreInfoEnabled, copy }) {
  const [cycle, setCycle] = useState("monthly");
  const [detailPlanId, setDetailPlanId] = useState(null);
  const [planScreenshots, setPlanScreenshots] = useState([]);
  const [screenshotsLoading, setScreenshotsLoading] = useState(false);
  const [screenshotsError, setScreenshotsError] = useState("");
  const p = pricing || PRICING_FALLBACK;
  const planConfig = membership?.plans || {};
  const cur = p.currency || "INR";
  const per = cycle === "monthly" ? "/mo" : cycle === "quarterly" ? "/qtr" : "/yr";
  const googleReady = googleLoginEnabled === true;
  const signupReady = membership?.experience_enabled === true && membership?.signup_enabled === true && googleReady;
  const paidReady = signupReady && membership?.paid_subscriptions_enabled === true;
  const cadence = cycle;
  const normalFeatureKeys = planConfig.normal?.features || DEFAULT_PLAN_FEATURES.normal;
  const proHighlightKeys = ["positions", "trade_journal", "desk_ai", "overnight_position_risk"];
  const plans = [
    { id: "normal", label: copy.plan_normal_title, priceKey: "free", description: copy.plan_normal_description },
    { id: "premium", label: copy.plan_premium_title, priceKey: "premium", description: copy.plan_premium_description },
    { id: "pro", label: copy.plan_pro_title, priceKey: "pro", description: copy.plan_pro_description },
  ];

  useEffect(() => {
    if (!detailPlanId || !moreInfoEnabled) return undefined;
    let active = true;
    setPlanScreenshots([]);
    setScreenshotsError("");
    setScreenshotsLoading(true);
    api.get(`/public/landing-plan-screenshots/${detailPlanId}`)
      .then(({ data }) => {
        if (active) setPlanScreenshots(Array.isArray(data?.screenshots) ? data.screenshots : []);
      })
      .catch(() => {
        if (active) setScreenshotsError("Plan screenshots are temporarily unavailable.");
      })
      .finally(() => {
        if (active) setScreenshotsLoading(false);
      });
    return () => { active = false; };
  }, [detailPlanId, moreInfoEnabled]);

  const selectedPlan = plans.find((plan) => plan.id === detailPlanId);
  const selectedConfiguredFeatures = selectedPlan
    ? (Array.isArray(planConfig[selectedPlan.id]?.features)
      ? planConfig[selectedPlan.id].features
      : DEFAULT_PLAN_FEATURES[selectedPlan.id])
      .map((feature) => ({ id: feature, label: MEMBER_FEATURE_LABELS[feature] }))
      .filter((feature) => feature.label)
    : [];

  useEffect(() => {
    if (!moreInfoEnabled) setDetailPlanId(null);
  }, [moreInfoEnabled]);

  return (
    <section id="pricing" className="relative overflow-hidden bg-slate-50 py-20">
      <div className="mx-auto max-w-7xl px-5">
        <motion.div {...reveal} className="mx-auto max-w-2xl text-center">
          <h2 className="slz-section-heading text-3xl font-bold tracking-tight sm:text-4xl">
            {copy.pricing_title.split(/(StrikLenz)/g).map((part, index) => part === "StrikLenz"
              ? <span key={index}><span className="slz-brand-strik">Strik</span><span className="slz-brand-lenz">Lenz</span></span>
              : part)}
          </h2>
          <p className="mt-4 text-slate-600">{copy.pricing_description}</p>
          <p className="mt-2 text-sm font-semibold text-emerald-800" data-testid="pricing-indicative-price-feature">
            {copy.pricing_indicative}
          </p>
          <div className="mt-6 inline-flex rounded-full border border-slate-200 bg-white p-1" role="group" aria-label="Billing interval">
            {["monthly", "quarterly", "yearly"].map((c) => (
              <button key={c} type="button" aria-pressed={cycle === c} onClick={() => setCycle(c)} className={`rounded-full px-4 py-1.5 text-sm font-semibold capitalize transition ${cycle === c ? "slz-btn-primary" : "text-slate-600"}`}>{c}</button>
            ))}
          </div>
        </motion.div>
        <div className="mx-auto mt-12 grid max-w-7xl gap-6 lg:grid-cols-3">
          {plans.map(({ id, label, priceKey, description }, index) => {
            const configuredPlan = planConfig[id];
            const enabled = configuredPlan?.enabled !== false;
            const configuredFeatures = Array.isArray(configuredPlan?.features)
              ? configuredPlan.features
              : DEFAULT_PLAN_FEATURES[id];
            const features = configuredFeatures.map((feature) => MEMBER_FEATURE_LABELS[feature]).filter(Boolean);
            const visibleCardFeatures = id === "pro"
              ? proHighlightKeys
                .map((key) => MEMBER_FEATURE_LABELS[key])
                .filter((feature) => feature && features.includes(feature))
              : features;
            const blurredCardFeatures = id === "pro"
              ? features.filter((feature) => !visibleCardFeatures.includes(feature))
              : [];
            const price = id === "normal" ? 0 : Number(p[priceKey]?.[cadence] ?? 0);
            const configuredOfferPrice = Number(p[priceKey]?.offer_prices?.[cadence]);
            const hasOfferPrice = id !== "normal"
              && Number.isFinite(configuredOfferPrice)
              && configuredOfferPrice > 0
              && configuredOfferPrice < price;
            const canStart = enabled && (id === "normal" ? signupReady : paidReady);
            return (
              <motion.div
                key={id}
                {...reveal}
                transition={{ duration: 0.6, delay: index * 0.06 }}
                className={`relative flex flex-col rounded-3xl border bg-white p-8 transition duration-300 hover:-translate-y-1 hover:shadow-xl ${id === "pro" ? "border-2 border-emerald-300 shadow-xl shadow-emerald-500/10" : "border-slate-200 hover:border-emerald-200"} ${!enabled ? "opacity-70" : ""}`}
              >
                {id === "pro" && <div className="absolute -top-3 left-8 rounded-full bg-emerald-700 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">Full access</div>}
                <h3 className="text-lg font-bold text-slate-900">{label}</h3>
                <div className="mt-3 flex min-h-12 items-baseline gap-3">
                  {hasOfferPrice && (
                    <del
                      className="relative inline-block shrink-0 text-lg font-semibold text-slate-400 no-underline"
                      data-testid={`pricing-original-price-${id}`}
                      aria-label={`Regular price ${money(price, cur)}`}
                    >
                      {money(price, cur)}
                      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
                        <line x1="2" y1="21" x2="98" y2="3" stroke="currentColor" strokeWidth="2" />
                      </svg>
                    </del>
                  )}
                  <div className="text-4xl font-black text-slate-900" data-testid={hasOfferPrice ? `pricing-offer-price-${id}` : undefined}>
                    {id === "normal" ? money(0, cur) : price > 0 ? money(hasOfferPrice ? configuredOfferPrice : price, cur) : "Coming soon"}
                    <span className="text-base font-medium text-slate-500">{id === "normal" ? "/forever" : price > 0 ? per : ""}</span>
                  </div>
                </div>
                {hasOfferPrice && <p className="mt-1 text-xs font-medium text-emerald-700">First billing period only</p>}
                <p className="mt-2 min-h-12 text-sm text-slate-500">{description}</p>
                <ul className="mt-5 flex-1 space-y-2.5" data-testid={`pricing-features-${id}`}>
                  {visibleCardFeatures.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm text-slate-700"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> {feature}</li>
                  ))}
                  {blurredCardFeatures.length > 0 && (
                    <li className="relative pt-1">
                      <span aria-hidden="true" className="block select-none space-y-2.5 blur-[3px] opacity-70">
                        {blurredCardFeatures.slice(0, 3).map((feature) => (
                          <span key={feature} className="flex items-start gap-2.5 text-sm text-slate-700">
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> {feature}
                          </span>
                        ))}
                      </span>
                      <span className="sr-only">Additional advanced Pro features are included.</span>
                    </li>
                  )}
                </ul>
                <Link
                  to={canStart ? (id === "normal" ? "/login" : `/login?plan=${id}&cadence=${cadence}`) : "#pricing"}
                  aria-disabled={!canStart}
                  onClick={(event) => { if (!canStart) event.preventDefault(); }}
                  className={`mt-6 block rounded-full px-5 py-3 text-center text-sm font-semibold ${canStart ? "slz-btn-primary" : "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"}`}
                >
                  {!enabled ? "Unavailable" : canStart ? (id === "normal" ? "Start free" : `Choose ${id === "premium" ? "Premium" : "Pro"}`) : "Coming soon"}
                </Link>
                {moreInfoEnabled && (
                  <button
                    type="button"
                    onClick={() => setDetailPlanId(id)}
                    data-testid={`pricing-more-info-${id}`}
                    className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-700 transition hover:border-emerald-500 hover:text-emerald-700"
                  >
                    More info <ArrowRight className="h-4 w-4" />
                  </button>
                )}
              </motion.div>
            );
          })}
        </div>
        <p className="mx-auto mt-6 max-w-4xl text-center text-xs leading-relaxed text-slate-500">
          {copy.pricing_footer}
        </p>
        {membership?.early_access?.enabled
          && membership.early_access.discount_percent > 0
          && !plans.some(({ id, priceKey }) => id !== "normal" && Number(p[priceKey]?.offer_prices?.[cadence]) > 0) && (
          <p className="mt-3 text-center text-sm font-semibold text-emerald-700">
            Early access: {membership.early_access.discount_percent}% off the first billing period.
          </p>
        )}
      </div>
      <Dialog open={moreInfoEnabled && !!detailPlanId} onOpenChange={(open) => { if (!open) setDetailPlanId(null); }}>
        <DialogContent className="max-h-[88vh] max-w-6xl overflow-y-auto bg-white text-slate-900">
          {selectedPlan && (
            <>
              <DialogTitle className="pr-8 text-2xl font-bold">{selectedPlan.label}</DialogTitle>
              <DialogDescription>{selectedPlan.description}</DialogDescription>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-sm font-semibold text-slate-800">
                  {copy[`plan_${selectedPlan.id}_intro`]}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  {copy[`plan_${selectedPlan.id}_note`]}
                </p>
              </div>
              {selectedPlan.id === "premium" && (
                <p className="text-xs font-semibold text-emerald-800">
                  Includes the currently configured Basic features: {selectedConfiguredFeatures.filter((feature) => normalFeatureKeys.includes(feature.id)).map((feature) => feature.label).join(", ") || "no inherited features are currently configured"}.
                </p>
              )}
              {selectedPlan.id === "pro" && (
                <p className="text-xs font-semibold text-indigo-800">
                  Pro includes the currently configured Premium features plus your private Pro tools; use the feature explorer to inspect each enabled module.
                </p>
              )}
              <PlanWalkthrough planId={selectedPlan.id} features={selectedConfiguredFeatures} />
              <section>
                <details className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <summary className="cursor-pointer text-sm font-bold text-slate-800">Additional screenshots (optional)</summary>
                  <p className="mb-3 mt-2 text-xs text-slate-500">The interactive previews above show how enabled features work. These administrator-added images are supporting illustrations only.</p>
                {screenshotsLoading ? (
                  <p className="text-sm text-slate-500">Loading screenshots…</p>
                ) : screenshotsError ? (
                  <p role="status" className="text-sm text-rose-700">{screenshotsError}</p>
                ) : planScreenshots.length ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {planScreenshots.map((shot) => (
                      <figure key={shot.id} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                        <img src={shot.data_url} alt={shot.title} loading="lazy" className="max-h-[28rem] w-full object-contain" />
                        <figcaption className="px-3 py-2 text-xs font-medium text-slate-600">{shot.title}</figcaption>
                      </figure>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-500">Plan screenshots will appear here when added by the administrator.</p>
                )}
                </details>
              </section>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function FAQ({ copy }) {
  const [open, setOpen] = useState(0);
  const entries = FAQS.map((item, index) => ({
    q: copy[`${item.key || `faq_${index}`}_question`] || item.q,
    a: copy[`${item.key || `faq_${index}`}_answer`] || item.a,
  }));
  return (
    <section id="faq" className="mx-auto max-w-3xl px-5 py-20">
      <motion.h2 {...reveal} className="slz-section-heading text-center text-3xl font-bold tracking-tight sm:text-4xl">{copy.faq_title}</motion.h2>
      <div className="mt-10 space-y-3">
        {entries.map((f, i) => (
          <motion.div key={f.q} {...reveal} transition={{ duration: 0.4, delay: i * 0.03 }} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <button onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i} aria-controls={`landing-faq-answer-${i}`} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left">
              <span className="font-semibold text-slate-900">{f.q}</span>
              <span className={`text-2xl leading-none text-emerald-600 transition ${open === i ? "rotate-45" : ""}`}>+</span>
            </button>
            <div id={`landing-faq-answer-${i}`} hidden={open !== i} className="px-5 pb-5 text-sm leading-7 text-slate-600">{f.a}</div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function CTA({ copy }) {
  return (
    <section className="mx-auto max-w-7xl px-5 pb-20">
      <motion.div {...reveal} className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 to-indigo-700 px-8 py-14 text-center text-white">
        <div className="pointer-events-none absolute inset-0 slz-grid-dots opacity-20" />
        <h2 className="relative mx-auto w-fit max-w-full pb-2 text-3xl font-black tracking-tight after:absolute after:bottom-0 after:left-1/2 after:h-[3px] after:w-12 after:-translate-x-1/2 after:rounded-full after:bg-emerald-200 sm:text-4xl">{copy.cta_title}</h2>
        <p className="relative mx-auto mt-3 max-w-xl text-emerald-50">{copy.cta_description}</p>
        <Link to="/login" className="relative mt-7 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-base font-bold text-slate-900 transition hover:-translate-y-0.5">
          {copy.cta_button} <ArrowRight className="h-5 w-5" />
        </Link>
      </motion.div>
    </section>
  );
}

function Footer({ showFaqLink, copy }) {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row">
        <Logo />
        <p className="text-sm text-slate-500">© {new Date().getFullYear()} {BRAND.name}. {copy.footer_disclaimer}</p>
        <div className="flex items-center gap-4 text-sm text-slate-500">
          {showFaqLink && <a href="#faq" className="hover:text-slate-800">FAQ</a>}
          <Link to="/login" className="hover:text-slate-800">Login</Link>
        </div>
      </div>
    </footer>
  );
}

const DEFAULT_LANDING_PAGE = {
  sections: {
    navigation: true,
    hero: true,
    ticker: true,
    features: true,
    product_demo: true,
    pro_showcase: true,
    broker_connect: false,
    pricing: true,
    faq: true,
    bottom_cta: true,
    footer: true,
  },
  feature_cards: FEATURE_CARDS.map((feature) => feature.id),
  broker_ids: [],
};

export default function Landing({ walkthroughEnabled = true }) {
  const snap = useLiveDemo(1500);
  const [cfg, setCfg] = useState(null);
  const [marketData, setMarketData] = useState({ tickers: [], extras: null });

  useEffect(() => {
    let alive = true;
    api.get("/public/site-config").then((r) => { if (alive) setCfg(r.data); }).catch(() => {});
    document.title = "Striklenz — NIFTY, BANK NIFTY & SENSEX Options Intelligence";
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    const loadMarketData = async () => {
      const [tickerResult, extrasResult] = await Promise.allSettled([fetchTickers(), fetchExtras()]);
      if (!alive) return;
      setMarketData((previous) => ({
        tickers: tickerResult.status === "fulfilled" && Array.isArray(tickerResult.value?.tickers)
          ? tickerResult.value.tickers
          : previous.tickers,
        extras: extrasResult.status === "fulfilled" ? extrasResult.value : previous.extras,
      }));
    };
    loadMarketData();
    const timer = window.setInterval(loadMarketData, 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const tickerItems = useMemo(
    () => buildTickerItems(marketData.tickers, marketData.extras),
    [marketData.tickers, marketData.extras],
  );
  const pricing = useMemo(() => cfg?.pricing || PRICING_FALLBACK, [cfg]);
  const brokers = cfg?.brokers;
  const landingPage = cfg?.landing_page || DEFAULT_LANDING_PAGE;
  const sections = landingPage.sections || DEFAULT_LANDING_PAGE.sections;
  const copy = normalizeLandingCopy(landingPage.copy);

  return (
    <div className="slz slz-light min-h-screen">
      {sections.navigation && <Nav walkthroughEnabled={walkthroughEnabled} sectionVisibility={sections} copy={copy} />}
      <main>
        {sections.hero && <Hero snap={snap} walkthroughEnabled={walkthroughEnabled} pricingVisible={sections.pricing} copy={copy} />}
        {sections.ticker && <Ticker items={tickerItems} />}
        {sections.features && <Features visibleCards={landingPage.feature_cards || DEFAULT_LANDING_PAGE.feature_cards} copy={copy} />}
        {sections.product_demo && <ProductDemo snap={snap} copy={copy} />}
        {sections.pro_showcase && <ProShowcase snap={snap} copy={copy} />}
        {sections.broker_connect && (landingPage.broker_ids || []).length > 0 && (
          <Brokers brokers={brokers} visibleBrokerIds={landingPage.broker_ids} copy={copy} />
        )}
        {sections.pricing && <Pricing pricing={pricing} membership={cfg?.membership} googleLoginEnabled={cfg?.features?.google_login_enabled} moreInfoEnabled={landingPage.plan_more_info_enabled !== false} copy={copy} />}
        {sections.faq && <FAQ copy={copy} />}
        {sections.bottom_cta && <CTA copy={copy} />}
      </main>
      {sections.footer && <Footer showFaqLink={sections.faq} copy={copy} />}
    </div>
  );
}
