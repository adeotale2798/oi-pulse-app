import { LANDING_COPY_DEFAULTS, LANDING_COPY_FIELDS, normalizeLandingCopy } from "./landingCopy";
import { FAQS } from "@/config/site";

describe("landing copy", () => {
  it("exposes editable defaults for all public copy groups", () => {
    expect(LANDING_COPY_FIELDS.map(({ group }) => group)).toEqual(expect.arrayContaining([
      "Navigation",
      "Hero",
      "Feature cards",
      "Plan comparison",
      "FAQ",
      "Closing call to action and footer",
    ]));
    expect(LANDING_COPY_DEFAULTS.pro_market_intel_label).toContain("Market Intelligence");
    expect(LANDING_COPY_DEFAULTS.product_description).toContain("Straddle");
    expect(LANDING_COPY_DEFAULTS.product_description).toContain("Market & Global Events");
    expect(LANDING_COPY_DEFAULTS.faq_signin_answer).toContain("Google");
    const faqCopy = FAQS.map(({ q, a }) => `${q} ${a}`).join(" ");
    expect(faqCopy).not.toContain("broker password");
    expect(faqCopy).not.toContain("Which brokers are supported?");
    expect(faqCopy).not.toContain("or enter as a guest");
    expect(LANDING_COPY_FIELDS.flatMap(({ fields }) => fields.map(([key]) => key)))
      .not.toEqual(expect.arrayContaining(["faq_3_question", "faq_4_question"]));
  });

  it("uses defaults for absent values and bounds configured strings", () => {
    const normalized = normalizeLandingCopy({
      hero_title: "Admin headline",
      cta_description: "x".repeat(900),
      ignored_field: "not rendered",
    });

    expect(normalized.hero_title).toBe("Admin headline");
    expect(normalized.features_title).toBe(LANDING_COPY_DEFAULTS.features_title);
    expect(normalized.cta_description).toHaveLength(800);
    expect(normalized).not.toHaveProperty("ignored_field");
  });

  it("replaces legacy default marketing copy without overriding custom Admin copy", () => {
    const normalized = normalizeLandingCopy({
      hero_eyebrow: "Live options intelligence · NIFTY · BANK NIFTY · SENSEX",
      faq_1_answer: "Premium adds personal in-app OI change and OI shift alerts, alert preferences, Market Intel, and Global Markets. It uses the publisher's shared market feed and does not require a broker login.",
      faq_2_answer: "Pro includes Premium plus your own Positions workspace, a private trade journal, an overnight risk-factor summary, and Desk AI market context. Only Pro's Positions data uses your own broker login; Desk AI does not analyze your positions or provide trade instructions.",
      pro_description: "Connect your own broker account for a private positions book and per-leg P&L, then keep journal notes, booked-day reviews and neutral risk context beside the shared market desk. Desk AI uses shared market evidence only—it does not access, analyze or comment on your positions. All screens below use fictional examples; Normal and Premium never need your broker login.",
      card_desk_ai_description: "A custom Admin-written Desk AI description.",
    });

    expect(normalized.hero_eyebrow).toBe("Live options intelligence");
    expect(normalized.faq_1_answer).not.toContain("publisher's shared market feed");
    expect(normalized.faq_2_answer).toContain("consolidated market briefing");
    expect(normalized.pro_description).toContain("Market Intel, Global Markets, Indian index movers");
    expect(normalized.pro_description).not.toContain("does not access, analyze or comment");
    expect(normalized.card_desk_ai_description).toBe("A custom Admin-written Desk AI description.");
  });

  it("renames the Normal plan's public copy to Basic without changing custom plan text", () => {
    const normalized = normalizeLandingCopy({
      plan_normal_title: "Normal",
      plan_premium_description: "Everything in Normal, plus personal OI alerts, Market Intel, and Global Markets.",
      plan_normal_description: "A custom description for my free plan.",
    });

    expect(normalized.plan_normal_title).toBe("Basic");
    expect(normalized.plan_premium_description).toContain("Everything in Basic");
    expect(normalized.plan_normal_description).toBe("A custom description for my free plan.");
  });
});
