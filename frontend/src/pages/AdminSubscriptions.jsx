import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import OiPulseLogo from "@/components/OiPulseLogo";
import { api } from "@/lib/api";

const PLANS = ["normal", "premium", "pro"];
const PLAN_LABELS = { normal: "Basic", premium: "Premium", pro: "Pro" };
const CANCELLATION_REASON_LABELS = {
  price: "Price",
  not_using: "Not using it enough",
  missing_features: "Missing features",
  technical_issue: "Technical issue",
  broker_setup: "Broker setup was difficult",
  switching: "Switching to another service",
  other: "Other",
};

function formatDate(value, includeTime = false) {
  const parsed = typeof value === "number" ? value * 1000 : Date.parse(value);
  if (!Number.isFinite(parsed)) return "—";
  return new Date(parsed).toLocaleString(undefined, includeTime
    ? { dateStyle: "short", timeStyle: "short" }
    : { dateStyle: "short" });
}

export default function AdminSubscriptions() {
  const [members, setMembers] = useState([]);
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [auditMemberId, setAuditMemberId] = useState(null);
  const [auditEvents, setAuditEvents] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [memberFilterId, setMemberFilterId] = useState(
    () => new URLSearchParams(window.location.search).get("member_id"),
  );

  const load = useCallback(async () => {
    setLoading(true);
    const [membersResult, healthResult] = await Promise.allSettled([
      api.get(memberFilterId
        ? `/admin/members?member_id=${encodeURIComponent(memberFilterId)}`
        : "/admin/members"),
      api.get("/admin/subscription-health"),
    ]);
    if (membersResult.status === "fulfilled") {
      setMembers(membersResult.value.data.members || []);
    } else {
      toast.error(membersResult.reason?.response?.data?.detail || "Could not load member accounts.");
    }
    if (healthResult.status === "fulfilled") {
      setHealth(healthResult.value.data);
      setHealthError("");
    } else {
      const message = healthResult.reason?.response?.data?.detail || "Could not load subscription health.";
      setHealthError(message);
      toast.error(message);
    }
    setLoading(false);
  }, [memberFilterId]);

  useEffect(() => { load(); }, [load]);

  const save = async (member, patch) => {
    setSavingId(member.id);
    try {
      await api.patch(`/admin/members/${encodeURIComponent(member.id)}`, patch);
      toast.success("Member updated.");
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update member.");
    } finally {
      setSavingId(null);
    }
  };

  const toggleAudit = async (memberId) => {
    if (auditMemberId === memberId) {
      setAuditMemberId(null);
      return;
    }
    setAuditMemberId(memberId);
    setAuditLoading(true);
    try {
      const { data } = await api.get(`/admin/members/${encodeURIComponent(memberId)}/audit`);
      setAuditEvents(data.events || []);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not load member audit history.");
      setAuditMemberId(null);
    } finally {
      setAuditLoading(false);
    }
  };

  const openMember = async (member) => {
    if (!members.some((row) => row.id === member.id)) {
      try {
        const { data } = await api.get(`/admin/members?member_id=${encodeURIComponent(member.id)}`);
        const selected = data.members?.[0];
        if (selected) setMembers((current) => [selected, ...current.filter((row) => row.id !== selected.id)]);
      } catch (error) {
        toast.error(error?.response?.data?.detail || "Could not load this member.");
        return;
      }
    }
    setMemberFilterId(member.id);
    window.setTimeout(() => {
      document.getElementById(`member-${encodeURIComponent(member.id)}`)?.scrollIntoView?.({
        behavior: "smooth",
        block: "center",
      });
    }, 0);
  };

  const auditLabel = (event) => {
    const labels = {
      admin_member_updated: "Admin changed member access or storage settings",
      broker_credentials_saved: "Member saved or replaced broker app credentials",
      broker_credentials_deleted: "Member removed saved broker app credentials",
      broker_session_disconnected: "Member signed out of the broker session",
      subscription_checkout_created: "Member started secure checkout",
      subscription_renewal_cancelled: "Member cancelled subscription and returned to Basic",
      subscription_status_changed: "Payment provider updated subscription status",
    };
    const label = labels[event.event_type] || String(event.event_type || "").replaceAll("_", " ");
    const reason = CANCELLATION_REASON_LABELS[event.details?.reason];
    return event.event_type === "subscription_renewal_cancelled" && reason
      ? `${label} · Reason: ${reason}`
      : label;
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-7 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link to="/admin/settings" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
              <ArrowLeft className="h-4 w-4" /> Admin settings
            </Link>
            <div className="flex items-center gap-3">
              <OiPulseLogo className="h-9 w-9" pulse={false} />
              <div>
                <h1 className="text-2xl font-bold">Subscriptions & members</h1>
                <p className="text-sm text-slate-500">Manage plan access, account suspension, broker link status, and trade-cycle storage consent.</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/admin/membership-analytics" className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
              Membership analytics
            </Link>
            <button type="button" disabled={loading} onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </header>

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-label="Subscription health" data-testid="subscription-health">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold">Subscription health</h2>
              <p className="text-xs text-slate-500">Accessible members by enabled plan and all-time deduplicated billing events.</p>
            </div>
            {health && !health.basic_plan_enabled && (
              <p className="text-xs font-semibold text-amber-800">Basic access is disabled</p>
            )}
          </div>
          {healthError ? (
            <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{healthError}</p>
          ) : !health ? (
            <p className="text-sm text-slate-500"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading subscription health…</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {PLANS.map((plan) => (
                <div key={plan} className="rounded-xl bg-slate-50 p-3" data-testid={`health-active-${plan}`}>
                  <p className="text-xs font-semibold text-slate-500">{PLAN_LABELS[plan]} active</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{health.active_members_by_plan?.[plan] ?? 0}</p>
                </div>
              ))}
              {[
                ["Charge events", health.all_time?.charge_events],
                ["Cancellations", health.all_time?.cancellations],
                ["Failed payments", health.all_time?.failed_payments],
                ["Basic members blocked", health.blocked_basic_members],
              ].map(([label, value]) => (
                <div key={label} className={`rounded-xl p-3 ${label === "Basic members blocked" && value > 0 ? "bg-amber-50" : "bg-slate-50"}`} data-testid={`health-${label.toLowerCase().replaceAll(/[^a-z]+/g, "-")}`}>
                  <p className={`text-xs font-semibold ${label === "Basic members blocked" && value > 0 ? "text-amber-800" : "text-slate-500"}`}>{label}</p>
                  <p className={`mt-1 text-2xl font-bold tabular-nums ${label === "Basic members blocked" && value > 0 ? "text-amber-900" : "text-slate-900"}`}>{value ?? 0}</p>
                </div>
              ))}
            </div>
          )}
          {health && !healthError && (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {!health.basic_plan_enabled && (
                <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4" aria-label="Basic members blocked by plan setting">
                  <h3 className="font-semibold text-amber-950">
                    Basic access blocked <span className="text-sm font-normal">({health.blocked_basic_members ?? 0})</span>
                  </h3>
                  <p className="mt-1 text-xs text-amber-900">These enabled accounts cannot enter while the Basic plan is disabled.</p>
                  {health.blocked_basic_member_list?.length ? (
                    <ul className="mt-3 divide-y divide-amber-200">
                      {health.blocked_basic_member_list.map((member) => (
                        <li key={member.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-slate-900">{member.name || member.email || member.id}</span>
                            {member.email && <span className="block truncate text-xs text-slate-600">{member.email}</span>}
                          </span>
                          <button type="button" onClick={() => openMember(member)} className="shrink-0 font-semibold text-amber-900 underline">Manage</button>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="mt-3 text-sm text-slate-600">No blocked Basic members.</p>}
                  {!!health.blocked_basic_members_truncated && (
                    <p className="mt-2 text-xs text-slate-600">Showing 50; {health.blocked_basic_members_truncated} more require review.</p>
                  )}
                </section>
              )}
              <section className="rounded-xl border border-rose-200 bg-rose-50/50 p-4" aria-label="Payments needing attention">
                <h3 className="font-semibold text-rose-950">
                  Payments needing attention <span className="text-sm font-normal">({health.payment_attention_members_count ?? health.payment_attention_members?.length ?? 0})</span>
                </h3>
                <p className="mt-1 text-xs text-rose-900">Failed, halted, refunded, expired, or checkout pending over 30 minutes.</p>
                {health.payment_attention_members?.length ? (
                  <ul className="mt-3 divide-y divide-rose-200">
                    {health.payment_attention_members.map((member) => (
                      <li key={member.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-900">{member.name || member.email || member.id}</span>
                          <span className="block truncate text-xs text-slate-600">
                            {member.email ? `${member.email} · ` : ""}{member.payment_status?.replaceAll("_", " ")} · {PLAN_LABELS[member.plan] || "Basic"}
                          </span>
                        </span>
                        <button type="button" onClick={() => openMember(member)} className="shrink-0 font-semibold text-rose-900 underline">Review</button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-3 text-sm text-slate-600">No payment issues currently need attention.</p>}
                {!!health.payment_attention_members_truncated && (
                  <p className="mt-2 text-xs text-slate-600">Showing 50; {health.payment_attention_members_truncated} more require review.</p>
                )}
              </section>
            </div>
          )}
        </section>

        {memberFilterId && (
          <div className="mb-3 flex items-center justify-between rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
            <span>Showing the selected member only.</span>
            <button type="button" onClick={() => setMemberFilterId(null)} className="font-semibold underline">Show all members</button>
          </div>
        )}
        {loading && members.length === 0 ? (
          <p className="rounded-xl bg-white p-6 text-sm text-slate-500"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading members…</p>
        ) : members.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">No member accounts yet.</p>
        ) : (
          <div className="space-y-3">
            {members.filter((member) => !memberFilterId || member.id === memberFilterId).map((member) => {
              const kite = member.kite_account;
              return (
                <article id={`member-${encodeURIComponent(member.id)}`} key={member.id} className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[minmax(220px,1.4fr)_140px_160px_190px_100px] lg:items-center">
                  <div className="min-w-0">
                    <h2 className="truncate font-bold">{member.name || member.email || "Member"}</h2>
                    <p className="truncate text-sm text-slate-500">{member.email}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Joined {formatDate(member.created_at)}
                      {member.last_login_at ? ` · Last login ${formatDate(member.last_login_at, true)}` : ""}
                    </p>
                    <button type="button" onClick={() => toggleAudit(member.id)}
                      className="mt-1 text-xs font-semibold text-emerald-800 underline">
                      {auditMemberId === member.id ? "Hide audit history" : "View audit history"}
                    </button>
                    <p className="mt-1 text-xs text-slate-500">
                      {member.linked_kite_user_id
                        ? `Locked broker account: ${member.linked_kite_user_id}${kite?.valid_until ? ` · token valid to ${formatDate(kite.valid_until)}` : ""}`
                        : kite?.kite_user_id
                          ? `Connected broker account: ${kite.kite_user_id}${kite.valid_until ? ` · token valid to ${formatDate(kite.valid_until)}` : ""}`
                        : "No personal broker account linked"}
                    </p>
                    {member.subscription?.status && (
                      <p className="mt-1 text-xs text-slate-500">
                        Payment subscription: {member.subscription.status}
                        {member.subscription.status === "cancelled"
                          ? " · paid access ended immediately"
                          : member.subscription.current_end
                            ? ` · ends ${formatDate(member.subscription.current_end)}`
                            : ""}
                      </p>
                    )}
                  </div>

                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Plan
                    <select
                      className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm font-medium normal-case text-slate-900"
                      value={member.plan}
                      disabled={savingId === member.id}
                      onChange={(event) => save(member, {
                        plan: event.target.value,
                        admin_plan_override: event.target.value !== "normal",
                      })}
                    >
                      {PLANS.map((plan) => <option key={plan} value={plan}>{PLAN_LABELS[plan]}</option>)}
                    </select>
                  </label>

                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={!member.disabled}
                      disabled={savingId === member.id}
                      onChange={(event) => save(member, { disabled: !event.target.checked })}
                    />
                    Account enabled
                  </label>

                  <label className={`flex items-center gap-2 text-sm ${member.plan !== "pro" ? "text-slate-400" : "text-slate-700"}`}>
                    <input
                      type="checkbox"
                      checked={!!member.trade_cycle_persistence_enabled}
                      disabled={savingId === member.id || member.plan !== "pro"}
                      onChange={(event) => save(member, {
                        preferences: { trade_cycle_persistence_enabled: event.target.checked },
                      })}
                    />
                    Save Pro trade cycles
                  </label>

                  <div className="text-right">
                    {savingId === member.id
                      ? <Loader2 className="ml-auto h-4 w-4 animate-spin text-slate-400" />
                      : <span className={`rounded-full px-2 py-1 text-xs font-bold ${member.disabled ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{member.disabled ? "Suspended" : "Active"}</span>}
                  </div>
                  {auditMemberId === member.id && (
                    <div className="lg:col-span-5 rounded-lg bg-slate-50 p-3">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">Recent audit history</h3>
                      {auditLoading ? (
                        <p className="mt-2 text-xs text-slate-500">Loading audit history…</p>
                      ) : auditEvents.length === 0 ? (
                        <p className="mt-2 text-xs text-slate-500">No recorded subscription, access, or broker-credential changes.</p>
                      ) : (
                        <ul className="mt-2 space-y-2">
                          {auditEvents.map((event, index) => (
                            <li key={`${event.event_type}-${event.created_at}-${index}`} className="text-xs text-slate-700">
                              <span className="font-semibold">{auditLabel(event)}</span>
                              <span className="text-slate-500"> · {event.actor} · {formatDate(event.created_at, true)}</span>
                              {event.details && Object.keys(event.details).length > 0 && (
                                <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[10px] text-slate-500">
                                  {JSON.stringify(event.details)}
                                </pre>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
