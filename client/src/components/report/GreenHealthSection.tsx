import { Card, CardContent } from "@/components/ui/card";
import { Trees, HeartPulse } from "lucide-react";

interface GreenSpace {
  count?: number;
  nearestDistance?: number | null;
}

interface HealthAccess {
  count?: number;
  nearestDistance?: number | null;
}

interface GreenHealthSectionProps {
  green?: GreenSpace;
  health?: HealthAccess;
  overpassFailed?: boolean;
}

function distanceLabel(km: number | undefined | null): string {
  if (km == null) return "no nearby feature found";
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  return `${km.toFixed(1)} km away`;
}

export function GreenHealthSection({ green, health, overpassFailed }: GreenHealthSectionProps) {
  const greenCount = green?.count ?? 0;
  const healthCount = health?.count ?? 0;

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
                <p className="text-sm text-muted-foreground">Parks, gardens &amp; woodland nearby</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-border">
                <span className="text-sm font-bold text-foreground">Green areas within 1.5 km</span>
                <span className="text-sm font-bold text-green-700">{greenCount}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-border">
                <span className="text-sm font-bold text-foreground">Nearest green space</span>
                <span className="text-sm font-bold text-foreground">{distanceLabel(green?.nearestDistance)}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Counts parks, gardens, playgrounds, commons, nature reserves, woodland and public greens
              (OpenStreetMap areas). Informational only — not a scored component.
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
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-border">
                <span className="text-sm font-bold text-foreground">Facilities within 3 km</span>
                <span className="text-sm font-bold text-rose-700">{healthCount}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-border">
                <span className="text-sm font-bold text-foreground">Nearest facility</span>
                <span className="text-sm font-bold text-foreground">{distanceLabel(health?.nearestDistance)}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Proximity and count of GPs, clinics, hospitals and dentists from OpenStreetMap — indicative of
              provision, not NHS service availability or waiting times.
            </p>
          </CardContent>
        </Card>

      </div>
    </section>
  );
}
