import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import AdminDialogNavigation from "@/components/AdminDialogNavigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { UploadCloud, AlertTriangle, CheckCircle2, FileText, ExternalLink, RefreshCw } from "lucide-react";
import { API, api } from "@/lib/api";
import { toast } from "sonner";
import {
  isUploadStale,
  formatUploadAge,
  uploadAgeDays,
  uploadFreshnessTimestamp,
} from "@/lib/uploadFreshness";

const UPLOAD_TYPES = [
  {
    value: "nifty50",
    label: "NIFTY 50 Constituents",
    endpoint: "/admin/upload/constituents",
    sourceUrl: "https://www.nseindia.com/static/products-services/indices-nifty50-index",
    sourceTitle: "Nifty 50 — download constituents",
    sourceHost: "nseindia.com",
  },
  {
    value: "banknifty",
    label: "Bank Nifty Constituents",
    endpoint: "/admin/upload/constituents",
    sourceUrl: "https://www.niftyindices.com/indices/equity/sectoral-indices/nifty-bank",
    sourceTitle: "Bank Nifty — download constituents",
    sourceHost: "niftyindices.com",
  },
  {
    value: "sensex",
    label: "Sensex Constituents",
    endpoint: "/admin/upload/constituents",
    sourceUrl: "https://www.bseindices.com/constituents/code/16",
    sourceTitle: "Sensex — download constituents",
    sourceHost: "bseindices.com",
  },
  {
    value: "events",
    label: "3 Month NSE Event Calendar",
    endpoint: "/admin/upload/events",
    sourceUrl: "https://www.nseindia.com/companies-listing/corporate-filings-event-calendar",
    sourceTitle: "NSE Event Calendar — download CSV/XLSX",
    sourceHost: "nseindia.com",
  },
  {
    value: "holidays",
    label: "NSE holiday circular",
    endpoint: "/admin/upload/holidays",
    sourceUrl: "https://www.nseindia.com/resources/exchange-communication-holidays",
    sourceTitle: "NSE trading holidays — official circular",
    sourceHost: "nseindia.com",
    formatHint:
      "CSV/XLSX. Required: DATE, NAME. Optional: SESSION, OPEN, CLOSE.\nDATE = YYYY-MM-DD (or DD-MM-YYYY). SESSION blank = full holiday; SESSION=muhurat needs OPEN/CLOSE as HH:MM IST.\nYears in this file replace that year’s built-in list (other years stay).\n\nDATE,NAME,SESSION,OPEN,CLOSE\n2027-01-26,Republic Day,,,\n2027-11-08,Diwali Laxmi Pujan,muhurat,13:30,19:15",
  },
];

function formatLastUploaded(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

function formatLastUpdated(iso) {
  if (!iso) return "Not updated yet";
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "Not updated yet";
    return date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }) + " IST";
  } catch {
    return "Not updated yet";
  }
}

/**
 * UploadModal — admin-only. Upload constituents or event calendar.
 */
