export const SAMPLE_PREVIEW_LABEL = "Illustrative sample · not live";

const INDEX_SAMPLE = {
  NIFTY: { price: 25_850, step: 50 },
  SENSEX: { price: 84_900, step: 100 },
  BANKNIFTY: { price: 56_400, step: 100 },
};

const SAMPLE_CE_OI_LAKHS = [
  0.8, 1.1, 0.7, 2.4, 0.9, 1.5, 0.8, 3.2, 6.4, 11.8,
  7.2, 18.6, 36.8, 28.4, 14.2, 22.6, 5.3, 12.7, 19.3, 8.4,
  16.1, 25.2, 6.1, 13.8, 9.2,
];
const SAMPLE_PE_OI_LAKHS = [
  4.2, 10.4, 1.3, 24.8, 1.6, 1.1, 13.8, 1.2, 16.4, 0.9,
  21.2, 18.9, 12.1, 7.4, 4.3, 10.8, 2.5, 3.2, 1.8, 1.3,
  2.6, 1.2, 2.9, 1.5, 1.0,
];

export function makeSampleOi(index) {
  const { price, step } = INDEX_SAMPLE[index] || INDEX_SAMPLE.NIFTY;
  const atm = Math.round(price / step) * step;
  const scale = index === "SENSEX" ? 0.82 : index === "BANKNIFTY" ? 0.92 : 1;
  const strikes = Array.from({ length: 25 }, (_, position) => {
    const offset = position - 12;
    const strike = atm + offset * step;
    const distance = Math.abs(offset);
    const ceOi = Math.round(SAMPLE_CE_OI_LAKHS[position] * scale * 100_000);
    const peOi = Math.round(SAMPLE_PE_OI_LAKHS[position] * scale * 100_000);
    return {
      strike,
      ce_oi: ceOi,
      pe_oi: peOi,
      ce_ltp: Math.max(18, 165 - distance * 9 + (position % 4) * 3),
      pe_ltp: Math.max(18, 158 - distance * 8 + (position % 5) * 2),
      ce_volume: 24_000 + distance * 4_000 + (position % 3) * 7_500,
      pe_volume: 27_000 + distance * 3_500 + (position % 4) * 6_000,
    };
  });
  const previousStrikes = strikes.map((row, position) => {
    const ceChangePct = ((position * 7) % 15) - 7;
    const peChangePct = ((position * 11 + 3) % 17) - 8;
    return {
      ...row,
      ce_oi: Math.round(row.ce_oi / (1 + ceChangePct / 100)),
      pe_oi: Math.round(row.pe_oi / (1 + peChangePct / 100)),
      ce_ltp: Math.round(row.ce_ltp / (1 + (((position * 5) % 13) - 6) / 100)),
      pe_ltp: Math.round(row.pe_ltp / (1 + (((position * 9 + 1) % 15) - 7) / 100)),
    };
  });
  return {
    current: {
      index,
      timestamp: null,
      price,
      atm,
      expiry: "28 Sep",
      expiry_type: "Monthly",
      strikes,
    },
    previous: { strikes: previousStrikes },
    data_status: { label: "SAMPLE", window_minutes: 15 },
  };
}

export const SAMPLE_STRADDLE = {
  trade_date: "Illustrative session",
  history: [
    { ts: "2026-10-14T09:20:00+05:30", premium: 412 },
    { ts: "2026-10-14T10:00:00+05:30", premium: 398 },
    { ts: "2026-10-14T10:40:00+05:30", premium: 376 },
    { ts: "2026-10-14T11:20:00+05:30", premium: 389 },
    { ts: "2026-10-14T12:00:00+05:30", premium: 361 },
    { ts: "2026-10-14T12:40:00+05:30", premium: 348 },
    { ts: "2026-10-14T13:20:00+05:30", premium: 355 },
    { ts: "2026-10-14T14:00:00+05:30", premium: 329 },
    { ts: "2026-10-14T14:40:00+05:30", premium: 337 },
    { ts: "2026-10-14T15:20:00+05:30", premium: 318 },
  ],
};

export const SAMPLE_EVENTS = [
  { event_date: "2026-10-16", event_type: "Earnings watch", symbol: "SAMPLECO", company_name: "Sample constituent", index: "NIFTY", days_remaining: 2, weightage: 4.2 },
  { event_date: "2026-10-19", event_type: "Quarterly results", symbol: "DEMOIT", company_name: "Illustrative constituent", index: "NIFTY", days_remaining: 5, weightage: 2.8 },
  { event_date: "2026-10-21", event_type: "Policy announcement", symbol: "DEMO", company_name: "Illustrative calendar event", index: "NIFTY", days_remaining: 7, weightage: null },
  { event_date: "2026-10-16", event_type: "Banking results", symbol: "SAMPLEBANK", company_name: "Illustrative bank", index: "BANKNIFTY", days_remaining: 2, weightage: 6.1 },
  { event_date: "2026-10-22", event_type: "Policy announcement", symbol: "DEMO", company_name: "Illustrative calendar event", index: "BANKNIFTY", days_remaining: 8, weightage: null },
  { event_date: "2026-10-19", event_type: "Quarterly results", symbol: "SAMPLEFIN", company_name: "Illustrative constituent", index: "SENSEX", days_remaining: 5, weightage: 3.6 },
  { event_date: "2026-10-27", event_type: "Global macro release", symbol: "SAMPLE", company_name: "Illustrative macro event", index: "SENSEX", days_remaining: 13, weightage: null },
];

