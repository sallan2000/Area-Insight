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
  Download,
  ShoppingCart,
  ShoppingBag,
  Building2,
  RefreshCw,
} from "lucide-react";
import { useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScoreGauge } from "@/components/ScoreGauge";
import { MetricCard } from "@/components/MetricCard";
import { LockedMap } from "@/components/LockedMap";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { UserMenu } from "@/components/UserMenu";
import { EnvironmentSection } from "@/components/report/EnvironmentSection";
import { ConnectivitySection } from "@/components/report/ConnectivitySection";
import { EvChargersSection } from "@/components/report/EvChargersSection";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@shared/routes";


export default function Report() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { data: report, isLoading, error } = useAssessment(Number(id));
  const { isAuthenticated } = useAuth();
  const [isRefreshing, setIsRefreshing] = useState(false);
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
                <span className="text-[10px] text-muted-foreground uppercase">{(item.category || category).replace(/_/g, ' ')}</span>
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
  const handleRefresh = async () => {
    if (!report) return;
    setIsRefreshing(true);
    try {
      const res = await apiRequest("POST", `/api/assess/${id}/refresh`, {});
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Refresh failed");
      }
      await queryClient.invalidateQueries({ queryKey: [api.assess.get.path, Number(id)] });
      toast({ title: "Report refreshed!", description: "Latest data has been fetched for this area." });
    } catch (err: any) {
      toast({ title: "Refresh failed", description: err.message, variant: "destructive" });
    } finally {
      setIsRefreshing(false);
    }
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
      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(reportRef.current, { 
        cacheBust: true,
        backgroundColor: '#f9fafb',
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
      const [{ toPng }, { jsPDF }] = await Promise.all([
        import('html-to-image'),
        import('jspdf'),
      ]);
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
    window.open(links[platform as keyof typeof links], '_blank');
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

  const safetyViolent = raw.safetyBreakdown?.violent || 0;
  const safetyTheft   = raw.safetyBreakdown?.theft   || 0;
  const safetyVehicle = raw.safetyBreakdown?.vehicle || 0;
  const safetyDrugs   = raw.safetyBreakdown?.drugs   || 0;
  const safetyAsb     = raw.safetyBreakdown?.asb     || 0;
  const safetyOther   = Math.max(0, (raw.crimeCount || 0) - (safetyViolent + safetyTheft + safetyVehicle + safetyDrugs + safetyAsb));
  const safetyBreakdownItems = [
    { label: 'Violent & Weapons',     value: safetyViolent,  color: 'bg-red-500' },
    { label: 'Theft & Burglary',      value: safetyTheft,    color: 'bg-orange-500' },
    { label: 'Vehicle Crime',         value: safetyVehicle,  color: 'bg-amber-500' },
    { label: 'Drug Related',          value: safetyDrugs,    color: 'bg-blue-500' },
    { label: 'Anti-Social Behaviour', value: safetyAsb,      color: 'bg-gray-500' },
    ...(safetyOther > 0 ? [{ label: 'Other', value: safetyOther, color: 'bg-slate-400' }] : []),
  ];

  const getOverallGrade = (score: number) => {
    if (score >= 80) return "Outstanding";
    if (score >= 60) return "Good";
    if (score >= 40) return "Average";
    return "Poor";
  };

  const safetyExcluded = !!(raw?.crimeDataUnavailable);
  const overallScore = Math.round(
    safetyExcluded
      ? (scores.transport * (25 / 65)) + (scores.amenities * (20 / 65)) + (scores.schools * (20 / 65))
      : (0.25 * scores.transport) + (0.35 * Math.sqrt(scores.safety) * 10) + (0.20 * scores.schools) + (0.20 * scores.amenities)
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
                <svg className="h-5 w-5 text-blue-600" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              </Button>
              <Button size="icon" variant="ghost" onClick={() => shareSocial('twitter')} title="Share on Twitter">
                <svg className="h-5 w-5 text-sky-500" fill="currentColor" viewBox="0 0 24 24"><path d="M23.953 4.57a10 10 0 002.856 2.871c-.025.355-.049.71-.049 1.067a10.064 10.064 0 01-10.033 10.034c-3.181 0-6.156-1.003-8.614-2.863.324.037.636.074.924.074a7.1 7.1 0 004.010-1.229 3.543 3.543 0 01-3.296-2.456 3.542 3.542 0 001.604-.896 3.542 3.542 0 01-2.812-3.474 3.54 3.54 0 00.611 1.598A3.53 3.53 0 00.27 12.8a10.055 10.055 0 008.063-2.853 3.543 3.543 0 01-.987-4.735c1.164-1.165 3.025-1.165 4.188 0a3.5 3.5 0 012.516 1.08 7.082 7.082 0 002.155-2.773c-.299.934-.922 1.729-1.77 2.235a7.134 7.134 0 002.019-.584 7.15 7.15 0 01-1.767 1.838z"/></svg>
              </Button>
              <Button size="icon" variant="ghost" onClick={() => shareSocial('linkedin')} title="Share on LinkedIn">
                <svg className="h-5 w-5 text-blue-700" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.475-2.236-1.986-2.236-1.081 0-1.722.722-2.004 1.418-.103.249-.129.597-.129.946v5.441h-3.554s.05-8.736 0-9.646h3.554v1.364c.43-.664 1.199-1.608 2.925-1.608 2.135 0 3.735 1.39 3.735 4.38v5.51zM5.337 9.432c-1.144 0-1.915-.758-1.915-1.708 0-.951.77-1.708 1.915-1.708 1.144 0 1.915.757 1.915 1.708 0 .95-.771 1.708-1.915 1.708zm1.946 11.02H3.391V9.806h3.892v10.646zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"/></svg>
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
          <div className="flex items-center gap-2">
            {(report.partialData || (isAuthenticated && report.lastSearchedAt && (Date.now() - new Date(report.lastSearchedAt).getTime()) > 24 * 60 * 60 * 1000)) && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-50"
                onClick={handleRefresh}
                disabled={isRefreshing}
                data-testid="button-refresh-report"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
                {isRefreshing ? "Refreshing..." : "Refresh data"}
              </Button>
            )}
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setIsShareModalOpen(true)}>
              <Share2 className="w-4 h-4" />
              Share & Export
            </Button>
            <UserMenu />
          </div>
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
                      {safetyExcluded ? (
                        <p className="text-sm font-mono text-foreground leading-relaxed break-words">
                          <span className="text-primary font-bold">0.38</span>({Math.round(scores.transport)}<span className="text-[10px] text-muted-foreground ml-1">Tr</span>) + 
                          <span className="text-primary font-bold"> 0.31</span>({Math.round(scores.schools)}<span className="text-[10px] text-muted-foreground ml-1">Sc</span>) + 
                          <span className="text-primary font-bold"> 0.31</span>({Math.round(scores.amenities)}<span className="text-[10px] text-muted-foreground ml-1">Am</span>) = 
                          <span className="ml-2 font-bold text-lg text-primary">{overallScore}</span>
                        </p>
                      ) : (
                        <p className="text-sm font-mono text-foreground leading-relaxed break-words">
                          <span className="text-primary font-bold">0.25</span>({Math.round(scores.transport)}<span className="text-[10px] text-muted-foreground ml-1">Tr</span>) + 
                          <span className="text-primary font-bold"> 0.35</span>√({Math.round(scores.safety)}<span className="text-[10px] text-muted-foreground ml-1">Sa</span>) + 
                          <span className="text-primary font-bold"> 0.20</span>({Math.round(scores.schools)}<span className="text-[10px] text-muted-foreground ml-1">Sc</span>) + 
                          <span className="text-primary font-bold"> 0.20</span>({Math.round(scores.amenities)}<span className="text-[10px] text-muted-foreground ml-1">Am</span>) = 
                          <span className="ml-2 font-bold text-lg text-primary">{overallScore}</span>
                        </p>
                      )}
                    </div>
                    {safetyExcluded && (
                      <p className="text-[10px] text-amber-600 font-medium text-center pt-1">
                        Safety excluded — crime data not available in Scotland
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground font-medium uppercase pt-1">
                      <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Tr: Transport</div>
                      <div className={`flex items-center gap-1.5 ${safetyExcluded ? "opacity-40 line-through" : ""}`}><div className="w-1.5 h-1.5 rounded-full bg-red-500" /> Sa: Safety</div>
                      <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-green-500" /> Sc: Schools</div>
                      <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Am: Amenities</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white rounded-2xl p-1 shadow-sm border border-border overflow-hidden relative group">
                <LockedMap lat={Number(report.lat)} lng={Number(report.lng)} postcode={report.postcode} />
                <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full border border-border shadow-sm flex items-center gap-2 z-10">
                  <MapPin className="w-4 h-4 text-primary" />
                  <span className="text-xs font-medium text-foreground">Centered on {report.postcode}</span>
                </div>
              </div>

              {/* Council Tax Section */}
              {raw.councilTax && (
                <Card className="bg-white border-none shadow-sm overflow-hidden" data-testid="card-council-tax">
                  <div className="p-6 flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-blue-50 rounded-xl text-blue-600">
                        <Receipt className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold">Local Council Tax</h3>
                        <p className="text-sm text-muted-foreground">
                          {(raw.councilTax.source === "VOA (2024)" || raw.councilTax.source?.startsWith("SAA")) ? "Most common band" : "Estimated band"} for properties in <span className="font-semibold">{report.postcode}</span>: 
                          <span className="ml-1 text-foreground font-bold" data-testid="text-council-tax-band">Band {raw.councilTax.estimatedBand}</span>
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5" data-testid="text-council-tax-source">
                          Source: {raw.councilTax.source || "Estimated"}
                        </p>
                      </div>
                    </div>
                    <a 
                      href={raw.councilTax.lookupUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="w-full md:w-auto"
                    >
                      <Button variant="outline" className="w-full gap-2" data-testid="button-council-tax-lookup">
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
                  description={raw.overpassFailed ? "Map data temporarily unavailable" : `${raw.transport?.busStopCount || 0} bus stops & ${raw.transport?.stationCount || 0} stations nearby`}
                  status={getOverallGrade(scores.transport)}
                  isActive={activeTab === 'transport'}
                  onClick={() => setActiveTab('transport')}
                  overpassFailed={raw.overpassFailed}
                />
                <MetricCard
                  title="Safety"
                  score={scores.safety}
                  icon={<Shield className="w-6 h-6" />}
                  description={raw.crimeDataUnavailable ? "Crime data not available for Scotland" : `${raw.crimeCount || 0} incidents reported in the last 12 months`}
                  status={getOverallGrade(scores.safety)}
                  trend={raw.crimeDataUnavailable ? undefined : (raw.crimeTrend === 'up' ? 'up' : 'down')}
                  isActive={activeTab === 'safety'}
                  onClick={() => setActiveTab('safety')}
                  scoreUnavailable={raw.crimeDataUnavailable}
                />
                <MetricCard
                  title="Schools"
                  score={scores.schools}
                  icon={<GraduationCap className="w-6 h-6" />}
                  description={raw.overpassFailed ? "Map data temporarily unavailable" : `${raw.schools?.count || 0} schools nearby`}
                  status={getOverallGrade(scores.schools)}
                  isActive={activeTab === 'schools'}
                  onClick={() => setActiveTab('schools')}
                  overpassFailed={raw.overpassFailed}
                />
                <MetricCard
                  title="Amenities"
                  score={scores.amenities}
                  icon={<Store className="w-6 h-6" />}
                  description={raw.overpassFailed ? "Map data temporarily unavailable" : `${raw.amenities?.totalCount || 0} shops, eateries, and local services`}
                  status={getOverallGrade(scores.amenities)}
                  isActive={activeTab === 'amenities'}
                  onClick={() => setActiveTab('amenities')}
                  overpassFailed={raw.overpassFailed}
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
                        <span className="text-2xl font-bold text-primary">
                          {activeTab === 'safety' && raw.crimeDataUnavailable ? "N/A" : `${activeTab ? Math.round(scores[activeTab]) : 0}/100`}
                        </span>
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
                          {activeTab === 'safety' ? (raw.crimeDataUnavailable ? "No data" : `${raw.crimeCount} incidents`) : 
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
                        {activeTab === 'safety' && (
                          <div className="space-y-6">
                            {raw.crimeDataUnavailable && (
                              <div className="space-y-3">
                                <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
                                  <h5 className="text-sm font-bold text-amber-800 mb-1">Street-level crime data unavailable</h5>
                                  <p className="text-xs text-amber-700">
                                    Police Scotland does not publish street-level crime statistics through the national police.uk API. Safety is excluded from the liveability score for Scottish postcodes.
                                  </p>
                                </div>
                                {raw.scotCrimeContext && (
                                  <div className="p-4 bg-blue-50 rounded-xl border border-blue-200" data-testid="scot-crime-context">
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                      <h5 className="text-sm font-bold text-blue-800">Council Area Context</h5>
                                      <span className="text-[10px] font-semibold px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full whitespace-nowrap">Reference only</span>
                                    </div>
                                    <p className="text-xs text-blue-800 mb-3">
                                      In {raw.scotCrimeContext.year}, <span className="font-semibold">{raw.scotCrimeContext.council}</span> recorded{" "}
                                      <span className="font-bold">{raw.scotCrimeContext.ratePerThousand} crimes per 1,000 residents</span>{" "}
                                      (Scotland average: {raw.scotCrimeContext.scotlandAvgPerThousand} per 1,000).
                                    </p>
                                    <div className="w-full bg-blue-100 rounded-full h-1.5 mb-1">
                                      <div
                                        className="bg-blue-400 h-1.5 rounded-full"
                                        style={{ width: `${Math.min(100, (raw.scotCrimeContext.ratePerThousand / 100) * 100)}%` }}
                                      />
                                    </div>
                                    <p className="text-[10px] text-blue-600 mt-2">
                                      ⚠ This covers the entire {raw.scotCrimeContext.council} council area and is not specific to this postcode. It does not contribute to the liveability score. Source: Scottish Government, {raw.scotCrimeContext.year}.
                                    </p>
                                  </div>
                                )}
                              </div>
                            )}
                            {raw.neighbourhood && (
                              <div className="p-4 bg-primary/5 rounded-xl border border-primary/10 mb-4">
                                <h5 className="text-sm font-bold text-primary mb-1">Police Neighbourhood: {raw.neighbourhood.name}</h5>
                                {raw.neighbourhood.description && (
                                  <div 
                                    className="text-xs text-muted-foreground line-clamp-3"
                                    dangerouslySetInnerHTML={{ __html: raw.neighbourhood.description }}
                                  />
                                )}
                              </div>
                            )}
                            {!raw.crimeDataUnavailable && (
                              <div className="space-y-3">
                                {safetyBreakdownItems.map((item) => (
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
                            )}
                          </div>
                        )}
                        {activeTab === 'transport' && (
                          <div className="space-y-6">
                            {raw.overpassFailed && (
                              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 flex items-start gap-2" data-testid="notice-overpass-failed-transport">
                                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                                <p className="text-xs text-amber-700">Map data temporarily unavailable — scores may be lower than usual. Try refreshing the report later.</p>
                              </div>
                            )}
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
                            {raw.overpassFailed && (
                              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 flex items-start gap-2" data-testid="notice-overpass-failed-schools">
                                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                                <p className="text-xs text-amber-700">Map data temporarily unavailable — scores may be lower than usual. Try refreshing the report later.</p>
                              </div>
                            )}
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
                            {raw.overpassFailed && (
                              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 flex items-start gap-2" data-testid="notice-overpass-failed-amenities">
                                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                                <p className="text-xs text-amber-700">Map data temporarily unavailable — scores may be lower than usual. Try refreshing the report later.</p>
                              </div>
                            )}
                            {Object.entries(
                              (raw.amenities?.list || []).reduce((acc: any, item: any) => {
                                const cat = item.category || 'other';
                                if (!acc[cat]) acc[cat] = [];
                                acc[cat].push(item);
                                return acc;
                              }, {})
                            ).map(([category, items]: [string, any]) => {
                              const categoryIcons: Record<string, any> = {
                                supermarket: <ShoppingCart className="h-3.5 w-3.5" />,
                                convenience_store: <ShoppingBag className="h-3.5 w-3.5" />,
                                shopping_centre: <Building2 className="h-3.5 w-3.5" />,
                                department_store: <Store className="h-3.5 w-3.5" />,
                              };
                              const icon = categoryIcons[category] || null;
                              return (
                                <div key={category}>
                                  <h5 className="text-xs font-semibold text-muted-foreground uppercase mb-3 flex items-center gap-1.5">{icon}{category.replace(/_/g, ' ')}</h5>
                                  {renderAmenityList(items, category)}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </section>

          {/* Environment Section */}
          {raw.environment && (
            <EnvironmentSection environment={raw.environment} />
          )}

          {raw.connectivity && (
            <ConnectivitySection connectivity={raw.connectivity} />
          )}

          {raw.evChargers && (
            <EvChargersSection evChargers={raw.evChargers} />
          )}

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
