import { Card, CardContent } from "@/components/ui/card";
import { Trees, HeartPulse } from "lucide-react";

interface GreenSpace {
  count?: number;
  nearestDistance?: number | null;
  score?: number;
}

interface HealthAccess {
  count?: number;
  nearestDistance?: number | null;
  score?: number;
}

interface GreenHealthSectionProps {
  green?: GreenSpace;
  health?: HealthAccess;
  overpassFailed?: boolean;
}

function scoreBand(score: number | undefined): { label: string; cls: string } {
  if (score == null) return { label: "—", cls: "bg-gray-100 text-gray-500" };
  if (score >= 80) return { label: "Excellent", cls: "bg-emerald-100 text-emerald-700" };
  if (score >= 60) return { label: "Good", cls: "bg-blue-100 text-blue-700" };
  if (score >= 40) return { label: "Average", cls: "bg-amber-100 text-amber-700" };
  return { label: "Limited", cls: "bg-red-100 text-red-700" };
}

export function GreenHealthSection({ green, health, overpassFailed }: GreenHealthSectionProps) {
  const greenCount = green?.count ?? 0;
  const healthCount = health?.count ?? 0;
  const greenBand = scoreBand(green?.score);
  const healthBand = scoreBand(health?.score);

  return (
    <section className="space-y-6">
      <h3 className="text-xl font-display font-bold px-1">Green Space &amp; Health Access</h3>
      {overpassFailed && (
        <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 flex items-start gap-2" data-testid="notice-overpass-failed-green">
          <span className="text-xs text-amber-700">Map data temporarily unavailable — figures may be incomplete. Try refreshing the report later.</span>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Green Space */}
        <Card className="bg-white border-border shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-green-50 rounded-xl text-green-600">
                <Trees className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold">Green Space</h4>
                <p className="text-sm text-muted-foreground">Parks, gardens, nature &amp; woodland nearby</p>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-border mb-3">
              <div>
                <p className="text-sm font-bold text-foreground">{greenCount} green spaces</p>
                <p className="text-xs text-muted-foreground">
                  {green?.nearestDistance != null
                    ? `Nearest ${green.nearestDistance.toFixed(2)} km away`
                    : "Within 1.5 km"}
                </p>
              </div>
              <span className={`text-xs font-bold px-2 py-1 rounded-md ${greenBand.cls}`}>{greenBand.label}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Count and proximity of parks, gardens, playgrounds, pitches, commons, nature reserves and natural woodland or grassland within 1.5 km.
            </p>
          </CardContent>
        </Card>

        {/* Health Access */}
        <Card className="bg-white border-border shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-rose-50 rounded-xl text-rose-600">
                <HeartPulse className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold">Health Access</h4>
                <p className="text-sm text-muted-foreground">GPs, clinics, hospitals &amp; dentists nearby</p>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-border mb-3">
              <div>
                <p className="text-sm font-bold text-foreground">{healthCount} nearby</p>
                <p className="text-xs text-muted-foreground">
                  {health?.nearestDistance != null
                    ? `Nearest ${health.nearestDistance.toFixed(2)} km away`
                    : "Within 3 km"}
                </p>
              </div>
              <span className={`text-xs font-bold px-2 py-1 rounded-md ${healthBand.cls}`}>{healthBand.label}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Proximity and count of GPs, clinics, hospitals and dentists from OpenStreetMap — indicative of provision, not NHS service availability or waiting times.
            </p>
          </CardContent>
        </Card>

      </div>
    </section>
  );
}
