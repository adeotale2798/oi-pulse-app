// Single source of truth for Striklenz public/marketing config.
// Pricing + feature flags are also served by GET /api/public/site-config so an
// admin can override them without a redeploy. This module holds brand copy,
// navigation, FAQ and sensible pricing fallbacks.

export const BRAND = {
  name: "Striklenz",
  tagline: "Read the options market like a pro.",
  domain: "striklenz.com",
};

export const NAV_LINKS = [
  { id: "product", label: "Product", href: "#product" },
  { id: "features", label: "Features", href: "#features" },
  { id: "premium", label: "Pro tools", href: "#pro" },
  { id: "pricing", label: "Pricing", href: "#pricing" },
  { id: "faq", label: "FAQ", href: "#faq" },
];

export const FAQS = [
  {
    key: "faq_0",
    q: "Do I need to connect my broker to use Striklenz?",
    a: "No. Core market intelligence — option chain, OI, OI Change, PCR and Strike Pressure for NIFTY, BANK NIFTY and SENSEX — is available without a broker connection.",
  },
  {
    key: "faq_1",
    q: "What does Premium add?",
    a: "Premium adds personal in-app OI change and OI shift alerts, alert preferences, Market Intel, and Global Markets.",
  },
  {
    key: "faq_2",
    q: "What does Pro add?",
    a: "Pro includes Premium plus your own broker-connected Positions workspace, a private trade journal, an overnight risk-factor summary, and Desk AI, which brings Market Intel, Global Markets and Indian index movers together in one consolidated market briefing.",
  },
  {
    key: "faq_data",
    q: "Is the data on this page live?",
    a: "The product demos on this page use an interactive simulated feed so you can explore the experience instantly. Inside StrikLenz you get real market data.",
  },
  {
    key: "faq_signin",
    q: "How do I sign in?",
    a: "Tap Get Started and continue with Google. It takes seconds.",
  },
];

// Pricing fallback (used until /api/public/site-config responds).
export const PRICING_FALLBACK = {
  currency: "INR",
  free: { price: 0, label: "Free" },
  premium: { monthly: 999, quarterly: 2499, yearly: 7999, label: "Premium", billing_default: "monthly" },
  pro: { monthly: 0, quarterly: 0, yearly: 0, label: "Pro", billing_default: "monthly" },
};

export const money = (n, currency = "INR") => {
  const num = Number(n) || 0;
  if (currency === "INR") return "\u20b9" + num.toLocaleString("en-IN");
  return num.toLocaleString();
};
