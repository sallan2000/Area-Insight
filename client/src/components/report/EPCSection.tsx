import { Card, CardContent } from "@/components/ui/card";
import { Zap, FileWarning } from "lucide-react";

interface EpcData {
  available: boolean;
  reason?: string; // 'no-key' | 'api-error' | 'empty' | 'timeout' | 'not-fetched'
  count?: number;
  avgBand?: string;
  avgEpcScore?: number;
  estHeatingCost?: number;
  estEnergyCost?: number;
  latestDate?: string | null;
  source?: string;
}

function gbFormat(n: number): string {
  return "£" + n.toLocaleString("en-GB");
}

export function EPCSection({ data }: { data?: EpcData | null }) {
  if (!data || !data.available) {
    const reason = data?.reason;
    return (
      <section className="space-y-6">
        <h3 className="text-xl font-display font-bold px-1">Energy Performance (EPC)</h3>
        <div className="p-4 bg-gray-50 rounded-lg border border-border text-sm text-muted-foreground">
          {reason === "no-key" ? (
            <p>
              Energy Performance Certificate data is available via the free GOV EPC Register API,
              but no API key is configured on this server. The owner can add a free key
              (register at epc.opendatacommunities.org) via the <code>EPC_API_KEY</code> environment
              variable to enable per-postcode EPC bands and heating-cost estimates.
            </p>
          ) : reason === "empty" ? (
            <p>No EPC certificates are recorded for this postcode on the GOV EPC Register.</p>
          ) : reason === "timeout" || reason === "api-error" ? (
            <p>EPC data could not be retrieved just now (the GOV EPC Register was slow or unreachable). Try refreshing the report.</p>
          ) : (
            <p>EPC data is not available for this postcode.</p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <h3 className="text-xl font-display font-bold px-1">Energy Performance (EPC)</h3>
      <Card className="bg-white border-border shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="p-3 bg-amber-50 rounded-xl text-amber-600">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold">Typical EPC band: {data.avgBand}</h4>
              <p className="text-sm text-muted-foreground">
                From {data.count} certificate{data.count === 1 ? "" : "s"} on the GOV EPC Register
                {data.latestDate ? ` · latest ${data.latestDate.slice(0, 10)}` : ""}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <div className="p-3 bg-gray-50 rounded-lg border border-border">
              <p className="text-xs text-muted-foreground">Typical band</p>
              <p className="text-lg font-bold text-amber-700">{data.avgBand}</p>
            </div>
            {data.avgEpcScore != null && (
              <div className="p-3 bg-gray-50 rounded-lg border border-border">
                <p className="text-xs text-muted-foreground">Avg EPC score</p>
                <p className="text-lg font-bold text-foreground">{data.avgEpcScore}</p>
              </div>
            )}
            {data.estHeatingCost != null && (
              <div className="p-3 bg-gray-50 rounded-lg border border-border">
                <p className="text-xs text-muted-foreground">Est. heating cost</p>
                <p className="text-lg font-bold text-foreground">{gbFormat(data.estHeatingCost)}/yr</p>
              </div>
            )}
            {data.estEnergyCost != null && (
              <div className="p-3 bg-gray-50 rounded-lg border border-border">
                <p className="text-xs text-muted-foreground">Est. energy cost</p>
                <p className="text-lg font-bold text-foreground">{gbFormat(data.estEnergyCost)}/yr</p>
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground mt-3">
            Band and costs are the average across recorded certificates for this postcode — an
            individual property may differ. Source: {data.source}.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
