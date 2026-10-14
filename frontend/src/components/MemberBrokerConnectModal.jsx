import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, KeyRound, Loader2, LogOut, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  completeUserKiteSession,
  deleteUserKiteCredentials,
  disconnectUserKite,
  saveUserKiteCredentials,
  userKiteLoginUrl,
  userKiteStatus,
} from "@/lib/api";
import { safeHttpUrl } from "@/lib/safeUrl";

function brokerError(error, fallback) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string" && detail && !/\b(?:zerodha|kite)\b/i.test(detail)) return detail;
  if (error?.response?.status === 400) {
    return "The broker did not accept this connection. Check your app credentials and request token, then try again.";
  }
  return fallback;
}

function formatSavedAt(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    });
}

export default function MemberBrokerConnectModal({ open, onOpenChange, onConnected, onCredentialsSaved }) {
  const [status, setStatus] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [requestToken, setRequestToken] = useState("");
  const [login, setLogin] = useState(null);
  const [editingCredentials, setEditingCredentials] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [deletingCredentials, setDeletingCredentials] = useState(false);
  const onConnectedRef = useRef(onConnected);
  const onCredentialsSavedRef = useRef(onCredentialsSaved);
  const connectionHandledRef = useRef(false);

  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  useEffect(() => {
    onCredentialsSavedRef.current = onCredentialsSaved;
  }, [onCredentialsSaved]);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await userKiteStatus());
    } catch (error) {
      toast.error(brokerError(error, "Could not load your broker connection status"));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setApiKey("");
    setApiSecret("");
    setRequestToken("");
    setLogin(null);
    setEditingCredentials(false);
    connectionHandledRef.current = false;
    refreshStatus();
  }, [open, refreshStatus]);

  useEffect(() => {
    if (!open || !status?.credentials_configured || status.connected) return undefined;
    const interval = window.setInterval(async () => {
      try {
        const next = await userKiteStatus();
        setStatus(next);
        if (next.connected && !connectionHandledRef.current) {
          connectionHandledRef.current = true;
          toast.success("Broker account connected");
          onConnectedRef.current?.(next);
          onOpenChange(false);
        }
      } catch {
        // Keep the manual token option available during temporary status failures.
      }
    }, 5000);
    return () => window.clearInterval(interval);
  }, [open, status?.credentials_configured, status?.connected, onOpenChange]);

  const saveCredentials = async (event) => {
    event.preventDefault();
    if (!apiKey.trim() || !apiSecret.trim()) {
      toast.error("Enter both your API key and API secret.");
      return;
    }
    setSaving(true);
    try {
      await saveUserKiteCredentials(apiKey.trim(), apiSecret.trim());
      setApiKey("");
      setApiSecret("");
      setLogin(null);
      await refreshStatus();
      await onCredentialsSavedRef.current?.();
      setEditingCredentials(false);
      toast.success("Broker app credentials saved securely");
    } catch (error) {
      toast.error(brokerError(error, "Could not save broker app credentials"));
    } finally {
      setSaving(false);
    }
  };

  const signOutOfBroker = async () => {
    setDisconnecting(true);
    try {
      await disconnectUserKite();
      setStatus((current) => ({
        ...current,
        connected: false,
        expired: false,
        kite_user_id: null,
        valid_until: null,
      }));
      await onCredentialsSavedRef.current?.();
      toast.success("Signed out of today's broker session; your saved app credentials are kept");
    } catch (error) {
      toast.error(brokerError(error, "Could not sign out of the broker session"));
    } finally {
      setDisconnecting(false);
    }
  };

  const removeCredentials = async () => {
    if (!window.confirm("Permanently remove your saved encrypted broker API key and secret? Your private journal is kept.")) return;
    setDeletingCredentials(true);
    try {
      await deleteUserKiteCredentials();
      setStatus((current) => ({
        ...current,
        credentials_configured: false,
        connected: false,
        expired: false,
        kite_user_id: null,
        valid_until: null,
        api_key_hint: null,
        credentials_updated_at: null,
      }));
      setLogin(null);
      await onCredentialsSavedRef.current?.();
      toast.success("Saved broker credentials permanently removed");
    } catch (error) {
      toast.error(brokerError(error, "Could not remove saved broker credentials"));
    } finally {
      setDeletingCredentials(false);
    }
  };

  const openBrokerLogin = async () => {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setLoading(true);
    try {
      const data = await userKiteLoginUrl();
      const href = safeHttpUrl(data?.login_url);
      if (!href) throw new Error("The broker login link was not valid.");
      setLogin({ href, redirectUri: data.redirect_uri });
      if (popup) {
        popup.location.href = href;
      } else {
        toast.message("Allow pop-ups to open the broker login, or use the generated link below.");
      }
    } catch (error) {
      popup?.close();
      toast.error(brokerError(error, "Could not create the broker login link"));
    } finally {
      setLoading(false);
    }
  };

  const connectWithRequestToken = async (event) => {
    event.preventDefault();
    const rawToken = requestToken.trim();
    let token = rawToken;
    if (/^https?:\/\//i.test(rawToken)) {
      try {
        token = new URL(rawToken).searchParams.get("request_token") || "";
      } catch {
        token = "";
      }
    } else if (/^request_token=/i.test(rawToken)) {
      token = new URLSearchParams(rawToken).get("request_token") || "";
    }
    if (!token) {
      toast.error("Paste a request token or a full broker redirect URL containing request_token.");
      return;
    }
    setConnecting(true);
    try {
      const result = await completeUserKiteSession(token);
      setRequestToken("");
      setStatus((current) => ({ ...current, ...result, connected: true, expired: false }));
      toast.success("Broker account connected");
      onConnected?.(result);
      onOpenChange(false);
    } catch (error) {
      toast.error(brokerError(error, "Could not complete broker connection"));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Connect your broker account</DialogTitle>
          <DialogDescription>
            Save your app API key and secret once. For each trading day, add a fresh request token to load your private Positions.
          </DialogDescription>
        </DialogHeader>

        <div className={`rounded-xl border p-3 text-sm ${
          status?.connected
            ? "border-emerald-200 bg-emerald-50 text-emerald-950"
            : status?.expired
              ? "border-amber-300 bg-amber-50 text-amber-950"
              : "border-slate-200 bg-slate-50 text-slate-800"
        }`}>
          <div className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            {status?.connected
              ? `Today's broker session is live${status.kite_user_id ? ` · ${status.kite_user_id}` : ""}`
              : status?.expired
                ? "Today's broker session is stale"
                : status?.credentials_configured
                  ? "Saved app credentials ready for today's request token"
                  : "Set up your broker app credentials"}
          </div>
          <p className="mt-1 text-xs">
            {status?.expired
              ? "Your API key and secret are still saved encrypted. Add a new request token below; you do not need to enter those credentials again."
              : "Your positions are private to your account. Shared OI charts continue to use the publisher market feed."}
          </p>
          {status?.valid_until && status?.connected && (
            <p className="mt-1 text-xs">Session valid until {formatSavedAt(status.valid_until)} IST.</p>
          )}
        </div>
        {status?.linked_kite_user_id && (
          <p role="status" className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-950">
            This Google account is permanently linked to Zerodha ID <b>{status.linked_kite_user_id}</b>. Replacing app credentials or daily tokens will not allow a different Zerodha account to connect.
          </p>
        )}

        <form onSubmit={saveCredentials} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <KeyRound className="h-4 w-4 text-emerald-700" />
              Broker app credentials
            </div>
            {status?.credentials_configured && !editingCredentials && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditingCredentials(true)}>
                Replace credentials
              </Button>
            )}
            {status?.credentials_configured && !editingCredentials && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={deletingCredentials}
                onClick={removeCredentials}
                className="text-rose-700"
              >
                {deletingCredentials ? <Loader2 className="animate-spin" /> : <Trash2 />}
                Remove saved credentials
              </Button>
            )}
          </div>
          {status?.credentials_configured && !editingCredentials ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {status.member_email && (
                <p className="text-xs text-slate-600 sm:col-span-2">
                  Saved for {status.member_name || "your account"} · {status.member_email}
                </p>
              )}
              <div className="space-y-1">
                <Label htmlFor="member-broker-api-key-saved">API key · saved encrypted</Label>
                <Input id="member-broker-api-key-saved" readOnly value={`${status.api_key_hint || "••••••••"} — enter to replace`} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="member-broker-api-secret-saved">API secret · saved encrypted</Label>
                <Input id="member-broker-api-secret-saved" readOnly value="•••••••••••• — enter to replace" />
              </div>
              {formatSavedAt(status.credentials_updated_at) && (
                <p className="text-xs text-slate-500 sm:col-span-2">
                  App credentials last updated {formatSavedAt(status.credentials_updated_at)} IST.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="member-broker-api-key">API key</Label>
                  <Input
                    id="member-broker-api-key"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="Enter your API key"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="member-broker-api-secret">API secret</Label>
                  <Input
                    id="member-broker-api-secret"
                    type="password"
                    autoComplete="new-password"
                    value={apiSecret}
                    onChange={(event) => setApiSecret(event.target.value)}
                    placeholder="Enter your API secret"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="outline" disabled={saving || !apiKey.trim() || !apiSecret.trim()}>
                  {saving && <Loader2 className="animate-spin" />}
                  {status?.credentials_configured ? "Save replacement credentials" : "Save credentials securely"}
                </Button>
                {status?.credentials_configured && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => {
                      setApiKey("");
                      setApiSecret("");
                      setEditingCredentials(false);
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
              {status?.credentials_configured && (
                <p className="text-xs text-amber-800">
                  Replacing these credentials signs out the current session. You will need a fresh request token.
                </p>
              )}
            </>
          )}
        </form>

        <div className="space-y-3 border-t border-slate-200 pt-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Get today's request token</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Create a fresh token each trading day. Open the login link below; if your callback URL is registered, it returns here and connects automatically.
            </p>
          </div>
          <Button type="button" onClick={openBrokerLogin} disabled={loading || !status?.credentials_configured || editingCredentials}>
            {loading ? <Loader2 className="animate-spin" /> : <ExternalLink />}
            Generate today's request token
          </Button>
          {!status?.credentials_configured && (
            <p className="text-xs text-amber-700">Save your API key and secret first to generate the broker login link.</p>
          )}
          {login?.redirectUri && (
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <p>Register this exact callback URL in your broker developer app for automatic return:</p>
              <code className="mt-1 block break-all select-all font-mono">{login.redirectUri}</code>
              <a href={login.href} target="_blank" rel="noreferrer" className="mt-2 inline-flex font-semibold text-emerald-800 underline">
                Open generated login link
              </a>
            </div>
          )}
        </div>

        <form onSubmit={connectWithRequestToken} className="space-y-3 border-t border-slate-200 pt-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Paste request token manually</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              If automatic return is unavailable, paste the request_token or the full broker redirect URL here. The token expires quickly and can be used once.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Request token"
              autoComplete="off"
              value={requestToken}
              onChange={(event) => setRequestToken(event.target.value)}
              placeholder="Paste request_token or the full broker URL"
              className="font-mono"
            />
            <Button type="submit" disabled={connecting || !requestToken.trim()}>
              {connecting && <Loader2 className="animate-spin" />}
              Save &amp; Go Live
            </Button>
          </div>
        </form>
        {status?.connected && (
          <div className="flex justify-end border-t border-slate-200 pt-3">
            <Button
              type="button"
              variant="outline"
              disabled={disconnecting}
              onClick={signOutOfBroker}
              className="text-rose-700"
            >
              {disconnecting ? <Loader2 className="animate-spin" /> : <LogOut />}
              Sign out of broker
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
