import { useState } from "react";
import { useLocation } from "wouter";
import { useAssessment } from "@/hooks/use-assess";
import { 
  ArrowLeft, 
  MapPin, 
  Loader2, 
  Check, 
  Shield,
  Bus,
  GraduationCap,
  Store,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function Compare() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [pc1, setPc1] = useState("");
  const [pc2, setPc2] = useState("");
  const [ids, setIds] = useState<{id1?: number, id2?: number}>({});
  const [isCreating, setIsCreating] = useState(false);

  const { data: report1, isLoading: loading1 } = useAssessment(ids.id1!);
  const { data: report2, isLoading: loading2 } = useAssessment(ids.id2!);

  const handleCompare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pc1.trim() || !pc2.trim()) return;

    setIds({});
    setIsCreating(true);

    try {
      const [res1, res2] = await Promise.all([
        apiRequest("POST", "/api/assess", { postcode: pc1.trim() }),
        apiRequest("POST", "/api/assess", { postcode: pc2.trim() })
      ]);

      const [data1, data2] = await Promise.all([
        res1.json(),
        res2.json()
      ]);

      if (!res1.ok || !res2.ok) {
        throw new Error(data1.message || data2.message || "Failed to fetch one or both postcodes");
      }

      setIds({ id1: data1.id, id2: data2.id });
    } catch (error: any) {
      console.error("Comparison error:", error);
      toast({
        title: "Comparison failed",
        description: error.message || "An unexpected error occurred",
        variant: "destructive"
      });
    } finally {
      setIsCreating(false);
    }
  };

  const getWinner = (v1: number, v2: number) => {
    if (v1 > v2) return 1;
    if (v2 > v1) return 2;
    return 0;
  };

  const report1Scores = report1?.scores as any;
  const report2Scores = report2?.scores as any;

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-2xl font-display font-bold text-foreground">Compare Areas</h1>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <Card className="p-6">
          <form onSubmit={handleCompare} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-2">
              <label className="text-sm font-medium">Postcode 1</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="e.g. SW1A 1AA"
                  className="w-full pl-9 pr-4 py-2 bg-white border rounded-lg outline-none focus:ring-2 focus:ring-primary/20"
                  value={pc1}
                  onChange={(e) => setPc1(e.target.value.toUpperCase())}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Postcode 2</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="e.g. E1 6AN"
                  className="w-full pl-9 pr-4 py-2 bg-white border rounded-lg outline-none focus:ring-2 focus:ring-primary/20"
                  value={pc2}
                  onChange={(e) => setPc2(e.target.value.toUpperCase())}
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={isCreating}>
              {isCreating ? <Loader2 className="animate-spin mr-2" /> : <TrendingUp className="mr-2 h-4 w-4" />}
              Compare Areas
            </Button>
          </form>
        </Card>

        {report1 && report2 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="md:col-span-2 bg-white rounded-2xl p-8 border shadow-sm">
              <h2 className="text-xl font-bold mb-8 text-center">Liveability Showdown</h2>
              <div className="flex items-center justify-between gap-8">
                <div className="flex-1 text-center space-y-4">
                  <p className="text-lg font-bold">{report1.postcode}</p>
                  <div className={`text-5xl font-black ${getWinner(report1Scores.total, report2Scores.total) === 1 ? 'text-primary' : 'text-muted-foreground'}`}>
                    {report1Scores.total}
                  </div>
                  {getWinner(report1Scores.total, report2Scores.total) === 1 && <Badge className="bg-emerald-500">WINNER</Badge>}
                </div>
                <div className="text-2xl font-bold text-muted-foreground/30">VS</div>
                <div className="flex-1 text-center space-y-4">
                  <p className="text-lg font-bold">{report2.postcode}</p>
                  <div className={`text-5xl font-black ${getWinner(report1Scores.total, report2Scores.total) === 2 ? 'text-primary' : 'text-muted-foreground'}`}>
                    {report2Scores.total}
                  </div>
                  {getWinner(report1Scores.total, report2Scores.total) === 2 && <Badge className="bg-emerald-500">WINNER</Badge>}
                </div>
              </div>
            </div>

            <div className="md:col-span-2 bg-white rounded-2xl border shadow-sm overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50/50 border-b">
                    <th className="px-6 py-4 text-left text-sm font-semibold text-muted-foreground uppercase tracking-wider">Category</th>
                    <th className="px-6 py-4 text-center text-sm font-semibold text-muted-foreground uppercase tracking-wider">{report1.postcode}</th>
                    <th className="px-6 py-4 text-center text-sm font-semibold text-muted-foreground uppercase tracking-wider">{report2.postcode}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {[
                    { name: 'Safety', key: 'safety', icon: Shield },
                    { name: 'Transport', key: 'transport', icon: Bus },
                    { name: 'Schools', key: 'schools', icon: GraduationCap },
                    { name: 'Amenities', key: 'amenities', icon: Store },
                  ].map((cat) => {
                    const win = getWinner(report1Scores[cat.key], report2Scores[cat.key]);
                    return (
                      <tr key={cat.key} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <cat.icon className="h-5 w-5 text-muted-foreground" />
                            <span className="font-semibold">{cat.name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <span className={`text-lg font-bold ${win === 1 ? 'text-emerald-600' : ''}`}>{report1Scores[cat.key]}</span>
                            {win === 1 && <Check className="h-4 w-4 text-emerald-500" />}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <span className={`text-lg font-bold ${win === 2 ? 'text-emerald-600' : ''}`}>{report2Scores[cat.key]}</span>
                            {win === 2 && <Check className="h-4 w-4 text-emerald-500" />}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!report1 && !report2 && !isCreating && (
          <div className="text-center py-20 space-y-4 opacity-50">
            <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground" />
            <h3 className="text-xl font-medium">Enter two postcodes to compare them side-by-side</h3>
            <p>We'll analyze crime, transport, schools and more for both areas.</p>
          </div>
        )}
      </main>
    </div>
  );
}
