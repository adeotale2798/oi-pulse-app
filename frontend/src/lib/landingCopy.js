export const LANDING_COPY_FIELDS = [
  {
    group: "Navigation",
    fields: [
      ["nav_product", "Product link", "Product"],
      ["nav_features", "Features link", "Features"],
      ["nav_premium", "Pro tools link", "Pro tools"],
      ["nav_pricing", "Pricing link", "Pricing"],
      ["nav_faq", "FAQ link", "FAQ"],
      ["nav_demo", "Demo link", "Explore demo"],
      ["nav_login", "Login link", "Login"],
      ["nav_start", "Get started button", "Get Started"],
    ],
  },
  {
    group: "Hero",
    fields: [
      ["hero_eyebrow", "Eyebrow", "Live options intelligence"],
      ["hero_title", "Headline", "Understand the options market before you trade."],
      ["hero_description", "Description", "StrikLenz brings open interest, index-weighted market movers and global context into one clear desk. Pro members can connect their own broker for a private Positions workspace and journal."],
      ["hero_start", "Start free button", "Start free"],
      ["hero_demo", "Interactive demo button", "Explore interactive demo"],
      ["hero_compare", "Compare plans button", "Compare plans"],
      ["hero_no_broker", "No-broker note", "No broker needed to start"],
    ],
  },
  {
    group: "Feature cards",
    fields: [
      ["features_title", "Section headline", "Everything the desk needs, in one view"],
      ["features_description", "Section description", "Purpose-built for Indian index options. No clutter, no noise — just the reads that move your decisions."],
      ["card_option_chain_title", "Full Option Chain title", "Full Option Chain"],
      ["card_option_chain_description", "Full Option Chain description", "OI, OI change, volume and PCR for every strike — instantly readable."],
      ["card_strike_pressure_title", "Strike Pressure title", "Strike Pressure"],
      ["card_strike_pressure_description", "Strike Pressure description", "See which side the writers are defending and where price is drawn."],
      ["card_global_markets_title", "Global Markets title", "Global Markets"],
      ["card_global_markets_description", "Global Markets description", "Track global indices, currencies, commodities and ADRs alongside the Indian session."],
      ["card_straddle_title", "Straddle title", "Straddle"],
      ["card_straddle_description", "Straddle description", "Track the ATM straddle premium through the session and review its recent range."],
      ["card_market_events_title", "Market & Global Events title", "Market & Global Events"],
      ["card_market_events_description", "Market & Global Events description", "Keep key India-market dates and global catalysts in view alongside the trading session."],
      ["card_desk_ai_title", "Desk AI title", "Desk AI"],
      ["card_desk_ai_description", "Desk AI description", "Desk AI brings Market Intel, Global Markets and Indian index movers together in one consolidated market briefing."],
    ],
  },
  {
    group: "Product demo",
    fields: [
      ["product_eyebrow", "Eyebrow", "Interactive demo"],
      ["product_title", "Section headline", "Step inside the terminal"],
      ["product_description", "Section description", "Explore OI Change, Straddle, Market & Global Events, Global Markets, Market Intel, Desk AI and a private Positions workspace. Open the Trade Journal preview to see how member notes and booked-day reviews fit into the terminal. Gallery values are illustrative samples."],
    ],
  },
  {
    group: "Pro showcase",
    fields: [
      ["pro_eyebrow", "Eyebrow", "Included with StrikLenz Pro"],
      ["pro_title", "Section headline", "Bring your own positions to the desk."],
      ["pro_description", "Section description", "Connect your own Zerodha account for a private positions book and per-leg P&L, then keep journal notes and neutral risk context beside the shared market desk. Desk AI brings Market Intel, Global Markets, Indian index movers and event context into one consolidated briefing. All screens below use fictional examples; Basic and Premium never need your broker login."],
      ["pro_oi_label", "Analyze preview label", "Analyze"],
      ["pro_oi_description", "Analyze preview description", "Scenario P&L · payoff shape · spot sensitivity"],
      ["pro_market_intel_label", "Market Intel preview label", "Market Intelligence · sample stories"],
      ["pro_journal_label", "Journal preview label", "Private Trade Journal · fictional example"],
      ["pro_positions_label", "PositionMeter preview label", "PositionMeter · fictional seller view"],
    ],
  },
  {
    group: "Broker section",
    fields: [
      ["broker_eyebrow", "Eyebrow", "One secure connection layer"],
      ["broker_title", "Section headline", "Connect your broker"],
      ["broker_description", "Section description", "Broker authentication stays on the broker's own page. StrikLenz never asks for your broker password. More integrations may be added over time."],
    ],
  },
  {
    group: "Plan comparison",
    fields: [
      ["pricing_title", "Section headline", "Choose your StrikLenz plan"],
      ["pricing_description", "Section description", "One publisher-provided market feed. Premium adds personal alerts; Pro adds your private broker-connected workspace."],
      ["pricing_indicative", "Indicative-price note", "Every plan includes Indicative Price in the sidebar during the admin-configured market window."],
      ["plan_normal_title", "Basic plan title", "Basic"],
      ["plan_normal_description", "Basic plan description", "Read the live OI desk, strike structure, build-up, straddles, Index Risk, and events on the shared publisher feed. No broker setup required."],
      ["plan_normal_intro", "Basic plan detail intro", "Start with the shared OI desk—no broker login or paid subscription required."],
      ["plan_normal_note", "Basic plan detail note", "These modules use the publisher's shared market feed. Your own broker connection is not required for this plan."],
      ["plan_premium_title", "Premium plan title", "StrikLenz Premium"],
      ["plan_premium_description", "Premium plan description", "Everything in Basic, plus personal OI alerts, Market Intel, and Global Markets."],
      ["plan_premium_intro", "Premium plan detail intro", "Add personal alerts and broader market context while continuing to use the shared publisher feed."],
      ["plan_premium_note", "Premium plan detail note", "These modules use the publisher's shared market feed. Your own broker connection is not required for this plan."],
      ["plan_pro_title", "Pro plan title", "StrikLenz Pro"],
      ["plan_pro_description", "Pro plan description", "Everything in Premium, with your own Positions workspace, private journal, a neutral overnight risk-factor summary, and Desk AI market context."],
      ["plan_pro_intro", "Pro plan detail intro", "Add your private Positions workspace and journal, plus a neutral risk-factor summary and Desk AI market context."],
      ["plan_pro_note", "Pro plan detail note", "Only your Pro Positions use your own broker account. Desk AI uses market context only; the shared feed remains publisher-owned, and no demo connects to your account."],
      ["pricing_footer", "Comparison footnote", "Basic and Premium use the shared publisher market feed. Only Pro connects your own Zerodha account for Positions. MCX access is admin-only. Plan features and availability are controlled by the administrator."],
    ],
  },
  {
    group: "FAQ",
    fields: [
      ["faq_title", "Section headline", "Questions, answered"],
      ["faq_0_question", "Question 1", "Do I need to connect my broker to use Striklenz?"],
      ["faq_0_answer", "Answer 1", "No. Core market intelligence — option chain, OI, OI Change, PCR and Strike Pressure for NIFTY, BANK NIFTY and SENSEX — is available without a broker connection."],
      ["faq_1_question", "Question 2", "What does Premium add?"],
      ["faq_1_answer", "Answer 2", "Premium adds personal in-app OI change and OI shift alerts, alert preferences, Market Intel, and Global Markets."],
      ["faq_2_question", "Question 3", "What does Pro add?"],
      ["faq_2_answer", "Answer 3", "Pro includes Premium plus your own broker-connected Positions workspace, a private trade journal, an overnight risk-factor summary, and Desk AI, which brings Market Intel, Global Markets and Indian index movers together in one consolidated market briefing."],
      ["faq_data_question", "Question 4", "Is the data on this page live?"],
      ["faq_data_answer", "Answer 4", "The product demos on this page use an interactive simulated feed so you can explore the experience instantly. Inside StrikLenz you get real market data."],
      ["faq_signin_question", "Question 5", "How do I sign in?"],
      ["faq_signin_answer", "Answer 5", "Tap Get Started and continue with Google. It takes seconds."],
    ],
  },
  {
    group: "Closing call to action and footer",
    fields: [
      ["cta_title", "Call-to-action headline", "You're one login from a sharper read."],
      ["cta_description", "Call-to-action description", "Start free in seconds. Continue with Google — no card, no setup."],
      ["cta_button", "Call-to-action button", "Get Started"],
      ["footer_disclaimer", "Footer risk notice", "Markets involve risk. For information only — not investment advice."],
    ],
  },
];

