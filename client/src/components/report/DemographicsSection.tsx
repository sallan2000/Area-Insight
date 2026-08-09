import { Card, CardContent } from "@/components/ui/card";
import { Users } from "lucide-react";

interface DemographicsData {
  lsoa21: string;
  population: number;
  ageUnder18: number; // % under 18
  age65Plus: number;  // % aged 65+
  ownerOccupied: number; // % owned outright/mortgage
  privateRented: number;
  socialRented: number;
  noCar: number;
  source: string;
}

function pct(n: number | undefined): string {
  return n == null ? "—" : `${Math.round(n)}%`;
}

export function DemographicsSection({ data }: { data?: DemographicsData | null }) {
  if (!data) {
    return (
      <section className="space-y-6">
        <h3 className="text-xl font-display font-bold px-1">Demographics (Census 2021)</h3>
        <div className="p-4 bg-gray-50 rounded-lg border border-border text-sm text-muted-foreground">
          Census 2021 demographics are not loaded for this area. Run{" "}
          <code>npm run sync:census-demographics</code> on the server to populate ONS Census 2021
          age, tenure and population data by local area.
        </div>
      </section>
    );
  }

  const tenantMix = [
    { label: "Owner occupied", value: data.ownerOccupied, color: "bg-emerald-500" },
    { label: "Private rented", value: data.privateRented, color: "bg-amber-500" },
    { label: "Social rented", value: data.socialRented, color: "bg-sky-500" },
  ];

  return (
    <section className="space-y-6">
      <h3 className="text-xl font-display font-bold px-1">Demographics (Census 2021)</h3>
      <Card className="bg-white border-border shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="p-3 bg-indigo-50 rounded-xl text-indigo-600">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold">{data.population.toLocaleString("en-GB")} residents</h4>
              <p className="text-sm text-muted-foreground">ONS Census 2021 · local area (LSOA)</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="p-3 bg-gray-50 rounded-lg border border-border">
              <p className="text-xs text-muted-foreground">Under 18</p>
              <p className="text-lg font-bold text-foreground">{pct(data.ageUnder18)}</p>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg border border-border">
              <p className="text-xs text-muted-foreground">Aged 65+</p>
              <p className="text-lg font-bold text-foreground">{pct(data.age65Plus)}</p>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg border border-border">
              <p className="text-xs text-muted-foreground">No car/van</p>
              <p className="text-lg font-bold text-foreground">{pct(data.noCar)}</p>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg border border-border">
              <p className="text-xs text-muted-foreground">Population</p>
              <p className="text-lg font-bold text-foreground">{data.population.toLocaleString("en-GB")}</p>
            </div>
          </div>

          <p className="text-xs font-semibold text-muted-foreground mb-2">Housing tenure mix</p>
          <div className="space-y-2">
            {tenantMix.map((t) => (
              <div key={t.label}>
                <div className="flex justify-between text-xs font-medium mb-1">
                  <span>{t.label}</span>
                  <span>{pct(t.value)}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className={`h-2 rounded-full ${t.color}`} style={{ width: `${t.value || 0}%` }} />
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground mt-4">
            Figures are for the local area (LSOA) covering this postcode — a small neighbourhood,
            not the whole town. Source: {data.source}.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