export const SAMPLE_PERSONAL_ALERTS = [
  { id: "sample-personal-oi", index: "NIFTY", category: "OI Change", at: "09:42 IST", title: "Sample OI change · 25,900 CE", detail: "15-minute sample window · +18% open-interest change" },
  { id: "sample-personal-global", index: "NIFTY", category: "Global Markets", at: "09:28 IST", title: "Global market shift", detail: "GIFT NIFTY reference · +0.42% illustrative move" },
  { id: "sample-personal-move", index: "BANKNIFTY", category: "Major move", at: "09:16 IST", title: "Major constituent move", detail: "SAMPLE BANK · +1.2% illustrative move · 7.4% sample index weight" },
  { id: "sample-personal-intel", index: "SENSEX", category: "Market Intel", at: "08:55 IST", title: "Market Intel · policy context", detail: "Fictional summary · domestic policy headline added to the context feed" },
  { id: "sample-personal-shift", index: "BANKNIFTY", category: "OI Shift", at: "10:03 IST", title: "Sample strike OI shift", detail: "Illustrative 15-minute window · 125,000 contracts" },
  { id: "sample-personal-event", index: "SENSEX", category: "Event alert", at: "08:30 IST", title: "Calendar reminder", detail: "Illustrative scheduled event · 2 days ahead" },
];

export const SAMPLE_HOLIDAYS = [
  { date: "2026-10-20", name: "Illustrative exchange holiday", session: null },
  { date: "2026-11-08", name: "Illustrative special session", session: "Sample hours", open: "09:15", close: "15:30" },
];

export const SAMPLE_MARKET_INTEL = [
  {
    id: "sample-macro",
    title: "Global rate expectations: sample headline",
    summary: "Example only: a global rates move can influence currency and risk sentiment in Indian markets.",
    direction: "Mixed",
    volatility: "Watch",
    importance: "Example",
  },
  {
    id: "sample-energy",
    title: "Energy prices: sample India-context note",
    summary: "Example only: energy prices may matter through import costs and inflation expectations.",
    direction: "Unclear",
    volatility: "Context",
    importance: "Example",
  },
];

export const SAMPLE_GLOBAL_MARKETS = [
  { id: "sample-gift", symbol: "GIFT NIFTY", displayName: "Illustrative futures reference", category: "India reference", price: 25_910, change: 48, changePercent: 0.19, available: true, marketStatus: "Sample" },
  { id: "sample-nifty", symbol: "NIFTY 50", displayName: "Illustrative index reference", category: "India reference", price: 25_862, change: 62, changePercent: 0.24, available: true, marketStatus: "Sample" },
  { id: "sample-spx", symbol: "S&P 500", displayName: "Illustrative index reference", category: "Global indices", price: 5_812, change: 21, changePercent: 0.36, available: true, marketStatus: "Sample" },
  { id: "sample-nasdaq", symbol: "NASDAQ 100", displayName: "Illustrative index reference", category: "Global indices", price: 20_940, change: -48, changePercent: -0.23, available: true, marketStatus: "Sample" },
  { id: "sample-euro", symbol: "EURO STOXX 50", displayName: "Illustrative index reference", category: "Global indices", price: 5_612, change: 17, changePercent: 0.30, available: true, marketStatus: "Sample" },
  { id: "sample-nikkei", symbol: "Nikkei 225", displayName: "Illustrative index reference", category: "Global indices", price: 49_220, change: -115, changePercent: -0.23, available: true, marketStatus: "Sample" },
  { id: "sample-adr", symbol: "HDFCBANK ADR", displayName: "Illustrative ADR reference", category: "ADRs", price: 22.8, change: 0.24, changePercent: 1.06, available: true, marketStatus: "Sample" },
];

export const SAMPLE_ACTIVITY = [
  { id: "sample-alert-1", index: "NIFTY", at: null, title: "Illustrative OI shift alert", detail: "Example 15-minute window · sample contracts only" },
  { id: "sample-alert-2", index: "BANKNIFTY", at: null, title: "Illustrative OI change alert", detail: "Example strike activity · not a live publisher alert" },
  { id: "sample-alert-3", index: "SENSEX", at: null, title: "Illustrative index activity", detail: "Fictional entry to demonstrate the shared activity feed" },
];

export const SAMPLE_DESK_MARKET = {
  updated_at: null,
  movers: [
    { index: "NIFTY", symbol: "SAMPLECO", pct: 0.62, weightage: 8.4 },
    { index: "NIFTY", symbol: "DEMO BANK", pct: 0.31, weightage: 6.2 },
    { index: "BANKNIFTY", symbol: "EXAMPLE FIN", pct: -0.28, weightage: 7.1 },
  ],
  breadth: {
    NIFTY: { n: 50, adv: 31, dec: 19 },
    BANKNIFTY: { n: 12, adv: 7, dec: 5 },
    SENSEX: { n: 30, adv: 18, dec: 12 },
  },
};