export const LANDING_COPY_DEFAULTS = Object.fromEntries(
  LANDING_COPY_FIELDS.flatMap(({ fields }) => fields.map(([key, , value]) => [key, value])),
);

const LEGACY_COPY_DEFAULTS = {
  hero_eyebrow: "Live options intelligence · NIFTY · BANK NIFTY · SENSEX",
  card_desk_ai_description: "Evidence-aware summaries of shared market context, without personal-position analysis or trade instructions.",
  faq_1_answer: "Premium adds personal in-app OI change and OI shift alerts, alert preferences, Market Intel, and Global Markets. It uses the publisher's shared market feed and does not require a broker login.",
  faq_2_answer: "Pro includes Premium plus your own Positions workspace, a private trade journal, an overnight risk-factor summary, and Desk AI market context. Only Pro's Positions data uses your own broker login; Desk AI does not analyze your positions or provide trade instructions.",
  plan_normal_title: "Normal",
  plan_normal_description: "Read the live OI desk, strike structure, build-up, straddles, Index Risk, and events on the shared publisher feed. No broker setup required.",
  plan_normal_intro: "Start with the shared OI desk—no broker login or paid subscription required.",
  plan_normal_note: "These modules use the publisher's shared market feed. Your own broker connection is not required for this plan.",
  plan_premium_description: "Everything in Normal, plus personal OI alerts, Market Intel, and Global Markets.",
  pricing_footer: "Normal and Premium use the shared publisher market feed. Only Pro connects your own Zerodha account for Positions. MCX access is admin-only. Plan features and availability are controlled by the administrator.",
  pro_description: [
    "Connect your own Zerodha account for a private positions book and per-leg P&L, then keep journal notes, booked-day reviews and neutral risk context beside the shared market desk. Desk AI uses shared market evidence only—it does not access, analyze or comment on your positions. All screens below use fictional examples; Normal and Premium never need your broker login.",
    "Connect your own Zerodha account for a private positions book and per-leg P&L, then keep journal notes and neutral risk context beside the shared market desk. Desk AI brings Market Intel, Global Markets, Indian index movers and event context into one consolidated briefing. All screens below use fictional examples; Normal and Premium never need your broker login.",
  ],
};

export function normalizeLandingCopy(raw) {
  return Object.fromEntries(
    Object.entries(LANDING_COPY_DEFAULTS).map(([key, fallback]) => {
      const value = raw?.[key];
      const legacyValues = Array.isArray(LEGACY_COPY_DEFAULTS[key])
        ? LEGACY_COPY_DEFAULTS[key]
        : [LEGACY_COPY_DEFAULTS[key]];
      const migratedValue = legacyValues.includes(value) ? fallback : value;
      return [key, typeof migratedValue === "string" ? migratedValue.slice(0, 800) : fallback];
    }),
  );
}
