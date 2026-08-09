import { Card, CardContent } from "@/components/ui/card";
import { Home } from "lucide-react";

interface PropertySalesData {
  available: boolean;
  coverage?: string;
  outcode?: string;
  found?: boolean;
  avgPrice?: number;
  salesCount?: number;
  latestDate?: string | null;
  latestPrice?: number | null;
  windowMonths?: number;
  source?: string;
  generatedAt?: string;
  note?: string;
  message?: string;
  country?: string;
}

function gbFormat(n: number): string {
  return "£" + n.toLocaleString("en-GB");
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function PropertySalesSection({ data }: { data?: PropertySalesData | null }) {
  if (!data) {
    return (
      <section className="space-y-6">
        <h3 className="text-xl font-display font-bold px-1">Property Sales (last 12 months)</h3>
        <div className="p-3 bg-gray-50 rounded-lg border border-border text-sm text-muted-foreground">
          Loading property sales…
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <h3 className="text-xl font-display font-bold px-1">Property Sales (last 12 months)</h3>

      {/* Not available for Scotland / NI (paid-only data) */}
      {data.available === false && data.country && (
        <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
          <p className="text-sm text-amber-800">
            Property sales data is not available for {data.country === "Scotland" ? "Scotland" : "Northern Ireland"} from free open registries.
            Registers of Scotland and Northern Ireland's Land Registry publish transaction-level sales data on a paid basis only.
          </p>
        </div>
      )}

      {/* Available but no sales recorded for this outcode in the window */}
      {data.available && data.found === false && (
        <div className="p-4 bg-gray-50 rounded-lg border border-border">
          <p className="text-sm text-muted-foreground">
            {data.message || `No recorded sales in ${data.outcode} in the last ${data.windowMonths} months.`}
          </p>
        </div>
      )}

      {/* Real data (England & Wales) */}
      {data.available && data.found && (
        <Card className="bg-white border-border shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-indigo-50 rounded-xl text-indigo-600">
                <Home className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold">Average sale price — {data.outcode}</h4>
                <p className="text-sm text-muted-foreground">
                  HM Land Registry Price Paid Data · last {data.windowMonths} months
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-border">
                <span className="text-sm font-bold text-foreground">Average price</span>
                <span className="text-lg font-bold text-indigo-700">{gbFormat(data.avgPrice || 0)}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-border">
                <span className="text-sm font-bold text-foreground">Sales recorded</span>
                <span className="text-sm font-bold text-foreground">{data.salesCount}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-border">
                <span className="text-sm font-bold text-foreground">Most recent sale</span>
                <span className="text-sm font-bold text-foreground">
                  {fmtDate(data.latestDate)}{data.latestPrice ? ` · ${gbFormat(data.latestPrice)}` : ""}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Based on {data.salesCount} recorded open-market sales in the {data.outcode} district over the last
              {" "}{data.windowMonths} months (HM Land Registry, {data.source}). Figures cover the postcode district, not the individual postcode.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Data not loaded / other unavailable */}
      {data.available === false && !data.country && (
        <div className="p-4 bg-gray-50 rounded-lg border border-border">
          <p className="text-sm text-muted-foreground">{data.message || "Property sales data is unavailable."}</p>
        </div>
      )}
    </section>
  );
}
