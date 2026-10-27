import React from "react";
import { useReducedMotion } from "framer-motion";

const FILM_TRANSCRIPT = [
  "See the structure behind the move: open interest, strike activity and market context for NIFTY, BANKNIFTY and SENSEX.",
  "Basic starts with the shared OI desk, including OI Change, the option chain, Straddle, events and index risk. No broker connection is needed.",
  "Premium adds personal OI and event alerts, Market Intel and Global Markets while continuing to use the shared OI feed.",
  "Pro adds private broker-connected Positions, a member journal, a neutral risk summary and Desk AI market context that does not analyze positions.",
  "Start with Basic, add Premium alerts and context, or choose Pro for a private workspace.",
];

const PLAN_STEPS = [
  {
    id: "basic",
    label: "Basic",
    detail: "Read the shared OI desk. No broker setup required.",
  },
  {
    id: "premium",
    label: "Premium",
    detail: "Add personal OI and event alerts, Market Intel and Global Markets.",
  },
  {
    id: "pro",
    label: "Pro",
    detail: "Connect your broker for private Positions, a journal, a neutral risk summary and market-context Desk AI.",
  },
];

export default function MotionFilm({ copy }) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="slz-film-layout mt-8" data-testid="landing-motion-film">
      <figure className="slz-film-frame">
        <video
          className="slz-film-video"
          src="/striklenz-overview.mp4"
          poster="/striklenz-overview-poster.jpg"
          autoPlay={!prefersReducedMotion}
          muted
          loop
          playsInline
          controls
          preload="metadata"
          aria-label="A silent motion-graphic overview of StrikLenz Basic, Premium and Pro"
        >
          Your browser does not support embedded video. Read the overview beside this film.
        </video>
        <figcaption className="slz-film-caption">
          Illustrative interface and sample visuals; not live market data.
        </figcaption>
      </figure>

      <div className="slz-film-details">
        <span className="slz-chip w-fit bg-emerald-50 text-emerald-800">
          {copy.film_eyebrow}
        </span>
        <h3 className="text-xl font-bold tracking-tight text-slate-900">
          {copy.film_title}
        </h3>
        <p className="text-sm leading-6 text-slate-600">
          {copy.film_description}
        </p>
        <ol className="slz-film-plan-list" aria-label="What each plan adds">
          {PLAN_STEPS.map((step, index) => (
            <li className="slz-film-plan-step" key={step.id}>
              <span className="slz-film-step-number" aria-hidden="true">
                0{index + 1}
              </span>
              <div>
                <h4>{step.label}</h4>
                <p>{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <details className="slz-film-transcript">
          <summary>Read the film transcript</summary>
          <ol>
            {FILM_TRANSCRIPT.map((line, index) => (
              <li key={line}>
                <span>0{index + 1}</span> {line}
              </li>
            ))}
          </ol>
        </details>
      </div>
    </div>
  );
}
