import { useState } from "react";
import { useLocation } from "wouter";
import { useAssessment } from "@/hooks/use-assess";
import { 
  ArrowLeft, 
  MapPin, 
  Check, 
  Shield,
  Bus,
  GraduationCap,
  Store,
  TrendingUp,
  Receipt,
  Wifi,
  Signal,
  Wind,
  Volume2,
  Waves
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { LoadingModal } from "@/components/LoadingModal";

export default function Compare() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [pc1, setPc1] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('pc1') || "";
  });
  const [pc2, setPc2] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('pc2') || "";
  });
  const [ids, setIds] = useState<{id1?: number, id2?: number}>({});
  const [isCreating, setIsCreating] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);

  // Automatically trigger comparison if postcodes are present in URL
  useState(() => {
    if (pc1 && pc2) {
      setTimeout(() => {
        const form = document.querySelector('form');
        form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }, 100);
    }
  });

  const { data: report1, isLoading: loading1 } = useAssessment(ids.id1!);
  const { data: report2, isLoading: loading2 } = useAssessment(ids.id2!);

  const handleCompare = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPc1 = pc1.trim().toUpperCase();
    const cleanPc2 = pc2.trim().toUpperCase();
    const postcodeRegex = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i;

    if (!cleanPc1 || !cleanPc2) {
      toast({
        title: "Postcodes required",
        description: "Please enter two UK postcodes to compare.",
        variant: "destructive"
      });
      return;
    }

    if (!postcodeRegex.test(cleanPc1) || !postcodeRegex.test(cleanPc2)) {
      toast({
        title: "Invalid postcode format",
        description: "One or both postcodes are not in a valid UK format.",
        variant: "destructive"
      });
      return;
    }

    setIds({});
    setCompletedSteps([]);
    setIsCreating(true);

    // Simulate progress for UX
    const steps = ["transport", "safety", "schools", "amenities"];
    steps.forEach((step, index) => {
      setTimeout(() => {
        setCompletedSteps(prev => [...prev, step]);
      }, (index + 1) * 1200);
    });

    try {
      const [res1, res2] = await Promise.all([
        apiRequest("POST", "/api/assess", { postcode: cleanPc1 }),
        apiRequest("POST", "/api/assess", { postcode: cleanPc2 })
      ]);

      const [data1, data2] = await Promise.all([
        res1.json(),
        res2.json()
      ]);

      if (!res1.ok || !res2.ok) {
        const errorMessage = (!res1.ok && data1.message?.includes("Invalid postcode")) || (!res2.ok && data2.message?.includes("Invalid postcode"))
          ? "One or both postcodes are not recognized as valid UK postcodes. Please check for typos."
          : (data1.message || data2.message || "Failed to fetch one or both postcodes");
        throw new Error(errorMessage);
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
  const raw1 = report1?.rawMetrics as any;
  const raw2 = report2?.rawMetrics as any;

  const getConnectivityValue = (raw: any) => {
    if (!raw?.connectivity?.broadband) return "N/A";
    const ultra = raw.connectivity.broadband.find((b: any) => b.type === "Ultrafast");
    return ultra ? ultra.speed : "N/A";
  };

  const getMobile5GValue = (raw: any) => {
    if (!raw?.connectivity?.mobile) return "N/A";
    return `${raw.connectivity.mobile.fiveG} (5G)`;
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <LoadingModal isOpen={isCreating} completedSteps={completedSteps} />
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
              <TrendingUp className="mr-2 h-4 w-4" />
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
                  <div className="flex flex-col items-center gap-2">
                    {getWinner(report1Scores.total, report2Scores.total) === 1 && <Badge className="bg-emerald-500">WINNER</Badge>}
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="text-primary hover:text-primary/80 font-medium"
                      onClick={() => setLocation(`/report/${ids.id1}?from=compare&pc1=${encodeURIComponent(pc1)}&pc2=${encodeURIComponent(pc2)}`)}
                    >
                      View Full Report
                    </Button>
                  </div>
                </div>
                <div className="text-2xl font-bold text-muted-foreground/30">VS</div>
                <div className="flex-1 text-center space-y-4">
                  <p className="text-lg font-bold">{report2.postcode}</p>
                  <div className={`text-5xl font-black ${getWinner(report1Scores.total, report2Scores.total) === 2 ? 'text-primary' : 'text-muted-foreground'}`}>
                    {report2Scores.total}
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    {getWinner(report1Scores.total, report2Scores.total) === 2 && <Badge className="bg-emerald-500">WINNER</Badge>}
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="text-primary hover:text-primary/80 font-medium"
                      onClick={() => setLocation(`/report/${ids.id2}?from=compare&pc1=${encodeURIComponent(pc1)}&pc2=${encodeURIComponent(pc2)}`)}
                    >
                      View Full Report
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:col-span-2">
              <div className="bg-white rounded-2xl p-1 shadow-sm border border-border overflow-hidden relative min-h-[300px]">
                <iframe
                  width="100%"
                  height="100%"
                  style={{ border: 0, minHeight: '300px' }}
                  loading="lazy"
                  allowFullScreen
                  referrerPolicy="no-referrer-when-downgrade"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${Number(report1.lng)-0.002}%2C${Number(report1.lat)-0.002}%2C${Number(report1.lng)+0.002}%2C${Number(report1.lat)+0.002}&layer=mapnik&marker=${report1.lat}%2C${report1.lng}`}
                ></iframe>
                <div className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full border border-border shadow-sm">
                  <span className="text-xs font-bold">{report1.postcode}</span>
                </div>
              </div>
              <div className="bg-white rounded-2xl p-1 shadow-sm border border-border overflow-hidden relative min-h-[300px]">
                <iframe
                  width="100%"
                  height="100%"
                  style={{ border: 0, minHeight: '300px' }}
                  loading="lazy"
                  allowFullScreen
                  referrerPolicy="no-referrer-when-downgrade"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${Number(report2.lng)-0.002}%2C${Number(report2.lat)-0.002}%2C${Number(report2.lng)+0.002}%2C${Number(report2.lat)+0.002}&layer=mapnik&marker=${report2.lat}%2C${report2.lng}`}
                ></iframe>
                <div className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full border border-border shadow-sm">
                  <span className="text-xs font-bold">{report2.postcode}</span>
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
                    { name: 'Safety', key: 'safety', icon: Shield, type: 'score' },
                    { name: 'Transport', key: 'transport', icon: Bus, type: 'score' },
                    { name: 'Schools', key: 'schools', icon: GraduationCap, type: 'score' },
                    { name: 'Amenities', key: 'amenities', icon: Store, type: 'score' },
                    { name: 'Council Tax', key: 'councilTax', icon: Receipt, type: 'text', getValue: (r: any) => r?.councilTax?.estimatedBand ? `Band ${r.councilTax.estimatedBand}` : 'N/A' },
                    { name: 'Broadband', key: 'broadband', icon: Wifi, type: 'text', getValue: getConnectivityValue },
                    { name: '4G Signal', key: 'mobile4g', icon: Signal, type: 'text', getValue: (r: any) => r?.connectivity?.mobile?.fourG ? `${r.connectivity.mobile.fourG} (4G)` : 'N/A' },
                    { name: '5G Signal', key: 'mobile5g', icon: Signal, type: 'text', getValue: (r: any) => r?.connectivity?.mobile?.fiveG ? `${r.connectivity.mobile.fiveG} (5G)` : 'N/A' },
                    { name: 'Air Quality', key: 'airQuality', icon: Wind, type: 'text', getValue: (r: any) => r?.environmental?.airQuality?.label || 'N/A' },
                    { name: 'Noise Level', key: 'noise', icon: Volume2, type: 'text', getValue: (r: any) => r?.environmental?.noise?.level || 'N/A' },
                    { name: 'Flood Risk', key: 'flood', icon: Waves, type: 'text', getValue: (r: any) => r?.environmental?.floodRisk?.rating || 'N/A' },
                  ].map((cat) => {
                    const val1 = cat.type === 'score' ? report1Scores[cat.key] : cat.getValue?.(raw1);
                    const val2 = cat.type === 'score' ? report2Scores[cat.key] : cat.getValue?.(raw2);
                    const win = cat.type === 'score' ? getWinner(val1, val2) : 0;

                    return (
                      <tr key={cat.name} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <cat.icon className="h-5 w-5 text-primary" />
                            <span className="font-semibold">{cat.name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <span className={`text-lg font-bold ${win === 1 ? 'text-emerald-600' : (win === 2 ? 'text-red-600' : '')}`}>{val1}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <span className={`text-lg font-bold ${win === 2 ? 'text-emerald-600' : (win === 1 ? 'text-red-600' : '')}`}>{val2}</span>
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
            <p>We'll analyse crime (12 months within 1km), transport, schools and more for both areas.</p>
          </div>
        )}
      </main>
    </div>
  );
}
