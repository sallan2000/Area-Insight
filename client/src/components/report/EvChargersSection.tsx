import { Card, CardContent } from "@/components/ui/card";
import { Zap } from "lucide-react";

interface Connection {
  type: string;
  powerKW: number | null;
  quantity: number;
}

interface EvCharger {
  name: string;
  operator: string;
  town: string;
  distance: number | null;
  usageCost?: string | null;
  connections?: Connection[];
}

interface EvChargersSectionProps {
  evChargers: EvCharger[];
}

export function EvChargersSection({ evChargers }: EvChargersSectionProps) {
  return (
    <section className="space-y-6" data-testid="section-ev-charging">
      <h3 className="text-xl font-display font-bold px-1">EV Charging</h3>
      <Card className="bg-white border-border shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="p-3 bg-yellow-50 rounded-xl text-yellow-600">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold">Nearest Charge Points</h4>
              <p className="text-sm text-muted-foreground">
                {evChargers.length
                  ? `${evChargers.length} charger${evChargers.length !== 1 ? 's' : ''} within 10 km`
                  : 'Charge point availability'}
              </p>
            </div>
          </div>
          {evChargers.length > 0 ? (
            <div className="space-y-4">
              {evChargers.map((charger, i) => (
                <div key={i} className="p-4 bg-gray-50 rounded-xl border border-border" data-testid={`ev-charger-${i}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-foreground truncate">{charger.name}</p>
                      <p className="text-xs text-muted-foreground">{charger.operator}{charger.town ? ` · ${charger.town}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-2 ml-3 shrink-0">
                      {charger.usageCost && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                          charger.usageCost.toLowerCase().includes('free') ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'
                        }`} data-testid={`ev-charger-cost-${i}`}>
                          {charger.usageCost.toLowerCase().includes('free') ? 'Free' : 'Paid'}
                        </span>
                      )}
                      <span className="text-xs font-bold text-primary" data-testid={`ev-charger-distance-${i}`}>
                        {charger.distance != null
                          ? (charger.distance < 1 ? `${Math.round(charger.distance * 1000)}m` : `${charger.distance.toFixed(1)} km`)
                          : '—'}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {charger.connections?.map((conn, j) => (
                      <span key={j} className="text-[10px] font-medium px-2 py-0.5 bg-yellow-50 text-yellow-800 border border-yellow-200 rounded-md" data-testid={`ev-charger-conn-${i}-${j}`}>
                        {conn.type}{conn.powerKW ? ` · ${conn.powerKW} kW` : ''}{conn.quantity > 1 ? ` · ${conn.quantity} pts` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 bg-gray-50 rounded-xl border border-border text-center" data-testid="ev-charger-no-data">
              <p className="text-sm text-muted-foreground">No data available</p>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
