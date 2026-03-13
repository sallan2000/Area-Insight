import { useState, useRef } from "react";
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
  Waves,
  Download,
  Share2,
  ShoppingCart,
  ShoppingBag,
  Building2,
  Zap
} from "lucide-react";
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { LoadingModal } from "@/components/LoadingModal";
import { LockedMap } from "@/components/LockedMap";
import { UserMenu } from "@/components/UserMenu";

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

  const { data: report1 } = useAssessment(ids.id1!);
  const { data: report2 } = useAssessment(ids.id2!);

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
        throw new Error(data1.message || data2.message || "Failed to fetch one or both postcodes");
      }

      setIds({ id1: data1.id, id2: data2.id });
    } catch (error: any) {
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

  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const comparisonRef = useRef<HTMLDivElement>(null);
  const comparisonUrl = typeof window !== 'undefined' ? `${window.location.origin}/compare?pc1=${encodeURIComponent(pc1)}&pc2=${encodeURIComponent(pc2)}` : '';

  const exportAsImage = async () => {
    if (!comparisonRef.current) return;
    try {
      const dataUrl = await toPng(comparisonRef.current, { 
        cacheBust: true,
        backgroundColor: '#f9fafb',
        filter: (node) => node.tagName !== 'IFRAME'
      });
      const link = document.createElement('a');
      link.download = `Comparison-${pc1}-vs-${pc2}.png`;
      link.href = dataUrl;
      link.click();
      toast({ title: "Image exported!", description: "Comparison has been saved as an image." });
    } catch (err) {
      toast({ title: "Export failed", description: "Could not export as image.", variant: "destructive" });
    }
  };

  const exportAsPDF = async () => {
    if (!comparisonRef.current) return;
    try {
      const dataUrl = await toPng(comparisonRef.current, { 
        cacheBust: true,
        backgroundColor: '#f9fafb',
        filter: (node) => node.tagName !== 'IFRAME'
      });
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(dataUrl);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      pdf.addImage(dataUrl, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Comparison-${pc1}-vs-${pc2}.pdf`);
      toast({ title: "PDF exported!", description: "Comparison has been saved as a PDF." });
    } catch (err) {
      toast({ title: "Export failed", description: "Could not export as PDF.", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <Dialog open={isShareModalOpen} onOpenChange={setIsShareModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share & Export Comparison</DialogTitle>
            <DialogDescription>
              Share this comparison between {pc1} and {pc2} or download it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" className="gap-2" onClick={exportAsImage}>
                <Download className="h-4 w-4" />
                Export Image
              </Button>
              <Button variant="outline" className="gap-2" onClick={exportAsPDF}>
                <Download className="h-4 w-4" />
                Export PDF
              </Button>
            </div>
            <div className="flex justify-center gap-4 py-2 border-y">
              <Button size="icon" variant="ghost" onClick={() => {
                const url = encodeURIComponent(comparisonUrl);
                window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank');
              }} title="Share on Facebook">
                <svg className="h-5 w-5 text-blue-600" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              </Button>
              <Button size="icon" variant="ghost" onClick={() => {
                const url = encodeURIComponent(comparisonUrl);
                const text = encodeURIComponent(`Comparing ${pc1} vs ${pc2} on ScoreMyStreet!`);
                window.open(`https://twitter.com/intent/tweet?url=${url}&text=${text}`, '_blank');
              }} title="Share on Twitter">
                <svg className="h-5 w-5 text-sky-500" fill="currentColor" viewBox="0 0 24 24"><path d="M23.953 4.57a10 10 0 002.856 2.871c-.025.355-.049.71-.049 1.067a10.064 10.064 0 01-10.033 10.034c-3.181 0-6.156-1.003-8.614-2.863.324.037.636.074.924.074a7.1 7.1 0 004.010-1.229 3.543 3.543 0 01-3.296-2.456 3.542 3.542 0 001.604-.896 3.542 3.542 0 01-2.812-3.474 3.54 3.54 0 00.611 1.598A3.53 3.53 0 00.27 12.8a10.055 10.055 0 008.063-2.853 3.543 3.543 0 01-.987-4.735c1.164-1.165 3.025-1.165 4.188 0a3.5 3.5 0 012.516 1.08 7.082 7.082 0 002.155-2.773c-.299.934-.922 1.729-1.77 2.235a7.134 7.134 0 002.019-.584 7.15 7.15 0 01-1.767 1.838z"/></svg>
              </Button>
              <Button size="icon" variant="ghost" onClick={() => {
                const url = encodeURIComponent(comparisonUrl);
                window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${url}`, '_blank');
              }} title="Share on LinkedIn">
                <svg className="h-5 w-5 text-blue-700" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.475-2.236-1.986-2.236-1.081 0-1.722.722-2.004 1.418-.103.249-.129.597-.129.946v5.441h-3.554s.05-8.736 0-9.646h3.554v1.364c.43-.664 1.199-1.608 2.925-1.608 2.135 0 3.735 1.39 3.735 4.38v5.51zM5.337 9.432c-1.144 0-1.915-.758-1.915-1.708 0-.951.77-1.708 1.915-1.708 1.144 0 1.915.757 1.915 1.708 0 .95-.771 1.708-1.915 1.708zm1.946 11.02H3.391V9.806h3.892v10.646zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"/></svg>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <LoadingModal isOpen={isCreating} completedSteps={completedSteps} />
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-2xl font-display font-bold text-foreground">Compare Areas</h1>
          </div>
          <div className="flex items-center gap-2">
            {report1 && report2 && (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setIsShareModalOpen(true)}>
                <Share2 className="w-4 h-4" />
                Share & Export
              </Button>
            )}
            <UserMenu />
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
          <div ref={comparisonRef} className="space-y-8">
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
                  <LockedMap lat={Number(report1.lat)} lng={Number(report1.lng)} postcode={report1.postcode} />
                </div>
                <div className="bg-white rounded-2xl p-1 shadow-sm border border-border overflow-hidden relative min-h-[300px]">
                  <LockedMap lat={Number(report2.lat)} lng={Number(report2.lng)} postcode={report2.postcode} />
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
                      { name: 'Air Quality', key: 'airQuality', icon: Wind, type: 'text', getValue: (r: any) => r?.environment?.airQuality ? `${r.environment.airQuality.level} (DAQI ${r.environment.airQuality.index}/10)` : 'N/A' },
                      { name: 'Noise Level', key: 'noise', icon: Volume2, type: 'text', getValue: (r: any) => r?.environment?.noise ? `${r.environment.noise.level} (${r.environment.noise.day} dB day)` : 'N/A' },
                      { name: 'Flood Risk', key: 'flood', icon: Waves, type: 'text', getValue: (r: any) => r?.environment?.floodRisk ? `${r.environment.floodRisk.likelihood}${r.environment.floodRisk.station?.river ? ` — ${r.environment.floodRisk.station.river}` : ''}` : 'N/A' },
                      { name: 'Nearest EV Charger', key: 'evCharger', icon: Zap, type: 'text', getValue: (r: any) => {
                        if (!r?.evChargers?.length) return 'N/A';
                        const nearest = r.evChargers[0];
                        const dist = nearest.distance != null ? `${nearest.distance.toFixed(1)} km` : '—';
                        const totalPoints = r.evChargers.reduce((sum: number, c: any) => sum + (c.numberOfPoints || 1), 0);
                        return `${dist} · ${totalPoints} points`;
                      }},
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
                            <span className={`text-lg font-bold ${win === 1 ? 'text-emerald-600' : (win === 2 ? 'text-red-600' : '')}`}>{val1}</span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={`text-lg font-bold ${win === 2 ? 'text-emerald-600' : (win === 1 ? 'text-red-600' : '')}`}>{val2}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Amenities Breakdown */}
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-8">
                {[
                  { raw: raw1, postcode: report1.postcode },
                  { raw: raw2, postcode: report2.postcode }
                ].map(({ raw, postcode }) => {
                  const list = raw?.amenities?.list || [];
                  const grouped = list.reduce((acc: any, item: any) => {
                    const cat = item.category || 'other';
                    if (!acc[cat]) acc[cat] = [];
                    acc[cat].push(item);
                    return acc;
                  }, {});
                  const categoryIcons: Record<string, any> = {
                    supermarket: <ShoppingCart className="h-3.5 w-3.5" />,
                    convenience_store: <ShoppingBag className="h-3.5 w-3.5" />,
                    shopping_centre: <Building2 className="h-3.5 w-3.5" />,
                    department_store: <Store className="h-3.5 w-3.5" />,
                  };
                  return (
                    <Card key={postcode} className="p-5" data-testid={`compare-amenities-${postcode}`}>
                      <h4 className="font-bold mb-1 flex items-center gap-2">
                        <Store className="h-4 w-4 text-primary" />
                        {postcode} — Amenities
                      </h4>
                      <p className="text-xs text-muted-foreground mb-4">{list.length} shops, eateries, and local services</p>
                      <div className="space-y-3 max-h-[300px] overflow-y-auto">
                        {Object.entries(grouped).slice(0, 8).map(([category, items]: [string, any]) => {
                          const icon = categoryIcons[category] || null;
                          return (
                            <div key={category}>
                              <h5 className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 flex items-center gap-1">{icon}{category.replace(/_/g, ' ')}</h5>
                              <div className="space-y-0.5">
                                {items.slice(0, 3).map((item: any, i: number) => (
                                  <div key={i} className="flex justify-between text-xs">
                                    <span className="text-foreground truncate mr-2">{item.name}</span>
                                    <span className="text-muted-foreground whitespace-nowrap">{item.distance < 1 ? `${Math.round(item.distance * 1000)}m` : `${item.distance.toFixed(1)}km`}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {!report1 && !report2 && !isCreating && (
          <div className="text-center py-20 space-y-4 opacity-50">
            <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground" />
            <h3 className="text-xl font-medium">Enter two postcodes to compare them side-by-side</h3>
            <p>We'll analyse crime, transport, schools and more for both areas.</p>
          </div>
        )}
      </main>
    </div>
  );
}
