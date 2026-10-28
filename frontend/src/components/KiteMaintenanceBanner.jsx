import { Wrench } from "lucide-react";
import { safeHttpUrl } from "@/lib/safeUrl";
import { brokerSafeText } from "@/lib/brokerCopy";

/**
 * Surface broker maintenance notices in the shared desk status banner —
 * when /status reports a broker_maintenance notice.
 */
export default function KiteMaintenanceBanner({ status }) {
  const maint = status?.broker_maintenance || status?.kite_maintenance;
  if (!maint?.active || !maint?.message) return null;

  const href = safeHttpUrl(maint.url);
  return (
    <div
      data-testid="kite-maintenance-banner"
      className="w-full border-b border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-50 px-4 py-2"
      role="status"
    >
      <div className="flex items-start sm:items-center gap-3 flex-wrap">
        <Wrench className="w-4 h-4 shrink-0 text-amber-700 dark:text-amber-300 mt-0.5 sm:mt-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-tight">Broker service maintenance</div>
          <div className="text-xs opacity-85 mt-0.5 leading-snug">{brokerSafeText(maint.message).slice(0, 220)}</div>
        </div>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-semibold underline underline-offset-2 shrink-0"
            data-testid="kite-maintenance-link"
          >
            Bulletin
          </a>
        ) : null}
      </div>
    </div>
  );
}
