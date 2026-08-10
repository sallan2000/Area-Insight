import { Card, CardContent } from "@/components/ui/card";
import { Wifi, Signal } from "lucide-react";

interface BroadbandRecord {
  type: string;
  maxDownMbps: number;
  maxUpMbps: number;
  available: boolean;
}

interface MobileOperator {
  name: string;
  data4GOutdoor: boolean;
  data4GIndoor: boolean;
}

interface ConnectivitySectionProps {
  connectivity: {
    broadband: BroadbandRecord[];
    broadbandUnavailable?: string | null;
    mobile: MobileOperator[] | { fourG?: string };
    mobileUnavailable?: string | null;
  };
}

export function ConnectivitySection({ connectivity }: ConnectivitySectionProps) {
  const broadband = Array.isArray(connectivity?.broadband) ? connectivity.broadband : [];
  const mobileOperators = Array.isArray(connectivity?.mobile) ? connectivity.mobile as MobileOperator[] : null;
  const mobileLegacy = !mobileOperators && (connectivity?.mobile as any)?.fourG;
  const broadbandUnavailable = connectivity?.broadbandUnavailable ?? null;
  const mobileUnavailable = connectivity?.mobileUnavailable ?? null;

  return (
    <section className="space-y-6">
      <h3 className="text-xl font-display font-bold px-1">Digital Connectivity</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Broadband */}
        <Card className="bg-white border-border shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600">
                <Wifi className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold">Broadband Availability</h4>
                <p className="text-sm text-muted-foreground">Predicted speeds by tier</p>
              </div>
            </div>
            {broadband.length > 0 ? (
              <div className="space-y-3">
                {broadband.map((b, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-border">
                    <div>
                      <p className="text-sm font-bold text-foreground">{b.type}</p>
                      {b.available ? (
                        <p className="text-xs text-muted-foreground">
                          ↓ {Math.round(b.maxDownMbps)} Mbps &nbsp;·&nbsp; ↑ {Math.round(b.maxUpMbps)} Mbps
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Not available at this postcode</p>
                      )}
                    </div>
                    <span className={`text-xs font-bold px-2 py-1 rounded-md ${b.available ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {b.available ? 'Available' : 'Not available'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                {broadbandUnavailable ? `Data unavailable — ${broadbandUnavailable}.` : "No broadband data available"}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Mobile Coverage */}
        <Card className="bg-white border-border shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-indigo-50 rounded-xl text-indigo-600">
                <Signal className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold">Mobile Coverage</h4>
                <p className="text-sm text-muted-foreground">Per-operator 4G indoor & outdoor</p>
              </div>
            </div>
            {mobileOperators && mobileOperators.length > 0 ? (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 mb-2 px-2">
                  <span className="text-xs font-bold text-muted-foreground uppercase">Network</span>
                  <span className="text-xs font-bold text-muted-foreground uppercase text-center w-20">4G{"\n"}Outdoor</span>
                  <span className="text-xs font-bold text-muted-foreground uppercase text-center w-20">4G{"\n"}Indoor</span>
                </div>
                {mobileOperators.map((op, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-x-2 items-center p-2 bg-gray-50 rounded-lg border border-border" data-testid={`mobile-op-${i}`}>
                    <span className="text-sm font-bold text-foreground">{op.name}</span>
                    {[op.data4GOutdoor, op.data4GIndoor].map((val, j) => (
                      <span key={j} className={`w-20 text-center text-base ${val ? 'text-emerald-500' : 'text-gray-300'}`}>
                        {val ? '✓' : '✗'}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            ) : mobileLegacy ? (
              <div className="p-4 bg-gray-50 rounded-xl border border-border text-center">
                <p className="text-xs font-bold text-muted-foreground uppercase mb-2">4G Coverage</p>
                <p className="text-xl font-bold text-emerald-600">{mobileLegacy}</p>
              </div>
            ) : (
              <div className="p-6 bg-gray-50 rounded-xl border border-border text-center" data-testid="mobile-no-data">
                <p className="text-sm text-muted-foreground">
                  {mobileUnavailable ? `Data unavailable — ${mobileUnavailable}.` : "No data available"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </section>
  );
}
