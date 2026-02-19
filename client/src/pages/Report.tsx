import { useParams, useLocation } from "wouter";
import { useAssessment } from "@/hooks/use-assess";
import { 
  Shield, 
  Bus, 
  GraduationCap, 
  Store, 
  ArrowLeft, 
  Share2, 
  MapPin,
  TrendingUp,
  AlertTriangle,
  Mail,
  Copy,
  Check,
  Receipt,
  ArrowRight,
  Wifi,
  Signal,
  Download,
  Facebook,
  Twitter,
  Linkedin
} from "lucide-react";
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScoreGauge } from "@/components/ScoreGauge";
import { MetricCard } from "@/components/MetricCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';

// Mock data for charts since real historical API might be limited
const trendData = [
  { name: 'Jan', value: 65 },
  { name: 'Feb', value: 59 },
  { name: 'Mar', value: 80 },
  { name: 'Apr', value: 81 },
  { name: 'May', value: 56 },
  { name: 'Jun', value: 55 },
];

export default function Report() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { data: report, isLoading, error } = useAssessment(Number(id));
  const [activeTab, setActiveTab] = useState<'safety' | 'transport' | 'schools' | 'amenities' | null>(null);

  // Set initial active tab based on scores and crime count
  useEffect(() => {
    if (report && !activeTab) {
      const scores = report.scores as any;
      const raw = report.rawMetrics as any;
      
      const tabOptions: ('safety' | 'transport' | 'schools' | 'amenities')[] = ['safety', 'transport', 'schools', 'amenities'];
      // Filter out null scores if any and sort
      const sortedTabs = [...tabOptions].sort((a, b) => (scores[b] || 0) - (scores[a] || 0));
      
      let initialTab = sortedTabs[0];
      // If safety is the top score but there are 0 incidents, promote the 2nd highest score
      if (initialTab === 'safety' && raw.crimeCount === 0) {
        initialTab = sortedTabs[1];
      }
      
      setActiveTab(initialTab);
    }
  }, [report, activeTab]);

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const renderAmenityList = (items: any[], category: string) => {
    const isExpanded = expandedCategories.has(category);
    const visibleItems = isExpanded ? items : items.slice(0, 5);
    const hasMore = items.length > 5;

    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {visibleItems.map((item: any, i: number) => (
            <li key={i} className="text-xs bg-white p-2 rounded-lg border border-border shadow-sm list-none">
              <p className="font-bold text-foreground line-clamp-1">{item.name}</p>
              <div className="flex justify-between items-center mt-1">
                <span className="text-[10px] text-muted-foreground uppercase">{item.category || category}</span>
                <span className="font-medium text-primary">{item.distance}km</span>
              </div>
            </li>
          ))}
        </div>
        {hasMore && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full text-xs text-primary hover:text-primary/80 h-8"
            onClick={() => toggleCategory(category)}
          >
            {isExpanded ? "Show Less" : `Show More (${items.length - 5} more)`}
          </Button>
        )}
      </div>
    );
  };
  const [email, setEmail] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const { toast } = useToast();
  const reportRef = useRef<HTMLDivElement>(null);

  const reportUrl = `${window.location.origin}/report/${id}`;

  const exportAsImage = async () => {
    if (!reportRef.current || !report) return;
    try {
      // toPng struggles with iframes. We hide them during export and show a placeholder or just accept the blank space.
      // Better yet, we can try to use static map images for exports in the future.
      const dataUrl = await toPng(reportRef.current, { 
        cacheBust: true,
        backgroundColor: '#f9fafb',
        // Filter out iframes from the export as they cause issues and often appear blank
        filter: (node) => node.tagName !== 'IFRAME'
      });
      const link = document.createElement('a');
      link.download = `ScoreMyStreet-${report.postcode}.png`;
      link.href = dataUrl;
      link.click();
      toast({ title: "Image exported!", description: "Your report has been saved as an image." });
    } catch (err) {
      console.error(err);
      toast({ title: "Export failed", description: "Could not export as image.", variant: "destructive" });
    }
  };

  const exportAsPDF = async () => {
    if (!reportRef.current || !report) return;
    try {
      const dataUrl = await toPng(reportRef.current, { 
        cacheBust: true,
        backgroundColor: '#f9fafb',
        filter: (node) => node.tagName !== 'IFRAME'
      });
      
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(dataUrl);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      const pageHeight = pdf.internal.pageSize.getHeight();
      let remainingHeight = pdfHeight;
      let position = 0;

      pdf.addImage(dataUrl, 'PNG', 0, position, pdfWidth, pdfHeight);
      remainingHeight -= pageHeight;

      while (remainingHeight > 0) {
        position = remainingHeight - pdfHeight;
        pdf.addPage();
        pdf.addImage(dataUrl, 'PNG', 0, position, pdfWidth, pdfHeight);
        remainingHeight -= pageHeight;
      }
      
      pdf.save(`ScoreMyStreet-${report.postcode}.pdf`);
      toast({ title: "PDF exported!", description: "Your report has been saved as a PDF." });
    } catch (err) {
      console.error(err);
      toast({ title: "Export failed", description: "Could not export as PDF.", variant: "destructive" });
    }
  };

  const shareSocial = (platform: 'facebook' | 'twitter' | 'linkedin') => {
    if (!report) return;
    const url = encodeURIComponent(reportUrl);
    const text = encodeURIComponent(`Check out the liveability report for ${report.postcode} on ScoreMyStreet!`);
    const links = {
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
      twitter: `https://twitter.com/intent/tweet?url=${url}&text=${text}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`
    };
    window.open(links[platform], '_blank');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full space-y-6 text-center">
          <div className="relative w-32 h-32 mx-auto">
            <div className="absolute inset-0 border-4 border-primary/20 rounded-full animate-pulse"></div>
            <div className="absolute inset-0 border-t-4 border-primary rounded-full animate-spin"></div>
          </div>
          <h2 className="text-2xl font-display font-bold text-foreground">Analysing Area Data...</h2>
          <p className="text-muted-foreground">We're crunching numbers from Police, Ofsted, and Transport APIs.</p>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <AlertTriangle className="w-12 h-12 text-destructive mx-auto" />
          <h2 className="text-2xl font-bold">Report Not Found</h2>
          <Button onClick={() => setLocation("/")}>Return Home</Button>
        </div>
      </div>
    );
  }

  const scores = report.scores as any;
  const raw = report.rawMetrics as any;

  const getOverallGrade = (score: number) => {
    if (score >= 80) return "Outstanding";
    if (score >= 60) return "Good";
    if (score >= 40) return "Average";
    return "Poor";
  };

  const overallScore = Math.round(
    (0.25 * scores.transport) + 
    (0.35 * Math.sqrt(scores.safety) * 10) + 
    (0.20 * scores.schools) + 
    (0.20 * scores.amenities)
  );

  const copyToClipboard = () => {
    navigator.clipboard.writeText(reportUrl);
    setCopied(true);
    toast({
      title: "Link copied!",
      description: "Report URL has been copied to your clipboard.",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsSending(true);
    try {
      const res = await apiRequest("POST", "/api/share", {
        assessmentId: Number(id),
        email
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to send email");
      }

      toast({
        title: "Report shared!",
        description: `The link has been sent to ${email}`,
      });
      setIsShareModalOpen(false);
      setEmail("");
    } catch (err: any) {
      toast({
        title: "Sharing failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <Dialog open={isShareModalOpen} onOpenChange={setIsShareModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share & Export Report</DialogTitle>
            <DialogDescription>
              Share this liveability assessment for {report.postcode} with others or download a copy.
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
              <Button size="icon" variant="ghost" onClick={() => shareSocial('facebook')} title="Share on Facebook">
                <Facebook className="h-5 w-5 text-blue-600" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => shareSocial('twitter')} title="Share on Twitter">
                <Twitter className="h-5 w-5 text-sky-500" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => shareSocial('linkedin')} title="Share on LinkedIn">
                <Linkedin className="h-5 w-5 text-blue-700" />
              </Button>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Report Link</label>
              <div className="flex gap-2">
                <Input readOnly value={reportUrl} className="bg-muted h-10" />
                <Button size="icon" variant="outline" onClick={copyToClipboard} className="h-10 w-10 shrink-0">
                  {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground font-medium">Or email to yourself</span>
              </div>
            </div>

            <form onSubmit={handleShareEmail} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input 
                    type="email" 
                    placeholder="name@example.com" 
                    className="pl-9"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={isSending}>
                {isSending ? "Sending..." : "Send Report"}
              </Button>
            </form>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => {
              const params = new URLSearchParams(window.location.search);
              if (params.get('from') === 'compare') {
                const pc1 = params.get('pc1');
                const pc2 = params.get('pc2');
                const backUrl = pc1 && pc2 
                  ? `/compare?pc1=${encodeURIComponent(pc1)}&pc2=${encodeURIComponent(pc2)}`
                  : "/compare";
                setLocation(backUrl);
              } else {
                setLocation("/");
              }
            }}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-display font-bold text-foreground flex flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  {report.postcode}
                  <span className="text-sm font-normal text-muted-foreground px-2 py-0.5 bg-gray-100 rounded-md">
                    {raw.classification || "Residential Area"}
                  </span>
                </span>
                {(raw.street || raw.city) && (
                  <span className="text-sm font-normal text-muted-foreground">
                    {[raw.street, raw.city].filter(Boolean).join(", ")}
                  </span>
                )}
              </h1>
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setIsShareModalOpen(true)}>
            <Share2 className="w-4 h-4" />
            Share & Export
          </Button>
        </div>
      </header>

      <div ref={reportRef} className="bg-gray-50">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
          {/* Map Section */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Main Score Card */}
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-border flex flex-col items-center justify-center text-center lg:col-span-1">
              <h2 className="text-lg font-semibold text-muted-foreground mb-6 uppercase tracking-wider">Liveability Score</h2>
              <ScoreGauge score={overallScore} size="lg" />
              <div className="mt-6 space-y-1">
                <p className="text-2xl font-bold text-foreground">{getOverallGrade(overallScore)}</p>
                <p className="text-sm text-muted-foreground">Compared to national average</p>
                <div className="mt-4 pt-4 border-t border-border w-full">
                  <div className="space-y-3">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Calculation</p>
                    <div className="bg-gray-50 rounded-lg p-3 border border-border">
                      <p className="text-sm font-mono text-foreground leading-relaxed break-words">
                        <span className="text-primary font-bold">0.25</span>({Math.round(scores.transport)}<span className="text-[10px] text-muted-foreground ml-1">Tr</span>) + 
                        <span className="text-primary font-bold"> 0.35</span>√({Math.round(scores.safety)}<span className="text-[10px] text-muted-foreground ml-1">Sa</span>) + 
                        <span className="text-primary font-bold"> 0.20</span>({Math.round(scores.schools)}<span className="text-[10px] text-muted-foreground ml-1">Sc</span>) + 
                        <span className="text-primary font-bold"> 0.20</span>({Math.round(scores.amenities)}<span className="text-[10px] text-muted-foreground ml-1">Am</span>) = 
                        <span className="ml-2 font-bold text-lg text-primary">{overallScore}</span>
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground font-medium uppercase pt-1">
                      <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Tr: Transport</div>
                      <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-red-500" /> Sa: Safety</div>
                      <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-green-500" /> Sc: Schools</div>
                      <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Am: Amenities</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white rounded-2xl p-1 shadow-sm border border-border overflow-hidden relative group">
                <div className="w-full h-full min-h-[400px]">
                  <iframe
                    width="100%"
                    height="100%"
                    style={{ border: 0, minHeight: '400px' }}
                    loading="lazy"
                    allowFullScreen
                    referrerPolicy="no-referrer-when-downgrade"
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${Number(report.lng)-0.01}%2C${Number(report.lat)-0.01}%2C${Number(report.lng)+0.01}%2C${Number(report.lat)+0.01}&layer=mapnik&marker=${report.lat}%2C${report.lng}`}
                  ></iframe>
                  <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full border border-border shadow-sm flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-primary" />
                    <span className="text-xs font-medium text-foreground">Centered on {report.postcode}</span>
                  </div>
                </div>
              </div>

              {/* Council Tax Section */}
              {raw.councilTax && (
                <Card className="bg-white border-none shadow-sm overflow-hidden">
                  <div className="p-6 flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-blue-50 rounded-xl text-blue-600">
                        <Receipt className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold">Local Council Tax</h3>
                        <p className="text-sm text-muted-foreground">
                          Estimated band for properties in <span className="font-semibold">{report.postcode}</span>: 
                          <span className="ml-1 text-foreground font-bold">Band {raw.councilTax.estimatedBand}</span>
                        </p>
                      </div>
                    </div>
                    <a 
                      href={raw.councilTax.lookupUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="w-full md:w-auto"
                    >
                      <Button variant="outline" className="w-full gap-2">
                        Official Lookup
                        <ArrowRight className="w-4 h-4" />
                      </Button>
                    </a>
                  </div>
                </Card>
              )}
            </div>
          </section>

          {/* Detailed Metrics Grid & Analysis Grouped Together */}
          <section className="space-y-8">
            <div>
              <h3 className="text-xl font-display font-bold mb-6 px-1">Performance Breakdown</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <MetricCard
                  title="Transport"
                  score={scores.transport}
                  icon={<Bus className="w-6 h-6" />}
                  description={`${raw.transport?.busStopCount || 0} bus stops & ${raw.transport?.stationCount || 0} stations nearby`}
                  status={getOverallGrade(scores.transport)}
                  isActive={activeTab === 'transport'}
                  onClick={() => setActiveTab('transport')}
                />
                <MetricCard
                  title="Safety"
                  score={scores.safety}
                  icon={<Shield className="w-6 h-6" />}
                  description={`${raw.crimeCount || 0} incidents reported in the last 12 months (within 1km)`}
                  status={getOverallGrade(scores.safety)}
                  trend={raw.crimeTrend === 'up' ? 'up' : 'down'}
                  isActive={activeTab === 'safety'}
                  onClick={() => setActiveTab('safety')}
                />
                <MetricCard
                  title="Schools"
                  score={scores.schools}
                  icon={<GraduationCap className="w-6 h-6" />}
                  description={`${raw.schools?.count || 0} schools nearby`}
                  status={getOverallGrade(scores.schools)}
                  isActive={activeTab === 'schools'}
                  onClick={() => setActiveTab('schools')}
                />
                <MetricCard
                  title="Amenities"
                  score={scores.amenities}
                  icon={<Store className="w-6 h-6" />}
                  description={`${raw.amenities?.totalCount || 0} shops, parks, and services`}
                  status={getOverallGrade(scores.amenities)}
                  isActive={activeTab === 'amenities'}
                  onClick={() => setActiveTab('amenities')}
                />
              </div>
            </div>

            <section className="bg-white rounded-2xl shadow-sm border border-border overflow-hidden">
              <div className="p-6 border-b border-border">
                <h3 className="text-lg font-bold font-display flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  Detailed Analysis: <span className="capitalize">{activeTab || ''}</span>
                </h3>
              </div>
              
              <div className="p-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <div className="p-6 bg-gray-50 rounded-xl border border-border">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="font-semibold text-foreground text-sm uppercase tracking-wide">Category Score</h4>
                        <span className="text-2xl font-bold text-primary">{activeTab ? Math.round(scores[activeTab]) : 0}/100</span>
                      </div>
                      <div className="prose prose-sm text-muted-foreground">
                        <p>
                          The rating is calculated based on proximity, quantity, and quality of local services relative to national averages.
                        </p>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <h4 className="font-semibold text-foreground text-sm uppercase tracking-wide">Key Statistics</h4>
                      <div className="p-4 bg-gray-50 rounded-xl border border-border">
                        <p className="text-xs text-muted-foreground mb-1">Primary Metric</p>
                        <p className="text-xl font-bold text-foreground">
                          {activeTab === 'safety' ? `${raw.crimeCount} incidents` : 
                           activeTab === 'transport' ? `${(raw.transport?.busStopCount || 0) + (raw.transport?.stationCount || 0)} stops/stations` : 
                           activeTab === 'schools' ? `${raw.schools?.count || 0} educational facilities` : 
                           `${raw.amenities?.totalCount || 0} local services`}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="font-semibold text-foreground text-sm uppercase tracking-wide">Nearby Highlights</h4>
                    <div className="bg-gray-50 rounded-xl p-4 max-h-[400px] overflow-y-auto border border-border">
                      <ul className="space-y-2">
                        {activeTab === 'safety' && raw.safetyBreakdown && (
                          <div className="space-y-6">
                            <div className="space-y-3">
                              {[
                                { label: 'Violent & Weapons', value: raw.safetyBreakdown.violent, color: 'bg-red-500' },
                                { label: 'Theft & Burglary', value: raw.safetyBreakdown.theft, color: 'bg-orange-500' },
                                { label: 'Vehicle Crime', value: raw.safetyBreakdown.vehicle, color: 'bg-amber-500' },
                                { label: 'Drug Related', value: raw.safetyBreakdown.drugs, color: 'bg-blue-500' },
                                { label: 'Anti-Social Behavior', value: raw.safetyBreakdown.asb, color: 'bg-gray-500' },
                              ].map((item) => (
                                <div key={item.label} className="space-y-1">
                                  <div className="flex justify-between text-xs font-medium">
                                    <span>{item.label}</span>
                                    <span>{item.value}</span>
                                  </div>
                                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                                    <div 
                                      className={`${item.color} h-1.5 rounded-full`} 
                                      style={{ width: `${Math.min(100, (item.value / (raw.crimeCount || 1)) * 100)}%` }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {activeTab === 'transport' && (
                          <div className="space-y-6">
                            <div>
                              <h5 className="text-xs font-semibold text-muted-foreground uppercase mb-3">Stations</h5>
                              {renderAmenityList(raw.transport?.stations || [], 'station')}
                            </div>
                            <div>
                              <h5 className="text-xs font-semibold text-muted-foreground uppercase mb-3">Bus Stops</h5>
                              {renderAmenityList(raw.transport?.busStops || [], 'bus_stop')}
                            </div>
                          </div>
                        )}
                        {activeTab === 'schools' && (
                          <div className="space-y-6">
                            <div>
                              <h5 className="text-xs font-semibold text-muted-foreground uppercase mb-3">Primary & Nursery</h5>
                              {renderAmenityList(raw.schools?.primaryList || [], 'primary_school')}
                            </div>
                            <div>
                              <h5 className="text-xs font-semibold text-muted-foreground uppercase mb-3">Secondary & Higher</h5>
                              {renderAmenityList(raw.schools?.secondaryList || [], 'secondary_school')}
                            </div>
                          </div>
                        )}
                        {activeTab === 'amenities' && (
                          <div className="space-y-6">
                            {Object.entries(
                              (raw.amenities?.list || []).reduce((acc: any, item: any) => {
                                const cat = item.category || 'other';
                                if (!acc[cat]) acc[cat] = [];
                                acc[cat].push(item);
                                return acc;
                              }, {})
                            ).map(([category, items]: [string, any]) => (
                              <div key={category}>
                                <h5 className="text-xs font-semibold text-muted-foreground uppercase mb-3">{category.replace(/_/g, ' ')}</h5>
                                {renderAmenityList(items, category)}
                              </div>
                            ))}
                          </div>
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </section>

          {/* Connectivity Section */}
          <section className="space-y-6">
            <h3 className="text-xl font-display font-bold px-1">Digital Connectivity</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="bg-white border-border shadow-sm">
                <CardContent className="p-6">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600">
                      <Wifi className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-bold">Broadband Availability</h4>
                      <p className="text-sm text-muted-foreground">Local infrastructure status</p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    {raw.connectivity?.broadband.map((b: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-border">
                        <div>
                          <p className="text-sm font-bold text-foreground">{b.type}</p>
                          <p className="text-xs text-muted-foreground">Up to {b.speed}</p>
                        </div>
                        <span className="text-xs font-bold px-2 py-1 bg-emerald-100 text-emerald-700 rounded-md">
                          {b.availability}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-white border-border shadow-sm">
                <CardContent className="p-6">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="p-3 bg-indigo-50 rounded-xl text-indigo-600">
                      <Signal className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-bold">Mobile Coverage</h4>
                      <p className="text-sm text-muted-foreground">Indoor & Outdoor signal</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-gray-50 rounded-xl border border-border text-center">
                      <p className="text-xs font-bold text-muted-foreground uppercase mb-2">4G Coverage</p>
                      <p className="text-xl font-bold text-emerald-600">{raw.connectivity?.mobile.fourG}</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-xl border border-border text-center">
                      <p className="text-xs font-bold text-muted-foreground uppercase mb-2">5G Coverage</p>
                      <p className="text-xl font-bold text-indigo-600">{raw.connectivity?.mobile.fiveG}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>

          {/* Nearest Neighbourhoods */}
          {raw.nearestPostcodes && raw.nearestPostcodes.length > 0 && (
            <div className="pt-8 border-t border-border">
              <h3 className="text-lg font-display font-bold mb-4">Nearby Neighbourhoods</h3>
              <div className="flex flex-wrap gap-3">
                {raw.nearestPostcodes.map((pc: string) => (
                  <Button 
                    key={pc} 
                    variant="outline" 
                    size="sm" 
                    className="bg-white hover:bg-gray-100"
                    onClick={() => {
                      // Navigate back to home with the postcode to trigger a new search
                      setLocation(`/?postcode=${pc}`);
                    }}
                  >
                    {pc}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
