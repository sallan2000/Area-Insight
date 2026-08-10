import { Card, CardContent } from "@/components/ui/card";
import { Home } from "lucide-react";

interface PropertySale { date: string; price: number; type: string }
interface PropertySalesData {
  available: boolean;
  coverage?: string;
  postcode?: string;
  outcode?: string;
  found?: boolean;
  perPostcode?: boolean;
  byCouncilArea?: boolean;
  councilArea?: string;
  councilAreaCode?: string;
  avgPrice?: number;
  salesCount?: number;
  minPrice?: number;
  maxPrice?: number;
  latestDate?: string | null;
  latestPrice?: number | null;
  sales?: PropertySale[];
  date?: string | null;
  annualChange?: number | null;
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
  if (isNaN(d.getTime())) return iso;
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

      {data.available === false && data.country && (
        <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
          <p className="text-sm text-amber-800">
            Property sales data is not available for {data.country === "Scotland" ? "Scotland" : "Northern Ireland"} at postcode level.
            Only the council/area average is shown where available.
          </p>
        </div>
      )}

      {data.available && data.byCouncilArea && (
        <Card className="bg-white border-border shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-indigo-50 rounded-xl text-indigo-600">
                <Home className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold">Average for {data.councilArea} <span className="text-indigo-600">(by council area)</span></h4>
                <p className="text-sm text-muted-foreground">
                  UK House Price Index · {data.country} · {fmtDate(data.date)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              <div className="p-3 bg-gray-50 rounded-lg border border-border">
                <p className="text-xs text-muted-foreground">Council-area average</p>
                <p className="text-lg font-bold text-indigo-700">{gbFormat(data.avgPrice || 0)}</p>
              </div>
              {data.annualChange != null && (
                <div className="p-3 bg-gray-50 rounded-lg border border-border">
                  <p className="text-xs text-muted-foreground">Annual change</p>
                  <p className={`text-lg font-bold ${data.annualChange >= 0 ? "text-green-700" : "text-red-700"}`}>
                    {data.annualChange >= 0 ? "+" : ""}{data.annualChange}%
                  </p>
                </div>
              )}
              <div className="p-3 bg-gray-50 rounded-lg border border-border">
                <p className="text-xs text-muted-foreground">Granularity</p>
                <p className="text-lg font-bold text-foreground">Council area</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground mt-3">
              This is the <span className="font-semibold">council-area average</span> for {data.councilArea} — the average at council/area level,
              shown when postcode-specific sales information is not available. Source: {data.source}.
            </p>
          </CardContent>
        </Card>
      )}

      {data.available && data.found === false && (
        <div className="p-4 bg-gray-50 rounded-lg border border-border">
          <p className="text-sm text-muted-foreground">
            {data.message || `No recorded sales in ${data.outcode} in the last ${data.windowMonths} months.`}
          </p>
        </div>
      )}

      {data.available && data.found && (
        <Card className="bg-white border-border shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-indigo-50 rounded-xl text-indigo-600">
                <Home className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold">{data.perPostcode ? `Sales in ${data.postcode}` : `Average for ${data.outcode} district`}</h4>
                <p className="text-sm text-muted-foreground">
                  HM Land Registry Price Paid Data · last {data.windowMonths} months
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="p-3 bg-gray-50 rounded-lg border border-border">
                <p className="text-xs text-muted-foreground">{data.perPostcode ? "Average price" : "District average"}</p>
                <p className="text-lg font-bold text-indigo-700">{gbFormat(data.avgPrice || 0)}</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg border border-border">
                <p className="text-xs text-muted-foreground">Sales recorded</p>
                <p className="text-lg font-bold text-foreground">{data.salesCount}</p>
              </div>
              {/* Lowest/Highest are only meaningful for the per-postcode view, where
                  the source actually records min/max on the exact street. The district
                  (outcode) summary stores only avg + count, so hide these rather than
                  show misleading "—" blanks (option A). */}
              {data.perPostcode && data.minPrice != null && (
                <div className="p-3 bg-gray-50 rounded-lg border border-border">
                  <p className="text-xs text-muted-foreground">Lowest</p>
                  <p className="text-lg font-bold text-foreground">{gbFormat(data.minPrice)}</p>
                </div>
              )}
              {data.perPostcode && data.maxPrice != null && (
                <div className="p-3 bg-gray-50 rounded-lg border border-border">
                  <p className="text-xs text-muted-foreground">Highest</p>
                  <p className="text-lg font-bold text-foreground">{gbFormat(data.maxPrice)}</p>
                </div>
              )}
            </div>

            {data.perPostcode && data.sales && data.sales.length > 0 && (
              <div className="mt-2">
                <p className="text-sm font-bold text-foreground mb-2">Individual sales (most recent first)</p>
                <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100 sticky top-0">
                      <tr>
                        <th className="text-left p-2 font-semibold">Date</th>
                        <th className="text-right p-2 font-semibold">Price</th>
                        <th className="text-left p-2 font-semibold">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sales.map((s, i) => (
                        <tr key={i} className="border-t border-border odd:bg-white even:bg-gray-50">
                          <td className="p-2 text-muted-foreground">{fmtDate(s.date)}</td>
                          <td className="p-2 text-right font-medium">{gbFormat(s.price)}</td>
                          <td className="p-2 text-muted-foreground">{s.type}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.salesCount && data.sales.length < data.salesCount && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Showing {data.sales.length} of {data.salesCount} sales (most recent).
                  </p>
                )}
              </div>
            )}

            <p className="text-xs text-muted-foreground mt-3">
              {data.perPostcode
                ? `Based on ${data.salesCount} recorded open-market sales in ${data.postcode} over the last ${data.windowMonths} months (HM Land Registry, ${data.source}).`
                : `District-level average for ${data.outcode} — no individual sales were recorded for this exact postcode in the last ${data.windowMonths} months (HM Land Registry, ${data.source}).`}
            </p>
          </CardContent>
        </Card>
      )}

      {data.available === false && !data.country && (
        <div className="p-4 bg-gray-50 rounded-lg border border-border">
          <p className="text-sm text-muted-foreground">{data.message || "Property sales data is unavailable."}</p>
        </div>
      )}
    </section>
  );
}
