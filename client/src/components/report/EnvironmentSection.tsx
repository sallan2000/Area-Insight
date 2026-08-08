import { Card, CardContent } from "@/components/ui/card";
import { Wind, Volume2, Waves, AlertTriangle, BadgeCheck, FlaskConical } from "lucide-react";

interface AirQuality {
  index: number;
  level: string;
  description: string;
  source?: string;
  pollutants?: { name: string; value: number | string }[];
}

interface NoiseEstimate {
  level: string;
  day: number;
  night: number;
  sources?: string[];
}

interface FloodRisk {
  likelihood: string;
  description: string;
  activeAlerts: number;
  station?: {
    name: string;
    river?: string;
    distance: number | null;
    latestReading?: { value: number };
  } | null;
}

interface EnvironmentSectionProps {
  environment: {
    airQuality: AirQuality;
    noise: NoiseEstimate;
    floodRisk: FloodRisk;
  };
  airQualityEstimated?: boolean;
  overpassFailed?: boolean;
}

function DataSourceBadge({ estimated }: { estimated: boolean }) {
  if (estimated) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200"
        data-testid="badge-air-quality-estimated"
        title="Air quality is estimated using a location-based heuristic. No nearby DEFRA monitoring station was available."
      >
        <FlaskConical className="w-3 h-3" />
        Estimated
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"
      data-testid="badge-air-quality-live"
      title="Air quality data sourced from a live DEFRA UK-AIR monitoring station."
    >
      <BadgeCheck className="w-3 h-3" />
      DEFRA UK-AIR
    </span>
  );
}

