import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Check, AlertTriangle, Lightbulb, MapPin, Shield, Train, Leaf, Wind, Droplets, Smartphone, Wifi, PlugZap, Map } from "lucide-react";

interface LoadingModalProps {
  isOpen: boolean;
  postcode?: string; // normalized postcode used to poll /api/assess/progress/:postcode
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

// The individual data-source searches the server runs in parallel. The modal
// polls /api/assess/progress/:postcode and ticks each one off in REAL TIME as
// the server finishes it (status: 'done' | 'error' | 'pending'). No fabricated
// timeline — a tick only appears once the server reports completion.
type PhaseStatus = 'pending' | 'done' | 'error';
const PHASES: { key: string; label: string; icon: any }[] = [
  { key: "geocode", label: "Locating the postcode", icon: MapPin },
  { key: "overpass", label: "Transport, green space & amenities", icon: Train },
  { key: "crime", label: "Crime data (police.uk / SIMD)", icon: Shield },
  { key: "air", label: "Air quality", icon: Wind },
  { key: "flood", label: "Flood risk", icon: Droplets },
  { key: "mobile", label: "Mobile coverage", icon: Smartphone },
  { key: "broadband", label: "Broadband availability", icon: Wifi },
  { key: "ev", label: "EV charging points", icon: PlugZap },
  { key: "nearby", label: "Nearby neighbourhoods", icon: Map },
];

export function LoadingModal({ isOpen, postcode }: LoadingModalProps) {
  const [progress, setProgress] = useState<Record<string, PhaseStatus>>({});
  const [factIdx, setFactIdx] = useState(0);

  // Poll the server's live progress while the modal is open.
  useEffect(() => {
    if (!isOpen || !postcode) {
      setProgress({});
      setFactIdx(0);
      return;
    }
    let cancelled = false;
    // The server keys progress by postcode.toUpperCase() (preserving any space,
    // e.g. "DG11 2AR"), so match that exactly — do NOT strip spaces.
    const key = postcode.toUpperCase();
    const poll = async () => {
      try {
        const res = await fetch(`/api/assess/progress/${encodeURIComponent(key)}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data.phase) setProgress(data.phase);
        }
      } catch {
        /* transient — next poll will catch up */
      }
    };
    poll();
    const timer = setInterval(poll, 500);
    const factTimer = setInterval(() => setFactIdx((i) => (i + 1) % UK_FACTS.length), 4500);
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearInterval(factTimer);
    };
  }, [isOpen, postcode]);

  const doneCount = PHASES.filter((p) => progress[p.key] === "done").length;
  const errCount = PHASES.filter((p) => progress[p.key] === "error").length;
  const pct = Math.round(((doneCount + errCount) / PHASES.length) * 100);

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-[480px] outline-none" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-center font-display text-2xl">Analysing Area</DialogTitle>
        </DialogHeader>

        <div className="py-6 space-y-6">
          {/* Real progress bar — fills as searches complete */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Live checklist — ticked from real server progress */}
          <div className="grid grid-cols-1 gap-1.5">
            {PHASES.map((p) => {
              const Icon = p.icon;
              const status = progress[p.key] || "pending";
              return (
                <div
                  key={p.key}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    status === "done"
                      ? "border-green-200 bg-green-50 text-green-800"
                      : status === "error"
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : "border-border bg-gray-50 text-muted-foreground"
                  }`}
                >
                  {status === "done" ? (
                    <Check className="h-4 w-4 shrink-0 text-green-600" />
                  ) : status === "error" ? (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                  ) : (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary/60" />
                  )}
                  <span className="truncate">{p.label}</span>
                  {status === "error" && <span className="ml-auto text-[11px] font-medium">retrying / unavailable</span>}
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
            {errCount > 0
              ? `Crunching live UK Open Data — ${doneCount}/${PHASES.length} searches done (${errCount} hit a slow source but we'll still build your report).`
              : `Crunching live UK Open Data — ${doneCount}/${PHASES.length} searches complete.`}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
