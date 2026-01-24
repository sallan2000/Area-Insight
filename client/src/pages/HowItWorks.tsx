import { motion } from "framer-motion";
import { ArrowLeft, Shield, Bus, GraduationCap, Store, Calculator, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function HowItWorks() {
  const factors = [
    {
      icon: Shield,
      title: "Safety & Security",
      weight: "35%",
      description: "Analyses crime density and severity over the last 12 months within a 1km radius."
    },
    {
      icon: Bus,
      title: "Transport Links",
      weight: "25%",
      description: "Evaluates proximity to train stations, bus stop density, and commute times to city centres."
    },
    {
      icon: GraduationCap,
      title: "School Quality",
      weight: "20%",
      description: "Considers the quantity and proximity of local primary and secondary educational facilities."
    },
    {
      icon: Store,
      title: "Local Amenities",
      weight: "20%",
      description: "Measures access to cafes, restaurants, pharmacies, and other essential local services."
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <h1 className="text-2xl font-display font-bold text-foreground">How It Works</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12 space-y-16">
        <section className="text-center space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium"
          >
            <Calculator className="w-4 h-4" />
            The Liveability Formula
          </motion.div>
          <h2 className="text-4xl font-display font-bold text-foreground">Scientific Neighbourhood Assessment</h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            ScoreMyStreet uses a proprietary weighted formula to turn raw data into an easy-to-understand 0-100 score.
          </p>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {factors.map((factor, index) => (
            <motion.div
              key={factor.title}
              initial={{ opacity: 0, x: index % 2 === 0 ? -20 : 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card className="h-full border-none shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="p-2 bg-primary/5 rounded-lg">
                      <factor.icon className="w-6 h-6 text-primary" />
                    </div>
                    <span className="text-sm font-bold text-primary px-2 py-1 bg-primary/10 rounded-md">
                      {factor.weight} Weighting
                    </span>
                  </div>
                  <h3 className="text-xl font-bold">{factor.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {factor.description}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </section>

        <section className="bg-white rounded-3xl p-8 md:p-12 shadow-sm border border-border space-y-8">
          <div className="space-y-4">
            <h3 className="text-2xl font-bold">The Weighted Calculation</h3>
            <p className="text-muted-foreground">
              Our liveability score (L) isn't just an average. We apply a sophisticated calculation that prioritises safety and accessibility to give you the most accurate indication of local life.
            </p>
          </div>

          <div className="bg-gray-50 rounded-2xl p-6 font-mono text-center overflow-x-auto">
            <span className="text-2xl md:text-3xl font-bold text-primary">
              L = 0.25T + 0.35√S + 0.20A + 0.20E
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span>T: Transport Connectivity</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span>S: Security (Safety) Metric</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span>A: Amenities Density</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span>E: Educational Facilities</span>
            </div>
          </div>
        </section>

        <section className="text-center space-y-6">
          <h3 className="text-2xl font-bold">What the Score Means</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="space-y-2">
              <div className="text-3xl font-bold text-emerald-600">80+</div>
              <p className="font-semibold">Outstanding</p>
              <p className="text-xs text-muted-foreground px-4">Top-tier facilities, high safety, and perfect transport links.</p>
            </div>
            <div className="space-y-2">
              <div className="text-3xl font-bold text-blue-600">60-79</div>
              <p className="font-semibold">Good</p>
              <p className="text-xs text-muted-foreground px-4">Highly liveable with some minor compromises in specific categories.</p>
            </div>
            <div className="space-y-2">
              <div className="text-3xl font-bold text-amber-600">40-59</div>
              <p className="font-semibold">Average</p>
              <p className="text-xs text-muted-foreground px-4">Typical urban or suburban metrics consistent with national norms.</p>
            </div>
          </div>
        </section>

        <section className="pt-8 text-center border-t border-border">
          <Link href="/">
            <Button size="lg" className="rounded-xl px-8">
              Start Your Search
            </Button>
          </Link>
        </section>
      </main>
    </div>
  );
}
