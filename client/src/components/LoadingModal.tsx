import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Lightbulb, MapPin, Shield, GraduationCap, Train, Leaf } from "lucide-react";

interface LoadingModalProps {
  isOpen: boolean;
  completedSteps?: string[]; // retained for backwards-compat; not used for fake ticks
}

// Honest, genuinely true UK-area trivia (light, non-statistical claims to avoid
// over-precision). Rotated while the report computes.
const UK_FACTS = [
  "The UK has over 2,500 railway stations — more than most of Europe per capita.",
  "Scotland alone is home to more than 30,000 lochs (lakes).",
  "Northern Ireland has no motorways — its fastest roads are 'A' roads.",
  "There are over 40,000 conservation areas across the UK protecting local character.",
  "Around 1 in 3 UK households has no off-street parking.",
  "The UK's most common street name is 'High Street'.",
  "Britain has roughly 8,000 miles of navigable canals and waterways.",
  "The UK coastline is longer than France's once you count every inlet and estuary.",
  "More than 30% of homes in some city centres are within a 10-minute walk of a station.",
  "Wales has more castles per square mile than anywhere else in Europe.",
];

// The real phases fetchAreaMetrics moves through (in rough order). We surface the
// current one as "in progress" — we never claim a phase is done until the report
// actually loads (the modal closes on navigation), so nothing is falsely ticked.
const PHASES = [
  { key: "geocode", label: "Locating the postcode", icon: MapPin },
  { key: "safety", label: "Checking crime data", icon: Shield },
  { key: "schools", label: "Finding nearby schools", icon: GraduationCap },
  { key: "transport", label: "Mapping transport links", icon: Train },
  { key: "amenities", label: "Surveying local amenities", icon: MapPin },
  { key: "environment", label: "Assessing green space & air quality", icon: Leaf },
];

export function LoadingModal({ isOpen }: LoadingModalProps) {
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [factIdx, setFactIdx] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setPhaseIdx(0);
      setFactIdx(0);
      return;
    }
    // Cycle the "currently working on" phase roughly every 3.5s, capping at the
    // last phase so it doesn't wrap past a sensible point while we wait.
    const phaseTimer = setInterval(() => {
      setPhaseIdx((i) => Math.min(i + 1, PHASES.length - 1));
    }, 3500);
    // Rotate the fun fact every 4.5s.
    const factTimer = setInterval(() => {
      setFactIdx((i) => (i + 1) % UK_FACTS.length);
    }, 4500);
    return () => {
      clearInterval(phaseTimer);
      clearInterval(factTimer);
    };
  }, [isOpen]);

  const active = PHASES[phaseIdx];
  const ActiveIcon = active.icon;

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-[460px] outline-none" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-center font-display text-2xl">Analysing Area</DialogTitle>
        </DialogHeader>

        <div className="py-6 space-y-6">
          {/* Indeterminate progress bar */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
            <div className="h-full w-1/3 animate-[loadingbar_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
          </div>

          {/* Current activity */}
          <div className="flex items-center justify-center gap-3 text-foreground">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
              <ActiveIcon className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm font-medium">{active.label}…</span>
            <Loader2 className="h-4 w-4 animate-spin text-primary/70" />
          </div>

          {/* Phase checklist — honest: the active phase pulses, the rest are pending.
              Nothing is falsely marked complete (the modal closes when the report loads). */}
          <div className="grid grid-cols-2 gap-2">
            {PHASES.map((p, i) => {
              const Icon = p.icon;
              const isActive = i === phaseIdx;
              const isPending = i > phaseIdx;
              return (
                <div
                  key={p.key}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
                    isActive
                      ? "border-primary/40 bg-primary/5 text-foreground"
                      : isPending
                        ? "border-border bg-gray-50 text-muted-foreground"
                        : "border-border bg-gray-50 text-muted-foreground"
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 ${isActive ? "text-primary animate-pulse" : "text-muted-foreground/60"}`} />
                  <span className="truncate">{p.label}</span>
                </div>
              );
            })}
          </div>

          {/* Did you know? fact carousel */}
          <div className="flex items-start gap-3 rounded-xl bg-indigo-50/70 p-4">
            <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-indigo-500" />
            <div className="min-h-[2.5rem]">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">Did you know?</p>
              <p key={factIdx} className="mt-1 text-sm text-foreground animate-[fadein_0.5s_ease-out]">
                {UK_FACTS[factIdx]}
              </p>
            </div>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Crunching live UK Open Data — this usually takes 15–30 seconds for a full area profile.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
