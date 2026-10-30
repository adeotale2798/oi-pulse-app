import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import OiPulseLogo from "@/components/OiPulseLogo";
import { api } from "@/lib/api";

const LEGAL_PAGES = {
  terms: {
    title: "Terms of use",
    intro: "These terms describe use of the StrikLenz website, dashboards, analytics, alerts, subscription plans, and broker-connected features.",
    sections: [
      {
        title: "Accounts and access",
        paragraphs: [
          "You are responsible for keeping your Google, StrikLenz, and broker access secure and for activity performed through your account. Use only accounts and broker credentials you are authorized to use. Contact the operator promptly if you suspect unauthorized access; a dedicated operator contact is not yet published.",
          "Plan features and access are controlled by the account's current entitlement and may differ between Basic, Premium, Pro, guest, and Admin accounts. Do not share access or attempt to bypass those controls.",
        ],
      },
      {
        title: "Permitted use",
        paragraphs: [
          "Use the service only in compliance with applicable law, exchange rules, and the terms of connected providers. Do not probe, disrupt, overload, reverse engineer, scrape, resell, or make unauthorized access to the service or another user's account or data.",
          "You retain responsibility for content you add, including journal notes and images. Do not upload content you do not have the right to use or content that contains another person's confidential information without authorization.",
        ],
      },
      {
        title: "Information, analytics, and trading risk",
        paragraphs: [
          "Market data, OI, alerts, event summaries, analytics, AI-generated market context, and other outputs are informational tools. They are not individualized investment, trading, legal, tax, or accounting advice, and are not an offer or recommendation to buy or sell any instrument.",
          "Guests and paid members do not receive ranked sell candidates or recommendations about which instrument or strike to sell. That analysis is restricted to the authenticated Admin workspace and is not a customer feature.",
          "Metrics and alerts use data and assumptions that may be incomplete, delayed, stale, revised, or unsuitable for your strategy. They are not probabilities of profit or guarantees of any outcome. Verify market data, positions, margin, and orders directly with your broker before acting.",
          "Options, futures, and other leveraged products involve substantial risk, including rapid losses and, for some strategies, losses exceeding the amount initially committed. You make and remain responsible for your trading decisions and for assessing whether a product or strategy is suitable for you.",
        ],
      },
      {
        title: "Broker connections and order workflows",
        paragraphs: [
          "Broker-connected features depend on your credentials, broker systems, permissions, network, instrument availability, and configuration. Positions and P&L displayed in StrikLenz may differ from the broker's authoritative records. The broker's own contract notes, order book, margin view, and statements control.",
          "Some Admin-only CAS workflows can submit orders through the configured publisher broker account, including configured automated order workflows. Orders can be rejected, delayed, partially filled, or filled at an unexpected price; a workflow may not automatically exit a position. The account operator must verify the setup, monitor the broker, and manage resulting positions. A screen state is not confirmation of execution.",
          "Never provide broker credentials unless you understand and authorize the connection. Pro member broker credentials are used for that member's Positions integration; publisher credentials and publisher market-data collection are separate. Broker services are provided under the broker's own terms.",
        ],
      },
      {
        title: "Subscriptions, renewal, and cancellation",
        paragraphs: [
          "Plan features, price, currency, billing cadence, and any introductory offer are the details shown in the applicable checkout before payment. Review those details and the Razorpay confirmation before authorizing a recurring payment. Razorpay processes subscription payments under its own terms.",
          "Paid plans may renew automatically at the cadence disclosed at checkout until cancelled. The app does not currently send renewal reminder emails. Paid access is granted after the service receives and verifies the provider's subscription event; returning from a checkout page alone does not confirm payment.",
          "The cancellation control is in Account Settings. Under current app behavior, cancelling returns app access to Basic immediately; payment failure or a provider-reported end can also remove paid access. This access change does not itself confirm a refund or prove that a provider-side recurring instruction has been cancelled; retain and check the provider confirmation.",
          "No automatic prorated refund is promised solely because of cancellation. Refunds, reversals, and statutory rights remain subject to applicable law and the provider's rules. The service currently has no in-app refund-request workflow.",
        ],
      },
      {
        title: "Service changes and suspension",
        paragraphs: [
          "The operator may change, suspend, or discontinue a feature to maintain security, comply with provider requirements, respond to outages, or maintain the service. Access may be restricted for suspected abuse, unauthorized access, security risk, non-payment, or legal requirements.",
          "The operator has not published a complete account suspension, termination, or appeal procedure. Any action remains subject to applicable law and rights that cannot be waived.",
        ],
      },
      {
        title: "Ownership, third parties, and legal terms",
        paragraphs: [
          "The StrikLenz name, software, interface, and service materials are owned by or licensed to the operator. These terms do not transfer ownership to you. Third-party providers and linked services remain subject to their own terms and privacy notices.",
          "The operator's legal identity, address, governing-law selection, dispute forum, and dedicated support/grievance contact are not published in this draft. They must be supplied and reviewed by qualified counsel before these terms are relied on as a complete customer agreement.",
          "These terms do not exclude or limit any consumer or other liability that cannot lawfully be excluded or limited. Any remaining limitation, indemnity, governing-law, and dispute-resolution language must be settled by the operator and qualified counsel for the actual service and jurisdiction.",
          "The operator may update these terms with notice or consent where required by applicable law. The applicable version and date should be retained for each paid subscription and material policy update; that version-history workflow is not currently presented in the app.",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy notice",
    intro: "This notice summarizes data the current StrikLenz application handles, why it is used, who may receive it, and current retention limits.",
    sections: [
      {
        title: "Information the service handles",
        paragraphs: [
          "Google sign-in supplies account identifiers and profile details such as name and email. The service also stores account plan and subscription status, preferences, session/revocation records, and audit events needed to operate and protect the account. The service does not receive your Google password.",
          "For Pro broker Positions, the service stores the broker app API key, API secret, and daily access token encrypted; it also links the member to the first broker account ID used. Those credentials are not returned to the browser. The member can permanently remove the saved credential record from Account Settings, but the account's linked broker identity remains.",
          "Member journal data may include notes, tags, ratings, screenshots, daily P&L summaries, aggregate counts, and per-index P&L. Ordinary journal refreshes do not persist individual broker position legs or detailed trade cycles. Detailed cycles are stored only if an Admin explicitly enables that member's trade-cycle storage; disabling the setting stops future persistence but does not delete previously stored cycles.",
          "The service stores member alert preferences and limited member-scoped alert events. Alert-event records expire at the daily retention boundary; subscription, audit, journal, and billing records currently have no automatic expiry.",
          "Razorpay webhook records are signature-verified and store only allowlisted event and subscription identifiers, timestamps, and payment IDs, amounts, refund totals, and currency when supplied. The application does not retain raw webhook payloads, payer details, or payment-method details in those billing-event records. Razorpay separately handles payment credentials under its own practices.",
          "For new accounts, optional signup attribution may store bounded UTM labels and a referrer hostname. Full referrer paths and query strings are not stored. For access security and troubleshooting, the service may process IP address, browser user-agent, request timestamps, and error metadata.",
          "The app uses browser session/local storage for sign-in tokens and interface state and authenticates API requests with headers; it does not use authentication cookies. Clearing browser storage does not delete server-side account or journal records.",
        ],
      },
      {
        title: "Purposes and recipients",
        paragraphs: [
          "Data is used to authenticate users, apply plan access, show account-owned Positions and journal features, configure preferences, process subscriptions, reconcile verified billing events, prevent abuse, secure the service, and troubleshoot errors.",
          "Depending on the feature, data may be processed by Google (sign-in), Razorpay (checkout and subscription payments), Zerodha/Kite (broker authentication and account data), and the service's hosting, database, network, and market/news-data providers. Their own privacy terms apply; the operator should publish the actual legal provider list and data-location information before commercial launch.",
          "The service operator and authorized Admins may access account and operational records for administration, security, billing, and support. Account-specific member records are not intentionally made public. Shared publisher market data and public landing-page content are distinct from private member Positions, credentials, and journal records.",
          "The application does not sell member journal entries or broker credentials. Information may also be disclosed where required by law or to protect the service and its users; the operator should have counsel define the exact notice and process.",
        ],
      },
      {
        title: "Retention and account controls",
        paragraphs: [
          "Subscription lapse, cancellation, refund, or Admin suspension does not automatically delete the member account, broker configuration, journal, billing, or audit records. Most of these records currently have no automatic expiry. Member alert-event records have a daily retention boundary. Hosting backups follow provider settings and are separate from application cleanup.",
          "Members can remove their saved broker credential record and manage available preferences in Account Settings. The service currently has no member self-service account deletion, journal deletion, or data export control. Account and journal removal requires an operator-managed database process; no public request channel or processing timeframe is currently configured.",
          "Privacy requests may be subject to identity verification, legal obligations, provider retention, and backup limitations. The operator must define a working access/correction/deletion request channel, response process, retention schedule, and applicable exceptions before launch; this page does not create controls the app does not yet have.",
        ],
      },
      {
        title: "Security, children, and contact",
        paragraphs: [
          "Broker secrets are encrypted before storage and are not returned to the browser. The operator should maintain access controls, backups, incident response, and security monitoring appropriate to the information processed. No internet service can guarantee absolute security.",
          "The application does not publish an age threshold or a child-data process. The operator must set these with qualified counsel; do not provide personal information if you are not permitted to use the service under applicable rules.",
          "A named privacy contact and legal operator identity are not currently published. Until those details and a request process are available, this notice is incomplete for handling individual privacy requests.",
          "This notice describes current application behavior, not every independent provider's practices. Review the linked Terms, Subscription & Refund, and Market Risk pages. Material changes should be dated and communicated as required by applicable law.",
        ],
      },
    ],
  },
  subscriptions: {
    title: "Subscriptions and refunds",
    intro: "Check the plan and checkout details before authorizing payment. The checkout screen and Razorpay confirmation are the transaction-specific source for price and cadence.",
    sections: [
      {
        title: "Plans and payment",
        paragraphs: [
          "Basic, Premium, and Pro plan availability and included features are shown in the app. Paid price, currency, cadence, and any first-period offer must be confirmed on the checkout page before you authorize payment; do not rely on an old screenshot, advertisement, or cached price.",
          "Razorpay processes subscription payments under its own terms. The service grants paid access only after a signature-verified provider event; a browser redirect or screenshot alone is not confirmation that payment succeeded.",
          "The service's analytics report verified provider events, not a bank or settlement statement. Reported collections may omit provider fees, taxes, disputes, settlement timing, and older events that lack amounts.",
        ],
      },
      {
        title: "Renewals, cancellation, and access",
        paragraphs: [
          "Paid plans may renew automatically at the cadence disclosed at checkout. The app currently does not send renewal reminder emails. Keep the provider's subscription and payment confirmation for your records.",
          "Use the cancellation control in Account Settings while signed in. Current app behavior returns your app access to Basic immediately after cancellation; a payment failure or provider-reported subscription end can also remove paid access. Do not assume that access downgrade itself confirms the provider has stopped future billing—check the provider's cancellation confirmation.",
          "If checkout is pending, the app may show a link to resume it. Paid features remain unavailable until the verified provider status is received. If app and provider status disagree, preserve the provider reference and avoid starting a duplicate checkout until the discrepancy is resolved.",
        ],
      },
      {
        title: "Refunds",
        paragraphs: [
          "The application does not currently offer an in-app refund-request workflow or promise automatic prorated refunds for unused time after cancellation. A cancellation is not a refund. Refund eligibility and processing depend on applicable law, the transaction, and payment-provider rules; rights that cannot lawfully be waived remain unaffected.",
          "A dedicated billing support contact, refund-request channel, response time, and refund decision process are not currently published. These are launch blockers for a professional paid service and must be supplied by the operator; no specific refund promise is made by this draft.",
        ],
      },
      {
        title: "Questions about a charge",
        paragraphs: [
          "Check the plan and subscription history in Account Settings and compare them with your Razorpay confirmation. The app does not currently publish a dedicated billing contact or escalation route. For provider-side payment issues, retain the provider reference and use Razorpay's available support or dispute process while the service operator establishes a customer-support channel.",
        ],
      },
    ],
  },
  risk: {
    title: "Market risk disclosure",
    intro: "This disclosure applies to market data, OI analytics, alerts, event summaries, AI-generated market context, broker-linked Positions, and any optional order workflow available through StrikLenz.",
    sections: [
      {
        title: "Trading involves substantial risk",
        paragraphs: [
          "Options, futures, and other leveraged products can move rapidly. You may lose some or all of your capital, and losses can exceed the amount initially committed in some strategies. Past performance and historical patterns do not guarantee future results.",
          "Trade only if you understand the product, payoff, liquidity, margin, and worst-case loss. Consider your financial circumstances and consult an appropriately qualified professional where needed.",
          "StrikLenz is a software and information service, not your broker, exchange, custodian, or counterparty. The app does not hold your brokerage funds. Orders, funds, margin, and holdings are maintained by your broker.",
        ],
      },
      {
        title: "Analytics are estimates, not predictions",
        paragraphs: [
          "Open interest, OI change, volatility, GEX, event exposure, market intelligence, and other displayed metrics are derived from available inputs and assumptions. They may be noisy, incomplete, stale, revised, or unsuitable for your strategy. Directional labels and alert thresholds are not probabilities of profit.",
          "Desk AI outputs may be incomplete or incorrect and are not a substitute for source documents or independent verification. Alerts can arrive late, be duplicated, or not arrive. Historical performance and illustrative landing-page examples are not live recommendations or proof of future results.",
          "StrikLenz does not guarantee accuracy, completeness, timeliness, uninterrupted delivery, execution quality, or any investment outcome. Verify prices, positions, margin, and orders directly with your broker before acting.",
        ],
      },
      {
        title: "Broker orders and execution",
        paragraphs: [
          "Some Admin-only CAS workflows may submit orders to the configured broker account when enabled. The broker may reject, delay, partially fill, or fill an order at a different price. Network delay, exchange halts, market liquidity, order limits, credentials, and configuration can prevent or change execution. Do not assume that a scheduled workflow will fire, that it fired because the screen changed, or that it will close an open position.",
          "Where an authorized operator enables an automated order workflow, the operator remains responsible for authorization, configuration, instrument/quantity/product checks, live monitoring, and manual risk management. Test and understand the workflow before enabling live orders. Follow the broker's authoritative order book and positions.",
        ],
      },
      {
        title: "No personalized recommendation or regulatory status",
        paragraphs: [
          "The service does not assess an individual's financial circumstances, investment objectives, or risk tolerance and does not promise returns. Do not treat any feature name, alert, AI output, or marketing description as a personalized recommendation.",
          "No statement on this site establishes that the operator is registered, licensed, authorized, or exempt under any financial-services law. The operator must have qualified Indian counsel review the actual product, order automation, customer journey, data arrangements, and marketing to determine what registrations, disclosures, or restrictions apply before launch.",
        ],
      },
      {
        title: "Third-party data and outages",
        paragraphs: [
          "Data availability depends on exchanges, brokers, news sources, networks, and hosting providers. A visible timestamp or status indicator is not a guarantee that every underlying feed is current. If a feed is missing or stale, stop relying on it until independently verified.",
          "Maintenance, provider outages, rate limits, market closures, rejected requests, device problems, or connectivity failure can interrupt the service. Keep independent access to your broker and do not use StrikLenz as the sole method to monitor or manage a position.",
        ],
      },
      {
        title: "No waiver of legal rights",
        paragraphs: [
          "This disclosure explains risk; it does not waive consumer, investor, or other rights that cannot legally be waived, and it does not determine the operator's legal or regulatory obligations. Obtain advice from a qualified professional for your circumstances.",
        ],
      },
    ],
  },
};

const PAGE_LINKS = [
  ["terms", "Terms"],
  ["privacy", "Privacy"],
  ["subscriptions", "Subscriptions & refunds"],
  ["risk", "Market risk"],
];

export default function PublicLegalPage() {
  const { document } = useParams();
  const page = LEGAL_PAGES[document];
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get("/auth/state")
      .then(({ data }) => {
        if (!cancelled) setIsAdmin(data?.is_admin === true);
      })
      .catch((error) => {
        console.warn("Could not verify Admin access for the publication note; keeping it hidden.", error);
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!page) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-3xl rounded-2xl bg-white p-6 shadow-sm sm:p-10">
          <h1 className="text-2xl font-bold">Page not found</h1>
          <Link to="/" className="mt-4 inline-flex font-semibold text-emerald-800 underline">Return to StrikLenz</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link to="/" aria-label="StrikLenz home" className="inline-flex items-center gap-2">
            <OiPulseLogo className="h-8 w-8" pulse={false} />
            <span className="text-lg font-bold">Strik<span className="text-emerald-600">Lenz</span></span>
          </Link>
          <Link to="/login" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-100">Sign in</Link>
        </header>

        <nav aria-label="Trust and legal pages" className="mb-5 flex flex-wrap gap-2">
          {PAGE_LINKS.map(([slug, label]) => (
            <Link
              key={slug}
              to={`/legal/${slug}`}
              aria-current={document === slug ? "page" : undefined}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                document === slug
                  ? "border-emerald-700 bg-emerald-700 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-9">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Trust & legal · Version V21.04 · Updated 30 October 2026</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{page.title}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{page.intro}</p>
          {isAdmin && (
            // Remove this Admin-only readiness note once operator/contact details and counsel review are published.
            <aside aria-label="Publication status" data-testid="publication-readiness-note" className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
              <p className="font-semibold">Publication readiness: operator details and legal review are still required.</p>
              <p className="mt-1">
                This product disclosure does not yet name the legal service operator or publish a customer-support, privacy-request, or billing/refund contact. The operator must add those details, define the request and complaint process, and have the actual service and these documents reviewed by qualified Indian counsel before treating them as complete customer terms or promoting paid subscriptions.
              </p>
            </aside>
          )}
          <div className="mt-7 space-y-7">
            {page.sections.map((section) => (
              <section key={section.title}>
                <h2 className="text-lg font-semibold">{section.title}</h2>
                <div className="mt-2 space-y-3 text-sm leading-6 text-slate-700">
                  {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                </div>
              </section>
            ))}
          </div>
          <p className="mt-8 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">
            These pages describe known current product behavior and do not guarantee legal compliance or replace legal advice. Check this page for updates before relying on it; applicable law and the transaction-specific checkout terms may provide rights not described here.
          </p>
        </article>
        <footer className="py-6 text-center text-xs text-slate-500">
          <Link to="/" className="hover:text-slate-800">Home</Link>
          <span className="px-2">·</span>
          <Link to="/login" className="hover:text-slate-800">Sign in</Link>
        </footer>
      </div>
    </main>
  );
}
