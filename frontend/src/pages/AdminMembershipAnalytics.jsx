import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Download, Loader2, RefreshCw, Users, CreditCard, IndianRupee, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import OiPulseLogo from "@/components/OiPulseLogo";
import { api } from "@/lib/api";
import { membershipReconciliationCsv } from "@/lib/membershipReconciliationCsv";

const PLAN_LABELS = { normal: "Basic", premium: "Premium", pro: "Pro" };

function formatMoney(value, currency = "INR", fractionDigits = 0) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  } catch (_) {
    return `${currency} ${amount.toFixed(fractionDigits)}`;
  }
}

function formatDate(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "—";
}

function downloadReconciliation(rows, currency, dateRange) {
  const contents = membershipReconciliationCsv(rows, currency);
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `membership-reconciliation-${dateRange?.from || "range"}-${dateRange?.to || "range"}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function MetricCard({ label, value, detail, icon: Icon }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        {Icon ? <Icon className="h-4 w-4 text-emerald-700" aria-hidden="true" /> : null}
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-slate-950">{value}</p>
      {detail ? <p className="mt-1 text-xs text-slate-500">{detail}</p> : null}
    </article>
  );
}

function DailyActivity({ rows }) {
  const chart = useMemo(() => {
    const points = Array.isArray(rows) ? rows : [];
    const width = Math.max(720, points.length * 10);
    const slot = points.length ? width / points.length : width;
    const max = Math.max(1, ...points.flatMap((row) => [row.signups || 0, row.checkouts || 0]));
    const bars = points.map((row, index) => {
      const x = index * slot;
      const barWidth = Math.max(1, slot * 0.3);
      const signupHeight = (Number(row.signups) || 0) / max * 95;
      const checkoutHeight = (Number(row.checkouts) || 0) / max * 95;
      return {
        date: row.date,
        signups: Number(row.signups) || 0,
        checkouts: Number(row.checkouts) || 0,
        signup: { x: x + slot * 0.16, y: 112 - signupHeight, width: barWidth, height: signupHeight },
        checkout: { x: x + slot * 0.52, y: 112 - checkoutHeight, width: barWidth, height: checkoutHeight },
      };
    });
    return { width, bars, start: points[0]?.date, end: points[points.length - 1]?.date };
  }, [rows]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="membership-daily-activity">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="membership-daily-activity" className="font-bold text-slate-900">Signups and checkout starts</h2>
          <p className="mt-1 text-xs text-slate-500">Daily activity in the selected India-market date range.</p>
        </div>
        <div className="flex gap-4 text-xs text-slate-600">
          <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-600" />Signups</span>
          <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-sky-500" />Checkouts</span>
        </div>
      </div>
      {chart.bars.length ? (
        <div className="mt-4" role="img" aria-label="Daily signups and checkout starts bar chart">
          <svg height="124" viewBox={`0 0 ${chart.width} 124`} preserveAspectRatio="none" className="h-[124px] w-full">
            <line x1="0" y1="112" x2={chart.width} y2="112" stroke="#cbd5e1" />
            {chart.bars.map(({ date, signups, checkouts, signup, checkout }) => (
              <g key={date}>
                <rect {...signup} rx="1" fill="#059669"><title>{date}: {signups} signups</title></rect>
                <rect {...checkout} rx="1" fill="#0ea5e9"><title>{date}: {checkouts} checkout starts</title></rect>
              </g>
            ))}
          </svg>
          <div className="flex justify-between gap-2 text-[11px] text-slate-400">
            <span>{chart.start}</span><span>{chart.end}</span>
          </div>
        </div>
      ) : <p className="mt-4 text-sm text-slate-500">No activity for this range.</p>}
    </section>
  );
}

export default function AdminMembershipAnalytics() {
  const [period, setPeriod] = useState("7");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (params) => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/admin/membership-analytics", { params });
      setData(response.data);
      setCustomFrom(response.data?.date_range?.from || "");
      setCustomTo(response.data?.date_range?.to || "");
    } catch (requestError) {
      const message = requestError?.response?.data?.detail || "Could not load membership analytics.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (period !== "custom") load({ days: Number(period) });
  }, [load, period]);

  const applyCustomRange = (event) => {
    event.preventDefault();
    if (!customFrom || !customTo) {
      toast.error("Choose both a start and end date.");
      return;
    }
    setPeriod("custom");
    load({ from: customFrom, to: customTo });
  };

  const current = data?.current || {};
  const funnel = data?.funnel || {};
  const revenue = data?.revenue || {};
  const activePlans = current.members_by_plan || {};
  const billingActivity = (data?.daily || []).reduce((total, row) => ({
    charges: total.charges + (Number(row.charges) || 0),
    cancellations: total.cancellations + (Number(row.cancellations) || 0),
    failedPayments: total.failedPayments + (Number(row.failed_payments) || 0),
  }), { charges: 0, cancellations: 0, failedPayments: 0 });

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <Link to="/admin/settings" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
              <ArrowLeft className="h-4 w-4" /> Admin settings
            </Link>
            <div className="flex items-center gap-3">
              <OiPulseLogo className="h-9 w-9" pulse={false} />
              <div>
                <h1 className="text-2xl font-bold">Membership analytics</h1>
                <p className="text-sm text-slate-500">New joiners, paid conversion, subscriber health, and revenue.</p>
              </div>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <Link to="/admin/subscriptions" className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-sm font-semibold hover:bg-slate-100 sm:flex-none">
              Manage members
            </Link>
            <button type="button" disabled={loading} onClick={() => load(period === "custom" ? { from: customFrom, to: customTo } : { days: Number(period) })} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50 sm:flex-none">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </header>

        <section className="mb-5 flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Analytics date range">
          <div>
            <label htmlFor="membership-period" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Date range</label>
            <select
              id="membership-period"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm sm:w-auto"
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="custom">Custom range</option>
            </select>
            {data?.date_range ? <p className="mt-1 text-xs text-slate-500">{data.date_range.from} to {data.date_range.to} · India Standard Time</p> : null}
            {data?.performance ? (
              <p className={`mt-1 text-xs ${data.performance.elapsed_ms >= 2000 ? "text-amber-800" : "text-slate-500"}`}>
                Load {data.performance.elapsed_ms} ms · {data.performance.total_documents_read} records processed
              </p>
            ) : null}
          </div>
          {period === "custom" ? (
            <form onSubmit={applyCustomRange} className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
              <label className="min-w-0 flex-1 text-xs font-medium text-slate-600">
                From
                <input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="mt-1 block w-full min-w-0 rounded-lg border border-slate-300 px-2.5 py-2 text-sm" required />
              </label>
              <label className="min-w-0 flex-1 text-xs font-medium text-slate-600">
                To
                <input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="mt-1 block w-full min-w-0 rounded-lg border border-slate-300 px-2.5 py-2 text-sm" required />
              </label>
              <button type="submit" disabled={loading} className="w-full rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto">Apply</button>
            </form>
          ) : null}
        </section>

        {error && !data ? (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => load(period === "custom" ? { from: customFrom, to: customTo } : { days: Number(period) })} className="mt-3 rounded-lg border border-rose-300 px-3 py-1.5 font-semibold">Retry</button>
          </section>
        ) : loading && !data ? (
          <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading membership analytics…</p>
        ) : data ? (
          <div className="space-y-5">
            {error ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">{error} Showing the last successful results.</p> : null}

            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Membership overview">
              <MetricCard label="New signups" value={funnel.signups ?? 0} detail="Accounts created in this range" icon={Users} />
              <MetricCard label="Checkout started" value={funnel.checkout_started ?? 0} detail="Signup cohort with a recorded checkout" icon={CreditCard} />
              <MetricCard label="Paid conversions" value={funnel.paid ?? 0} detail={funnel.signup_to_paid_rate == null ? "No signups in this range" : `${funnel.signup_to_paid_rate}% of signups`} icon={TrendingUp} />
              <MetricCard label="Active paid subscriptions" value={current.active_paid_subscriptions ?? 0} detail="Current provider-active subscriptions" icon={Users} />
              <MetricCard label="Estimated monthly recurring revenue" value={formatMoney(current.estimated_mrr, current.currency, 2)} detail={current.estimated_mrr_note || "Run-rate from current configured regular prices; excludes one-off discounts"} icon={IndianRupee} />
              <MetricCard label="Actual net collections" value={formatMoney((revenue.net_collected_minor || 0) / 100, revenue.currency)} detail={`Selected range · gross ${formatMoney((revenue.gross_collected_minor || 0) / 100, revenue.currency)} · refunds ${formatMoney((revenue.refunded_minor || 0) / 100, revenue.currency)}`} icon={IndianRupee} />
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="membership-billing-signals">
              <h2 id="membership-billing-signals" className="font-bold text-slate-900">Billing activity</h2>
              <p className="mt-1 text-xs text-slate-500">{data.charge_note} Payment-attention risk is a current account count.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Successful charges" value={billingActivity.charges} detail="Deduplicated provider payments" icon={CreditCard} />
                <MetricCard label="Cancellations" value={billingActivity.cancellations} detail="Provider cancellations in range" icon={Users} />
                <MetricCard label="Failed payments" value={billingActivity.failedPayments} detail="Provider failures in range" icon={CreditCard} />
                <MetricCard label="Payment attention" value={current.payment_attention_count ?? 0} detail="Past-due, expired, or stale checkout accounts now" icon={TrendingUp} />
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="membership-cancellation-reasons">
              <h2 id="membership-cancellation-reasons" className="font-bold text-slate-900">Member-provided cancellation reasons</h2>
              <p className="mt-1 text-xs text-slate-500">Optional fixed categories selected by members during immediate cancellation; older cancellations may not have a reason.</p>
              {(data.cancellation_reasons || []).length ? (
                <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {data.cancellation_reasons.map(({ reason, count }) => (
                    <li key={reason} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span className="text-slate-700">{({
                        price: "Price",
                        not_using: "Not using enough",
                        missing_features: "Missing features",
                        technical_issue: "Technical issue",
                        broker_setup: "Broker setup",
                        switching: "Switching service",
                        other: "Other",
                        not_provided: "Not provided",
                      })[reason] || "Not provided"}</span>
                      <span className="font-semibold tabular-nums">{count}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-3 text-sm text-slate-500">No member-provided reasons in this range.</p>}
            </section>

            <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="membership-reconciliation">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="membership-reconciliation" className="font-bold text-slate-900">Monthly collection reconciliation</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{revenue.reconciliation_note}</p>
                </div>
                <button
                  type="button"
                  aria-label="Export monthly reconciliation CSV"
                  disabled={!(data.monthly_reconciliation || []).length}
                  onClick={() => downloadReconciliation(data.monthly_reconciliation, revenue.currency, data.date_range)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                >
                  <Download className="h-4 w-4" aria-hidden="true" /> Export CSV
                </button>
              </div>
              <div className="mt-4 hidden overflow-x-auto md:block">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="pb-2 font-semibold">Month</th>
                      <th className="pb-2 font-semibold">Coverage</th>
                      <th className="pb-2 text-right font-semibold">Payments</th>
                      <th className="pb-2 text-right font-semibold">Amount coverage</th>
                      <th className="pb-2 text-right font-semibold">Gross</th>
                      <th className="pb-2 text-right font-semibold">Refunds</th>
                      <th className="pb-2 text-right font-semibold">Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(data.monthly_reconciliation || []).map((row) => {
                      const payments = Number(row.successful_charges) || 0;
                      const withAmounts = Number(row.charges_with_amounts) || 0;
                      return (
                        <tr key={row.month}>
                          <th scope="row" className="py-2.5 font-semibold text-slate-700">{row.month}</th>
                          <td className="py-2.5 whitespace-nowrap text-xs text-slate-600">{row.coverage_from} to {row.coverage_to}</td>
                          <td className="py-2.5 text-right tabular-nums">{payments}</td>
                          <td className="py-2.5 text-right tabular-nums">
                            {withAmounts}/{payments} ({payments ? (withAmounts / payments * 100).toFixed(1) : "0.0"}%)
                          </td>
                          <td className="py-2.5 text-right tabular-nums">{formatMoney((row.gross_collected_minor || 0) / 100, revenue.currency)}</td>
                          <td className="py-2.5 text-right tabular-nums">{formatMoney((row.refunded_minor || 0) / 100, revenue.currency)}</td>
                          <td className="py-2.5 text-right font-semibold tabular-nums">{formatMoney((row.net_collected_minor || 0) / 100, revenue.currency)}</td>
                        </tr>
                      );
                    })}
                    {!(data.monthly_reconciliation || []).length ? (
                      <tr><td colSpan="7" className="py-4 text-slate-500">No billing activity for this range.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 grid gap-3 md:hidden" data-testid="analytics-mobile-reconciliation">
                {(data.monthly_reconciliation || []).map((row) => {
                  const payments = Number(row.successful_charges) || 0;
                  const withAmounts = Number(row.charges_with_amounts) || 0;
                  return (
                    <article key={row.month} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold text-slate-900">{row.month}</h3>
                          <p className="mt-0.5 text-xs text-slate-500">{row.coverage_from} to {row.coverage_to}</p>
                        </div>
                        <p className="text-right text-sm font-bold tabular-nums text-slate-900">{formatMoney((row.net_collected_minor || 0) / 100, revenue.currency)}</p>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-200 pt-3 text-xs">
                        <div><dt className="text-slate-500">Payments</dt><dd className="mt-0.5 font-semibold tabular-nums">{payments}</dd></div>
                        <div><dt className="text-slate-500">Amounts present</dt><dd className="mt-0.5 font-semibold tabular-nums">{withAmounts}/{payments} ({payments ? (withAmounts / payments * 100).toFixed(1) : "0.0"}%)</dd></div>
                        <div><dt className="text-slate-500">Gross</dt><dd className="mt-0.5 font-semibold tabular-nums">{formatMoney((row.gross_collected_minor || 0) / 100, revenue.currency)}</dd></div>
                        <div><dt className="text-slate-500">Refunds</dt><dd className="mt-0.5 font-semibold tabular-nums">{formatMoney((row.refunded_minor || 0) / 100, revenue.currency)}</dd></div>
                      </dl>
                    </article>
                  );
                })}
                {!(data.monthly_reconciliation || []).length ? <p className="text-sm text-slate-500">No billing activity for this range.</p> : null}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                {revenue.excluded_other_currency_records || 0} records in another currency are excluded. Compare this worksheet against Razorpay settlements; provider fees, taxes, disputes, and payout timing are not included.
              </p>
            </section>

            <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
              <DailyActivity rows={data.daily} />
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="membership-funnel">
                <h2 id="membership-funnel" className="font-bold text-slate-900">Signup conversion funnel</h2>
                <p className="mt-1 text-xs text-slate-500">Checkout and verified charge records attributed to accounts created in the selected range.</p>
                <div className="mt-5 space-y-4">
                  {[
                    ["Signups", funnel.signups || 0, 100],
                    ["Checkout started", funnel.checkout_started || 0, funnel.signup_to_checkout_rate],
                    ["Verified paid", funnel.paid || 0, funnel.signup_to_paid_rate],
                  ].map(([label, count, rate]) => (
                    <div key={label}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="font-medium">{label}</span>
                        <span className="tabular-nums">{count}{rate == null ? "" : ` · ${rate}%`}</span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.min(100, Math.max(0, rate || 0))}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs text-slate-500">Paid conversion requires a verified subscription charge event. Older checkout and payment history may be incomplete.</p>
              </section>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="membership-plan-mix">
                <h2 id="membership-plan-mix" className="font-bold text-slate-900">Current member plan mix</h2>
                <p className="mt-1 text-xs text-slate-500">Current accessible accounts; not limited to the selected signup date range.</p>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {Object.entries(PLAN_LABELS).map(([plan, label]) => (
                    <div key={plan} className="rounded-xl bg-slate-50 p-3 text-center">
                      <p className="text-xs font-medium text-slate-500">{label}</p>
                      <p className="mt-1 text-xl font-bold tabular-nums">{activePlans[plan] ?? 0}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex justify-between border-t border-slate-100 pt-3 text-sm">
                  <span className="text-slate-600">Estimated MRR by plan</span>
                  <span className="font-semibold">{formatMoney(current.estimated_mrr_by_plan?.premium || 0, current.currency, 2)} Premium · {formatMoney(current.estimated_mrr_by_plan?.pro || 0, current.currency, 2)} Pro</span>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="membership-acquisition">
                <h2 id="membership-acquisition" className="font-bold text-slate-900">Signup attribution</h2>
                <p className="mt-1 text-xs text-slate-500">Optional UTM labels or referrer hostname, for new accounts only.</p>
                {data.acquisition?.length ? (
                  <ul className="mt-3 divide-y divide-slate-100">
                    {data.acquisition.map((item) => (
                      <li key={item.source} className="flex justify-between gap-3 py-2 text-sm">
                        <span className="min-w-0 truncate text-slate-700">{item.source}</span>
                        <span className="font-semibold tabular-nums">{item.signups}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-4 text-sm text-slate-500">No signups in this range.</p>}
                <p className="mt-3 text-xs text-slate-500">Existing accounts and visits without campaign/referrer data appear as unknown.</p>
              </section>
            </div>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="membership-retention">
              <h2 id="membership-retention" className="font-bold text-slate-900">Paid-cohort retention</h2>
              <p className="mt-1 text-xs text-slate-500">{data.paid_cohort_note}</p>
              <div className="mt-4 hidden overflow-x-auto md:block">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate-500">
                    <tr><th className="pb-2 font-semibold">First paid month</th><th className="pb-2 text-right font-semibold">Paid members</th><th className="pb-2 text-right font-semibold">Active now</th><th className="pb-2 text-right font-semibold">Not active now</th><th className="pb-2 text-right font-semibold">Retained</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(data.paid_cohorts || []).filter((cohort) => cohort.paid_members > 0).map((cohort) => (
                      <tr key={cohort.month}>
                        <td className="py-2.5 font-medium">{cohort.month}</td>
                        <td className="py-2.5 text-right tabular-nums">{cohort.paid_members}</td>
                        <td className="py-2.5 text-right tabular-nums">{cohort.active_now}</td>
                        <td className="py-2.5 text-right tabular-nums">{cohort.not_active_now} · {cohort.not_active_rate}%</td>
                        <td className="py-2.5 text-right tabular-nums">{cohort.retention_rate}%</td>
                      </tr>
                    ))}
                    {!(data.paid_cohorts || []).some((cohort) => cohort.paid_members > 0) ? (
                      <tr><td colSpan="5" className="py-4 text-slate-500">No verified paid cohorts are available yet.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 grid gap-3 md:hidden" data-testid="analytics-mobile-cohorts">
                {(data.paid_cohorts || []).filter((cohort) => cohort.paid_members > 0).map((cohort) => (
                  <article key={cohort.month} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <h3 className="font-semibold text-slate-900">{cohort.month}</h3>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      <div><dt className="text-slate-500">Paid members</dt><dd className="mt-0.5 font-semibold tabular-nums">{cohort.paid_members}</dd></div>
                      <div><dt className="text-slate-500">Active now</dt><dd className="mt-0.5 font-semibold tabular-nums">{cohort.active_now}</dd></div>
                      <div><dt className="text-slate-500">Not active now</dt><dd className="mt-0.5 font-semibold tabular-nums">{cohort.not_active_now} · {cohort.not_active_rate}%</dd></div>
                      <div><dt className="text-slate-500">Retained</dt><dd className="mt-0.5 font-semibold tabular-nums">{cohort.retention_rate}%</dd></div>
                    </dl>
                  </article>
                ))}
                {!(data.paid_cohorts || []).some((cohort) => cohort.paid_members > 0) ? <p className="text-sm text-slate-500">No verified paid cohorts are available yet.</p> : null}
              </div>
            </section>

            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" aria-label="Revenue data note">
              <p className="font-semibold">Revenue data coverage</p>
              <p className="mt-1 text-xs leading-5">{revenue.note} Actual collection totals are based on signed, deduplicated provider events and exclude provider fees and taxes not included in the payment amount. Acquisition data has no advertising spend, so CAC is unavailable; historical collection gaps also make lifetime-value estimates unreliable.</p>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="membership-recent-signups">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 id="membership-recent-signups" className="font-bold text-slate-900">New joiners</h2>
                  <p className="mt-1 text-xs text-slate-500">Subscription and payment state shown beside each account.</p>
                </div>
                <span className="text-xs text-slate-500">{data.recent_signups_total || 0} signups in range</span>
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate-500">
                    <tr><th className="pb-2 font-semibold">Member</th><th className="pb-2 font-semibold">Joined</th><th className="pb-2 font-semibold">Plan</th><th className="pb-2 font-semibold">Subscription</th><th className="pb-2 font-semibold">Source</th><th className="pb-2 text-right font-semibold">Action</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(data.recent_signups || []).map((member) => (
                      <tr key={member.id}>
                        <td className="py-3">
                          <p className="font-semibold text-slate-900">{member.name || "Member"}{member.account_suspended ? " · Suspended" : ""}</p>
                          <p className="text-xs text-slate-500">{member.email || "—"}</p>
                        </td>
                        <td className="py-3 whitespace-nowrap text-slate-600">{formatDate(member.created_at)}</td>
                        <td className="py-3">{PLAN_LABELS[member.effective_plan || member.plan] || member.effective_plan || member.plan}</td>
                        <td className="py-3 text-slate-600">
                          {member.subscription_plan ? `${PLAN_LABELS[member.subscription_plan] || member.subscription_plan} · ` : ""}
                          <span className="capitalize">{String(member.subscription_status || "none").replaceAll("_", " ")}</span>
                        </td>
                        <td className="max-w-40 truncate py-3 text-slate-600" title={member.acquisition?.utm_source || member.acquisition?.referrer_host || "Unknown / not tracked"}>
                          {member.acquisition?.utm_source || member.acquisition?.referrer_host || "Unknown / not tracked"}
                        </td>
                        <td className="py-3 text-right">
                          <Link to={`/admin/subscriptions?member_id=${encodeURIComponent(member.id)}`} className="font-semibold text-emerald-800 underline-offset-2 hover:underline">Manage</Link>
                        </td>
                      </tr>
                    ))}
                    {!data.recent_signups?.length ? <tr><td colSpan="6" className="py-5 text-center text-slate-500">No new joiners for this range.</td></tr> : null}
                  </tbody>
                </table>
              </div>
              <ul className="grid gap-3 md:hidden" data-testid="analytics-mobile-signups">
                {(data.recent_signups || []).map((member) => (
                  <li key={member.id} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words font-semibold text-slate-900">{member.name || "Member"}{member.account_suspended ? " · Suspended" : ""}</p>
                        <p className="mt-0.5 break-all text-xs text-slate-500">{member.email || "—"}</p>
                      </div>
                      <Link to={`/admin/subscriptions?member_id=${encodeURIComponent(member.id)}`} className="shrink-0 rounded-lg border border-emerald-700 px-2.5 py-1.5 text-xs font-semibold text-emerald-800">Manage</Link>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-200 pt-3 text-xs">
                      <div><dt className="text-slate-500">Joined</dt><dd className="mt-0.5 font-medium text-slate-800">{formatDate(member.created_at)}</dd></div>
                      <div><dt className="text-slate-500">Plan</dt><dd className="mt-0.5 font-medium text-slate-800">{PLAN_LABELS[member.effective_plan || member.plan] || member.effective_plan || member.plan}</dd></div>
                      <div><dt className="text-slate-500">Subscription</dt><dd className="mt-0.5 break-words font-medium capitalize text-slate-800">{member.subscription_plan ? `${PLAN_LABELS[member.subscription_plan] || member.subscription_plan} · ` : ""}{String(member.subscription_status || "none").replaceAll("_", " ")}</dd></div>
                      <div className="min-w-0"><dt className="text-slate-500">Source</dt><dd className="mt-0.5 break-words font-medium text-slate-800">{member.acquisition?.utm_source || member.acquisition?.referrer_host || "Unknown / not tracked"}</dd></div>
                    </dl>
                  </li>
                ))}
                {!data.recent_signups?.length ? <li className="py-5 text-center text-sm text-slate-500">No new joiners for this range.</li> : null}
              </ul>
              {data.recent_signups_truncated ? <p className="mt-3 text-xs text-slate-500">Showing the 50 most recent of {data.recent_signups_total} signups.</p> : null}
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
