import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  MapPin,
  ArrowRight,
  History as HistoryIcon,
  Shield,
  Bus,
  GraduationCap,
  Store,
} from "lucide-react";

export default function HistoryPage() {
  const [, setLocation] = useLocation();
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();

  const { data: assessments, isLoading } = useQuery({
    queryKey: ["/api/my-assessments"],
    queryFn: async () => {
      const res = await fetch("/api/my-assessments", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: isAuthenticated,
  });

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-white border-b sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <h1 className="text-2xl font-display font-bold text-foreground">My Searches</h1>
            </div>
            <UserMenu />
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4 max-w-md px-4">
            <HistoryIcon className="w-12 h-12 text-muted-foreground mx-auto" />
            <h2 className="text-xl font-bold">Log in to see your search history</h2>
            <p className="text-muted-foreground">
              When you're logged in, all your postcode searches are saved so you can revisit them later.
            </p>
            <a href="/api/login">
              <Button className="mt-4" data-testid="button-login-history">Log in</Button>
            </a>
          </div>
        </div>
      </div>
    );
  }

  const getScoreColour = (score: number) => {
    if (score >= 70) return "text-emerald-600";
    if (score >= 40) return "text-amber-600";
    return "text-red-600";
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-2xl font-display font-bold text-foreground">My Searches</h1>
          </div>
          <UserMenu />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-48 rounded-2xl" />
            ))}
          </div>
        ) : !assessments || assessments.length === 0 ? (
          <div className="text-center py-20 space-y-4">
            <HistoryIcon className="w-12 h-12 text-muted-foreground mx-auto opacity-50" />
            <h3 className="text-xl font-medium text-muted-foreground">No searches yet</h3>
            <p className="text-muted-foreground">
              Search for a UK postcode on the home page to start building your history.
            </p>
            <Button onClick={() => setLocation("/")} className="mt-4" data-testid="button-go-home">
              Search a postcode
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {assessments.map((a: any) => {
              const scores = a.scores as any;
              const raw = a.rawMetrics as any;
              const searchedDate = a.lastSearchedAt
                ? new Date(a.lastSearchedAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : "";

              return (
                <Card
                  key={a.id}
                  className="p-6 hover:shadow-md transition-shadow cursor-pointer group"
                  onClick={() => setLocation(`/report/${a.id}`)}
                  data-testid={`card-assessment-${a.id}`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-primary" />
                        <h3 className="text-lg font-bold" data-testid={`text-postcode-${a.id}`}>{a.postcode}</h3>
                      </div>
                      {(raw?.street || raw?.city) && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {[raw.street, raw.city].filter(Boolean).join(", ")}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <span className={`text-2xl font-black ${getScoreColour(scores?.total || 0)}`} data-testid={`text-score-${a.id}`}>
                        {scores?.total || 0}
                      </span>
                      <p className="text-[10px] text-muted-foreground uppercase">Overall</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2 mb-4">
                    <div className="text-center">
                      <Shield className="w-3.5 h-3.5 mx-auto text-muted-foreground mb-1" />
                      <span className="text-xs font-bold">{Math.round(scores?.safety || 0)}</span>
                    </div>
                    <div className="text-center">
                      <Bus className="w-3.5 h-3.5 mx-auto text-muted-foreground mb-1" />
                      <span className="text-xs font-bold">{Math.round(scores?.transport || 0)}</span>
                    </div>
                    <div className="text-center">
                      <GraduationCap className="w-3.5 h-3.5 mx-auto text-muted-foreground mb-1" />
                      <span className="text-xs font-bold">{Math.round(scores?.schools || 0)}</span>
                    </div>
                    <div className="text-center">
                      <Store className="w-3.5 h-3.5 mx-auto text-muted-foreground mb-1" />
                      <span className="text-xs font-bold">{Math.round(scores?.amenities || 0)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t">
                    <span className="text-xs text-muted-foreground">{searchedDate}</span>
                    <span className="text-xs text-primary font-medium group-hover:underline flex items-center gap-1">
                      View report <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