export default function UploadModal({ open, onOpenChange, onUploaded }) {
  const [uploadType, setUploadType] = useState("nifty50");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errors, setErrors] = useState([]);
  const [success, setSuccess] = useState(null);
  const [uploadMeta, setUploadMeta] = useState(null);
  const [reusing, setReusing] = useState(false);
  const [refreshingEvents, setRefreshingEvents] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  const reset = () => {
    setFile(null); setBusy(false); setProgress(0); setErrors([]); setSuccess(null); setRefreshError("");
  };

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    api
      .get("/upload/meta")
      .then((r) => {
        if (!cancelled) setUploadMeta(r.data || null);
      })
      .catch(() => {
        if (!cancelled) setUploadMeta(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, success]);

  const handleChange = (v) => {
    setUploadType(v);
    setErrors([]); setSuccess(null); setRefreshError("");
  };

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    setFile(f || null);
    setErrors([]); setSuccess(null); setRefreshError("");
  };

  const selected = UPLOAD_TYPES.find((t) => t.value === uploadType);
  const typeMeta = uploadMeta?.[uploadType] || {};
  const lastDate = formatLastUploaded(typeMeta.uploaded_at);
  const freshnessAt = uploadFreshnessTimestamp(typeMeta);
  const confirmedDate = typeMeta.confirmed_at !== typeMeta.uploaded_at
    ? formatLastUploaded(typeMeta.confirmed_at)
    : null;
  const age = uploadAgeDays(freshnessAt);
  const stale = isUploadStale(uploadType, freshnessAt);

  const reuseExisting = async () => {
    setReusing(true);
    try {
      const { data } = await api.post(`/admin/upload/reuse/${uploadType}`);
      setUploadMeta((current) => ({
        ...current,
        [uploadType]: {
          ...current?.[uploadType],
          confirmed_at: data.confirmed_at,
          row_count: data.row_count,
        },
      }));
      toast.success(`${selected.label}: existing data confirmed; no rows changed.`);
      if (typeof onUploaded === "function") onUploaded(uploadType, data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || error?.message || "Could not reuse existing data.");
    } finally {
      setReusing(false);
    }
  };

  const refreshEventsFromNse = async () => {
    setRefreshingEvents(true);
    setErrors([]);
    setSuccess(null);
    setRefreshError("");
    try {
      const { data } = await api.post("/admin/upload/events/refresh");
      const uploadedAt = data.uploaded_at || new Date().toISOString();
      const sourceFilename = data.source_filename || "NSE Download: Equity events (Next 3 Months)";
      setSuccess({
        label: selected.label,
        rows: data.rows_saved,
        filename: sourceFilename,
        uploadedAt,
      });
      setUploadMeta((current) => ({
        ...current,
        events: {
          ...current?.events,
          uploaded_at: uploadedAt,
          confirmed_at: uploadedAt,
          row_count: data.rows_saved,
          source_filename: sourceFilename,
        },
      }));
      toast.success(`${selected.label} updated from NSE — ${data.rows_saved} events saved.`);
      if (typeof onUploaded === "function") onUploaded("events", data);
    } catch (error) {
      const message = error?.response?.data?.detail || error?.message || "Could not fetch events from NSE.";
      setRefreshError(message);
      toast.error(message);
    } finally {
      setRefreshingEvents(false);
    }
  };

  const submit = async () => {
    if (!file) { toast.error("Please select a CSV or XLSX file first."); return; }
    const meta = selected;
    if (!meta) return;
    setBusy(true); setProgress(0); setErrors([]); setSuccess(null); setRefreshError("");

    const fd = new FormData();
    fd.append("file", file);
    if (meta.endpoint.endsWith("/constituents")) {
      fd.append("upload_type", uploadType);
    }

    try {
      const token = sessionStorage.getItem("oi_admin_token") || "";
      const url = `${API}${meta.endpoint}`;
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);
      if (token) xhr.setRequestHeader("X-Admin-Token", token);
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
      };
      const result = await new Promise((resolve, reject) => {
        xhr.onload = () => {
          try {
            const json = JSON.parse(xhr.responseText || "{}");
            if (xhr.status >= 200 && xhr.status < 300) resolve(json);
            else reject(json?.detail || `HTTP ${xhr.status}`);
          } catch (_) {
            reject(`Invalid response (${xhr.status})`);
          }
        };
        xhr.onerror = () => reject("Network error");
        xhr.send(fd);
      });

      if (result?.ok === false && Array.isArray(result.errors) && result.errors.length) {
        setErrors(result.errors);
        toast.error(`Upload failed: ${result.errors.length} validation error(s)`);
      } else if (result?.ok) {
        const uploadedAt = result.uploaded_at || new Date().toISOString();
        const sourceFilename = result.filename || file.name;
        setSuccess({
          label: meta.label,
          rows: result.rows_saved,
          filename: sourceFilename,
          uploadedAt,
        });
        if (uploadType === "events") {
          setUploadMeta((current) => ({
            ...current,
            events: {
              ...current?.events,
              uploaded_at: uploadedAt,
              confirmed_at: uploadedAt,
              row_count: result.rows_saved,
              source_filename: sourceFilename,
            },
          }));
        }
        toast.success(`${meta.label} uploaded — ${result.rows_saved} rows saved.`);
        if (typeof onUploaded === "function") onUploaded(uploadType, result);
      } else {
        toast.error("Unexpected response from server.");
      }
    } catch (e) {
      const msg = typeof e === "string" ? e : (e?.message || "Upload failed");
      toast.error(msg);
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent
        data-testid="upload-modal"
        className="sm:max-w-md dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UploadCloud className="w-5 h-5" />
            Upload Data
            <AdminDialogNavigation />
          </DialogTitle>
          <DialogDescription className="text-xs">
            Upload a CSV or XLSX file. If validation passes with no errors, existing data for this category is removed and replaced by the new file.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <Label className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Upload Type
              </Label>
              <span
                data-testid="upload-last-stamp"
                className={`text-[11px] font-mono-data ${
                  stale
                    ? "text-amber-700 dark:text-amber-300"
                    : "text-slate-500 dark:text-slate-400"
                }`}
                title={
                  typeMeta.source_filename
                    ? `${typeMeta.source_filename}${age != null ? ` · ${formatUploadAge(age, !freshnessAt)}` : ""}`
                    : undefined
                }
              >
                {lastDate
                  ? `Last uploaded on ${lastDate}${stale ? " · stale" : ""}`
                  : "Last uploaded on — never"}
              </span>
            </div>
            <select
              data-testid="upload-type"
              value={uploadType}
              onChange={(e) => handleChange(e.target.value)}
              disabled={busy || reusing || refreshingEvents}
              className="mt-1 w-full text-sm border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-md px-2 py-2"
            >
              {UPLOAD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            {confirmedDate && (
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Existing data confirmed on {confirmedDate}; original upload {lastDate || "date unavailable"}.
              </p>
            )}
            {stale && typeMeta.row_count > 0 && (
              <Button
                type="button"
                data-testid="upload-reuse-current"
                variant="outline"
                className="mt-2 w-full rounded-sm"
                onClick={reuseExisting}
                disabled={busy || reusing || refreshingEvents}
              >
                {reusing ? "Confirming…" : "Reuse current data"}
              </Button>
            )}
          </div>

          {selected?.sourceUrl && (
            <a
              data-testid="upload-source-link"
              href={selected.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5 text-left transition hover:border-sky-400 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/40 dark:hover:bg-sky-900/50"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sky-600 text-white">
                <ExternalLink className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-sky-900 dark:text-sky-100">
                  {selected.sourceTitle}
                </div>
                <div className="truncate text-[11px] text-sky-700/80 dark:text-sky-300/80">
                  Open {selected.sourceHost} in a new tab to download the file
                </div>
              </div>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
            </a>
          )}

          {uploadType === "events" && (
            <div className="space-y-2">
              <div
                data-testid="nse-event-refresh-status"
                className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300"
              >
                <div className="font-semibold text-slate-700 dark:text-slate-200">
                  Last successful calendar update: {formatLastUpdated(typeMeta.uploaded_at)}
                </div>
                {typeMeta.row_count != null && (
                  <div>{typeMeta.row_count} event rows · source: {typeMeta.source_filename || "manual upload"}</div>
                )}
              </div>
              <Button
                type="button"
                data-testid="upload-refresh-events"
                variant="outline"
                className="w-full justify-center"
                onClick={refreshEventsFromNse}
                disabled={busy || reusing || refreshingEvents}
              >
                <RefreshCw className={`h-4 w-4 ${refreshingEvents ? "animate-spin" : ""}`} />
                {refreshingEvents ? "Fetching latest events from NSE…" : "Fetch latest events from NSE"}
              </Button>
              {refreshError && (
                <div
                  role="alert"
                  data-testid="nse-event-refresh-error"
                  className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
                >
                  <span className="font-semibold">NSE fetch failed.</span> The saved event calendar was not changed. Download the CSV above and upload it manually below.
                  <span className="block mt-0.5">{refreshError}</span>
                </div>
              )}
              {!refreshError && (
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                  If NSE is unavailable, download its CSV above and upload it manually below.
                </p>
              )}
            </div>
          )}

          {selected?.formatHint && (
            <pre
              data-testid="upload-format-hint"
              className="whitespace-pre-wrap text-[11px] leading-snug rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 font-mono"
            >
              {selected.formatHint}
            </pre>
          )}

          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {uploadType === "events" ? "Manual file upload" : "File"}
            </Label>
            <input
              data-testid="upload-file"
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFile}
              disabled={busy || reusing || refreshingEvents}
              className="mt-1 block w-full text-xs text-slate-600 dark:text-slate-300 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-slate-100 file:text-slate-700 dark:file:bg-slate-700 dark:file:text-slate-100 hover:file:bg-slate-200"
            />
            {file && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1">
                <FileText className="w-3 h-3" />
                {file.name} — {(file.size / 1024).toFixed(1)} KB
              </p>
            )}
          </div>

          {busy && (
            <div className="w-full">
              <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-500 mt-1">Uploading… {progress}%</p>
            </div>
          )}

          {errors.length > 0 && (
            <div
              data-testid="upload-errors"
              className="border border-rose-300 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-800 rounded-md p-2 max-h-48 overflow-auto"
            >
              <div className="flex items-center gap-1 text-rose-700 dark:text-rose-300 text-xs font-semibold mb-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                {errors.length} validation error{errors.length > 1 ? "s" : ""}
              </div>
              <ul className="text-[11px] text-rose-700 dark:text-rose-200 space-y-0.5 list-disc list-inside">
                {errors.slice(0, 40).map((e, i) => (<li key={i}>{e}</li>))}
                {errors.length > 40 && (<li>… and {errors.length - 40} more</li>)}
              </ul>
            </div>
          )}

          {success && (
            <div
              data-testid="upload-success"
              className="border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 rounded-md p-2"
            >
              <div className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {success.label} — {success.rows} rows saved
              </div>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-200">
                Source: {success.filename}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <Button
            variant="outline"
            className="rounded-sm"
            onClick={() => onOpenChange(false)}
            disabled={busy || reusing || refreshingEvents}
          >
            Close
          </Button>
          <Button
            data-testid="upload-save"
            className="rounded-sm bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={submit}
            disabled={busy || reusing || refreshingEvents || !file}
          >
            <UploadCloud className="w-4 h-4 mr-1.5" />
            {busy ? "Uploading…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
