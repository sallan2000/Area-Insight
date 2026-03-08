import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import Report from "@/pages/Report";
import Compare from "@/pages/Compare";
import HowItWorks from "@/pages/HowItWorks";
import HistoryPage from "@/pages/History";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/report/:id" component={Report} />
      <Route path="/compare" component={Compare} />
      <Route path="/how-it-works" component={HowItWorks} />
      <Route path="/history" component={HistoryPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