export function EnvironmentSection({ environment, airQualityEstimated, overpassFailed }: EnvironmentSectionProps) {
  const { airQuality, noise, floodRisk } = environment;

  return (
    <section className="space-y-6">
      <h3 className="text-xl font-display font-bold px-1" data-testid="heading-environmental">Environmental Quality</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* Air Quality */}
        <Card className="bg-white border-border shadow-sm" data-testid="card-air-quality">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-blue-50 rounded-xl text-blue-600">
                <Wind className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold">Air Quality</h4>
                <p className="text-sm text-muted-foreground">UK DAQI (1–10 scale)</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full text-white font-bold text-lg ${
                  airQuality.index <= 3 ? 'bg-green-500' :
                  airQuality.index <= 6 ? 'bg-yellow-500' :
                  airQuality.index <= 9 ? 'bg-orange-500' : 'bg-red-600'
                }`} data-testid="text-air-quality-index">
                  {airQuality.index}
                </span>
                <span className={`text-lg font-bold ${
                  airQuality.index <= 3 ? 'text-green-700' :
                  airQuality.index <= 6 ? 'text-yellow-700' :
                  airQuality.index <= 9 ? 'text-orange-700' : 'text-red-700'
                }`} data-testid="text-air-quality-level">
                  {airQuality.level}
                </span>
              </div>
              <p className="text-sm text-muted-foreground leading-snug">{airQuality.description}</p>

              <div className="flex items-center justify-between pt-1">
                <DataSourceBadge estimated={airQualityEstimated ?? (!airQuality.source?.includes("DEFRA") && !airQuality.source?.includes("station"))} />
                {airQuality.source && (
                  <p className="text-[10px] text-muted-foreground">
                    {airQuality.source}
                  </p>
                )}
              </div>

              {airQualityEstimated && (
                <p className="text-[10px] text-amber-700 bg-amber-50 rounded-md px-2 py-1.5 border border-amber-100 leading-snug" data-testid="notice-air-quality-estimated">
                  No nearby monitoring station found. Index estimated from urban classification and proximity to major roads.
                </p>
              )}

              {airQuality.pollutants && airQuality.pollutants.length > 0 && (
                <div className="pt-3 grid grid-cols-3 gap-1.5">
                  {airQuality.pollutants.slice(0, 6).map((p, i) => (
                    <div key={i} className="bg-gray-50 p-1.5 rounded-lg border border-border text-center" data-testid={`text-pollutant-${i}`}>
                      <p className="text-[9px] text-muted-foreground font-bold">{p.name}</p>
                      <p className="text-[11px] font-bold text-foreground">
                        {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Noise */}
        <Card className="bg-white border-border shadow-sm" data-testid="card-noise">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className={`p-3 rounded-xl ${
                noise.level === 'Quiet' ? 'bg-green-50 text-green-600' :
                noise.level === 'Moderate' ? 'bg-orange-50 text-orange-600' :
                'bg-red-50 text-red-600'
              }`}>
                <Volume2 className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold">Noise Exposure</h4>
                <p className="text-sm text-muted-foreground">Estimated ambient levels</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className={`p-3 rounded-xl text-center border ${
                noise.level === 'Quiet' ? 'bg-green-50/50 border-green-100' :
                noise.level === 'Moderate' ? 'bg-orange-50/50 border-orange-100' :
                noise.level === 'Loud' ? 'bg-red-50/50 border-red-100' :
                'bg-red-100/50 border-red-200'
              }`}>
                <p className={`text-2xl font-bold ${
                  noise.level === 'Quiet' ? 'text-green-700' :
                  noise.level === 'Moderate' ? 'text-orange-700' : 'text-red-700'
                }`} data-testid="text-noise-level">
                  {noise.level}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">Daytime</p>
                  <p className="text-sm font-bold" data-testid="text-noise-day">{noise.day} dB</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">Nighttime</p>
                  <p className="text-sm font-bold" data-testid="text-noise-night">{noise.night} dB</p>
                </div>
              </div>

              <div className="flex items-center pt-1">
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200"
                  data-testid="badge-noise-estimated"
                  title="Noise levels are always estimated from proximity to roads, railways, airports, and nightlife — no sensor data is used."
                >
                  <FlaskConical className="w-3 h-3" />
                  Estimated
                </span>
              </div>

              {overpassFailed && (
                <div className="flex items-start gap-2 p-2 bg-amber-50 rounded-lg border border-amber-200" data-testid="notice-overpass-failed-noise">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-amber-700 leading-snug">
                    Map data unavailable — noise estimate uses reduced road/rail proximity data and may be less accurate.
                  </p>
                </div>
              )}

              {noise.sources && noise.sources.length > 0 && (
                <div className="pt-2 border-t border-border space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">Contributing sources</p>
                  {noise.sources.map((s, i) => (
                    <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5" data-testid={`text-noise-source-${i}`}>
                      <span className="mt-1 w-1.5 h-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                      {s}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Flood Risk */}
        <Card className="bg-white border-border shadow-sm" data-testid="card-flood-risk">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className={`p-3 rounded-xl ${
                floodRisk.likelihood === 'Very Low' ? 'bg-emerald-50 text-emerald-600' :
                floodRisk.likelihood === 'Low' ? 'bg-green-50 text-green-600' :
                floodRisk.likelihood === 'Medium' ? 'bg-yellow-50 text-yellow-600' :
                'bg-red-50 text-red-600'
              }`}>
                <Waves className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold">Flood Risk</h4>
                <p className="text-sm text-muted-foreground">Environment Agency data</p>
              </div>
            </div>
            <div className="space-y-2">
              <p className={`text-2xl font-bold ${
                floodRisk.likelihood === 'Very Low' ? 'text-emerald-700' :
                floodRisk.likelihood === 'Low' ? 'text-green-700' :
                floodRisk.likelihood === 'Medium' ? 'text-yellow-700' : 'text-red-700'
              }`} data-testid="text-flood-likelihood">
                {floodRisk.likelihood}
              </p>
              <p className="text-sm text-muted-foreground leading-snug">{floodRisk.description}</p>

              <div className="flex items-center pt-1">
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"
                  data-testid="badge-flood-live"
                  title="Flood risk data sourced from the Environment Agency Flood Monitoring API."
                >
                  <BadgeCheck className="w-3 h-3" />
                  Env. Agency
                </span>
              </div>

              {floodRisk.station && (
                <div className="mt-3 pt-3 border-t border-border space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Nearest station</span>
                    <span className="font-medium text-foreground" data-testid="text-flood-station">{floodRisk.station.name}</span>
                  </div>
                  {floodRisk.station.river && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">River</span>
                      <span className="font-medium text-foreground" data-testid="text-flood-river">{floodRisk.station.river}</span>
                    </div>
                  )}
                  {floodRisk.station.distance != null && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">Distance</span>
                      <span className="font-medium text-foreground">{(floodRisk.station.distance * 1000).toFixed(0)}m</span>
                    </div>
                  )}
                  {floodRisk.station.latestReading && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">Latest reading</span>
                      <span className="font-medium text-foreground" data-testid="text-flood-level">{floodRisk.station.latestReading.value} m</span>
                    </div>
                  )}
                </div>
              )}
              {floodRisk.activeAlerts > 0 && (
                <div className="mt-2 px-2 py-1.5 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-xs font-bold text-yellow-800" data-testid="text-flood-alerts">
                    ⚠ {floodRisk.activeAlerts} active alert{floodRisk.activeAlerts > 1 ? 's' : ''} within 5km
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

      </div>
    </section>
  );
}
