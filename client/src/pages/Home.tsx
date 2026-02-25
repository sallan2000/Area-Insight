import { useState, useEffect } from "react";
import { useCreateAssessment } from "@/hooks/use-assess";
import { Search, MapPin, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { LoadingModal } from "@/components/LoadingModal";

export default function Home() {
  const [postcode, setPostcode] = useState("");
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const { mutate, isPending } = useCreateAssessment();
  const { toast } = useToast();

  const handleAssessment = (pc: string) => {
    const cleanPostcode = pc.trim().toUpperCase();
    const postcodeRegex = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i;

    if (!cleanPostcode) {
      toast({
        title: "Postcode required",
        description: "Please enter a UK postcode.",
        variant: "destructive",
      });
      return;
    }

    if (!postcodeRegex.test(cleanPostcode)) {
      toast({
        title: "Invalid postcode",
        description: "Please enter a valid UK postcode format.",
        variant: "destructive",
      });
      return;
    }
    
    setCompletedSteps([]);
    
    // Simulate progress for UX
    const steps = ["transport", "safety", "schools", "amenities"];
    steps.forEach((step, index) => {
      setTimeout(() => {
        setCompletedSteps(prev => [...prev, step]);
      }, (index + 1) * 800);
    });

    mutate({ postcode: cleanPostcode }, {
      onError: (error: any) => {
        setCompletedSteps([]);
        toast({
          title: "Postcode lookup failed",
          description: error.message.includes("Invalid postcode") 
            ? "The postcode you entered is not a recognized UK postcode. Please check for typos and try again."
            : error.message,
          variant: "destructive",
        });
      }
    });
  };

  // Handle automatic search from URL params (for nearest postcodes)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pc = params.get('postcode');
    if (pc) {
      setPostcode(pc);
      handleAssessment(pc);
      // Clean up URL params after search
      window.history.replaceState({}, '', '/');
    }
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    handleAssessment(postcode);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-blue-50/50 to-indigo-50/30 flex flex-col">
      <LoadingModal isOpen={isPending} completedSteps={completedSteps} />
      {/* Navigation */}
      <nav className="w-full max-w-7xl mx-auto px-6 py-6 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="bg-primary text-white p-2 rounded-lg">
            <MapPin className="h-5 w-5" />
          </div>
          <span className="font-display font-bold text-xl tracking-tight">ScoreMyStreet</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="/compare" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Compare Areas
          </a>
          <a href="/how-it-works" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            How it works
          </a>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 pb-20 relative overflow-hidden">
        {/* Abstract background blobs */}
        <div className="absolute top-1/4 -left-20 w-96 h-96 bg-blue-400/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 -right-20 w-80 h-80 bg-emerald-400/10 rounded-full blur-3xl pointer-events-none" />

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="max-w-3xl w-full text-center space-y-8 z-10"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-border shadow-sm text-sm font-medium text-muted-foreground">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500"></span>
            Live UK Data Analysis
          </div>
          
          <h1 className="text-4xl sm:text-5xl md:text-7xl font-display font-bold text-foreground tracking-tight text-balance">
            Discover the truth about <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-600">your neighbourhood</span>
          </h1>
          
          <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto text-balance">
            Instantly analyse any UK postcode for crime rates, transport links, school quality, and local amenities. Get the real data before you move.
          </p>

          <motion.form 
            onSubmit={handleSearch}
            className="w-full max-w-md mx-auto relative group px-2 sm:px-0"
            whileHover={{ scale: 1.01 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-blue-600/20 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            
            <div className="relative flex flex-col sm:flex-row items-stretch sm:items-center bg-white rounded-2xl p-2 shadow-xl shadow-blue-900/5 border border-border focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 transition-all duration-300 gap-2 sm:gap-0">
              <div className="flex items-center flex-1">
                <Search className="ml-4 h-5 w-5 text-muted-foreground shrink-0" />
                <input 
                  type="text" 
                  placeholder="Enter a UK postcode (e.g. SW1A 1AA)" 
                  className="flex-1 min-w-0 px-4 py-3 bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/70 font-medium text-sm sm:text-base"
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value.toUpperCase())}
                  disabled={isPending}
                />
              </div>
              <button 
                type="submit" 
                disabled={isPending}
                className="bg-primary hover:bg-primary/90 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <span>Analyse</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </motion.form>

          <div className="pt-8 flex flex-wrap justify-center gap-8 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <div className="w-1 h-1 bg-muted-foreground rounded-full" />
              Police Data
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1 h-1 bg-muted-foreground rounded-full" />
              Ofsted Ratings
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1 h-1 bg-muted-foreground rounded-full" />
              Transport Links
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1 h-1 bg-muted-foreground rounded-full" />
              Local Amenities
            </div>
          </div>
        </motion.div>
      </main>

      {/* Decorative Footer */}
      <footer className="w-full py-6 text-center text-sm text-muted-foreground border-t border-border/50 bg-white/50 backdrop-blur-sm">
        <p>© 2025 ScoreMyStreet. Open Data powered.</p>
      </footer>
    </div>
  );
}
