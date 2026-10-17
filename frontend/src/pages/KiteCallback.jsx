import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { completeUserKiteSession } from "@/lib/api";
import { friendlyKiteConnectError } from "@/lib/kiteConnectError";
import { brokerSafeText } from "@/lib/brokerCopy";
import { toast } from "sonner";
import OiPulseLogo from "@/components/OiPulseLogo";
import { APP_NAME } from "@/lib/appVersion";

const CANONICAL_HOST = "striklenz.com";

function isLegacyKiteHost(host) {
  return String(host || "").toLowerCase().includes("aaisnamkeen");
}

/**
 * Kite Connect redirect target. Exchange request_token server-side
 * (never stored in the browser) then return to Positions.
 */
export default function KiteCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [msg, setMsg] = useState("Finishing your broker connection…");
  const [failed, setFailed] = useState(false);
  const exchangeStarted = useRef(false);

  useEffect(() => {
    if (typeof window !== "undefined" && isLegacyKiteHost(window.location.hostname)) {
      const dest = new URL(`https://${CANONICAL_HOST}/kite-callback`);
      dest.search = window.location.search;
      window.location.replace(dest.toString());
      return undefined;
    }
    const status = params.get("status");
    const token = params.get("request_token");
    if (status && status !== "success") {
      window.history.replaceState({}, "", window.location.pathname);
      setMsg("Broker sign-in was cancelled. Return to Positions and try again.");
      toast.error("Broker login cancelled");
      const t = setTimeout(() => navigate("/dashboard", { replace: true }), 1200);
      return () => clearTimeout(t);
    }
    if (!token) {
      setFailed(true);
      setMsg("The broker did not return a login token. Check the registered callback URL, then try connecting again.");
      return undefined;
    }
    if (exchangeStarted.current) return undefined;
    exchangeStarted.current = true;
    // The broker query token is one-use; keep it out of copied URLs and later history entries.
    window.history.replaceState({}, "", window.location.pathname);
    (async () => {
      try {
        const data = await completeUserKiteSession(token);
        toast.success(`Broker connected${data?.kite_user_id ? ` · ${data.kite_user_id}` : ""}`);
        navigate("/dashboard?kite=connected", { replace: true });
      } catch (e) {
        const detail = friendlyKiteConnectError(e?.response?.data?.detail || e.message || "Could not complete broker login");
        setFailed(true);
        setMsg(String(detail));
        toast.error(String(detail));
      }
    })();
  }, [params, navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">
      <OiPulseLogo className="h-12 w-12" />
      <div className="text-sm font-semibold text-slate-800">{APP_NAME}</div>
      <p className="text-[13px] text-slate-600 max-w-sm" data-testid="kite-callback-status">{brokerSafeText(msg)}</p>
      {failed && (
        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/dashboard", { replace: true })}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Back to dashboard
          </button>
          <button
            type="button"
            onClick={() => navigate("/dashboard?kite=connect", { replace: true })}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
          >
            Return to Positions
          </button>
        </div>
      )}
    </div>
  );
}
