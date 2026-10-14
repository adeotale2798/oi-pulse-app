import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import BrowserMock from "@/components/landing/BrowserMock";

const SLIDES = [
  { id: "straddle", label: "Straddle", title: "ATM Straddle" },
  { id: "pressure", label: "Strike Pressure", title: "Strike Pressure" },
  { id: "journal", label: "Trade Journal", title: "Private Trade Journal", chip: false },
  { id: "oi", label: "OI Change", title: "SENSEX · OI Change" },
  { id: "positions", label: "Positions", title: "Live Positions", chip: false },
  { id: "global-markets", label: "Global Markets", title: "Global Markets" },
  { id: "events", label: "Market & Global Events", title: "Market & Global Events" },
  { id: "market-intel", label: "Market Intel", title: "Market Intelligence" },
  { id: "desk-ai", label: "Desk AI", title: "Desk AI · Market Briefing", chip: false },
];

export default function ShotTour({ snap }) {
  const [i, setI] = useState(0);

  const s = SLIDES[i];
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-center gap-2">
        {SLIDES.map((sl, idx) => (
          <button key={sl.id} type="button" aria-pressed={idx === i} onClick={() => setI(idx)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${idx === i ? "slz-btn-primary" : "border border-slate-200 bg-white text-slate-600 hover:border-emerald-300"}`}>
            {sl.label}
          </button>
        ))}
      </div>
      <div className="mx-auto max-w-2xl">
        <AnimatePresence mode="wait">
          <motion.div key={s.id} initial={{ opacity: 0, y: 16, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12, scale: 0.985 }} transition={{ duration: 0.4 }}>
            <BrowserMock id={s.id} snap={snap} title={s.title} showChip={s.chip !== false} />
          </motion.div>
        </AnimatePresence>
        <div className="mt-3 flex justify-center gap-1.5">
          {SLIDES.map((sl, idx) => (
            <span key={sl.id} className={`h-1.5 rounded-full transition-all ${idx === i ? "w-6 bg-emerald-500" : "w-1.5 bg-slate-300"}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
