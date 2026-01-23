import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, CheckCircle2 } from "lucide-react";

interface LoadingModalProps {
  isOpen: boolean;
}

export function LoadingModal({ isOpen }: LoadingModalProps) {
  const statuses = [
    { label: "Finding nearest transport links", id: "transport" },
    { label: "Searching law enforcement data", id: "safety" },
    { label: "Determining closest schools", id: "schools" },
    { label: "Assessing local amenities", id: "amenities" },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-[425px] outline-none" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-center font-display text-2xl">Analysing Area</DialogTitle>
        </DialogHeader>
        <div className="py-6 space-y-6">
          <div className="flex justify-center mb-8">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 border-4 border-primary/20 rounded-full"></div>
              <div className="absolute inset-0 border-t-4 border-primary rounded-full animate-spin"></div>
            </div>
          </div>
          <div className="space-y-4">
            {statuses.map((status) => (
              <div key={status.id} className="flex items-center justify-between group">
                <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                  {status.label}
                </span>
                <Loader2 className="h-4 w-4 text-primary animate-spin opacity-50" />
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground animate-pulse mt-6">
            Connecting to UK Open Data portals...
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
