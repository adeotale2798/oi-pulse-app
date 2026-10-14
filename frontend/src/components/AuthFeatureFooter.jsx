import { Activity, BarChart3, BrainCircuit, CalendarDays, Globe2, Newspaper, ShieldCheck } from "lucide-react";

const features = [
  [Activity, "Live OI Pulse", "Track market flows"],
  [BarChart3, "Market Insights", "Review market context"],
  [ShieldCheck, "Risk Lens", "Track relevant factors"],
  [BrainCircuit, "Desk AI", "Evidence-aware market context"],
  [Globe2, "Global Market", "Track world indices"],
  [Newspaper, "World Market News", "Stay market-aware"],
  [BarChart3, "Straddle", "Read premium structure"],
  [CalendarDays, "Events", "Plan around the calendar"],
];

export default function AuthFeatureFooter({ brand = true, version = "", compact = false }) {
  return (
    <footer className={`oi-auth-footer${compact ? " oi-auth-footer-compact" : ""}`}>
      <div className="oi-auth-footer-features">
        {features.map(([Icon, title, body]) => <div key={title}><Icon /><span><b>{title}</b><small>{body}</small></span></div>)}
      </div>
      {brand ? <div className="oi-auth-footer-brand"><b>StrikLenz</b><span>Live market intelligence.</span>{version ? <small className="oi-auth-footer-version">{version}</small> : null}</div> : null}
    </footer>
  );
}
