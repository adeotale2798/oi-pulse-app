import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import BrowserMock from "@/components/landing/BrowserMock";

const SLIDES = [
  { id: "dashboard", label: "Market Dashboard", title: "Market Dashboard" },
  { id: "chain-nifty", label: "NIFTY Chain", title: "NIFTY · Option Chain" },
  { id: "chain-banknifty", label: "BANK NIFTY Chain", title: "BANK NIFTY · Option Chain" },
  { id: "chain-sensex", label: "SENSEX Chain", title: "SENSEX · Option Chain" },
  { id: "pressure", label: "Strike Pressure", title: "Strike Pressure" },
  { id: "global-markets", label: "Global Markets", title: "Global Markets" },
  { id: "straddle", label: "Straddle", title: "ATM Straddle" },
  { id: "events", label: "Market & Global Events", title: "Market & Global Events" },
  { id: "positions", label: "Positions", title: "Positions" },
];

export default function DemoSlides({ snap }) {
  const [i, setI] = useState(0);

  const slide = SLIDES[i];
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-center gap-2">
        {SLIDES.map((s, idx) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={idx === i}
            onClick={() => setI(idx)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${idx === i ? "slz-btn-primary" : "border border-slate-200 bg-white text-slate-600 hover:border-emerald-300"}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="mx-auto max-w-2xl">
        <AnimatePresence mode="wait">
          <motion.div
            key={slide.id}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -14, scale: 0.98 }}
            transition={{ duration: 0.4 }}
          >
            <BrowserMock id={slide.id} snap={snap} title={slide.title} />
          </motion.div>
        </AnimatePresence>
        <div className="mt-3 flex justify-center gap-1.5">
          {SLIDES.map((s, idx) => (
            <span key={s.id} className={`h-1.5 rounded-full transition-all ${idx === i ? "w-6 bg-emerald-500" : "w-1.5 bg-slate-300"}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
