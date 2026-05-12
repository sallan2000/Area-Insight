import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ScoreGauge } from "./ScoreGauge";

interface MetricCardProps {
  title: string;
  score: number;
  icon: ReactNode;
  description?: string;
  status: string;
  trend?: "up" | "down" | "flat";
  onClick?: () => void;
  isActive?: boolean;
  scoreUnavailable?: boolean;
  overpassFailed?: boolean;
}

export function MetricCard({ 
  title, 
  score, 
  icon, 
  description, 
  status, 
  trend,
  onClick,
  isActive,
  scoreUnavailable,
  overpassFailed
}: MetricCardProps) {
  return (
    <div 
      onClick={onClick}
      className={cn(
        "bg-white rounded-2xl p-6 border transition-all duration-300 cursor-pointer relative overflow-hidden group",
        isActive 
          ? "border-primary shadow-lg ring-1 ring-primary/10" 
          : "border-border shadow-sm hover:shadow-md hover:border-primary/50"
      )}
    >
      <div className="flex justify-between items-start mb-4">
        <div className="p-3 bg-primary/5 rounded-xl text-primary group-hover:bg-primary group-hover:text-white transition-colors duration-300">
          {icon}
        </div>
        {scoreUnavailable ? (
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 border border-gray-200">
            <span className="text-sm font-bold text-gray-400">N/A</span>
          </div>
        ) : (
          <ScoreGauge score={score} size="sm" showLabel={false} />
        )}
      </div>
      
      <div>
        <h3 className="text-lg font-bold font-display text-foreground mb-1">{title}</h3>
        <div className="flex items-center gap-2 mb-2">
          <span className={cn(
            "text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide",
            scoreUnavailable ? "bg-gray-100 text-gray-500" :
            score >= 80 ? "bg-emerald-100 text-emerald-700" :
            score >= 60 ? "bg-blue-100 text-blue-700" :
            score >= 40 ? "bg-yellow-100 text-yellow-700" :
            "bg-red-100 text-red-700"
          )}>
            {scoreUnavailable ? "No data" : status}
          </span>
          {!scoreUnavailable && trend && (
            <span className="text-xs text-muted-foreground">
              {trend === 'up' ? '↗ Improving' : trend === 'down' ? '↘ Declining' : '→ Stable'}
            </span>
          )}
        </div>
        {description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{description}</p>
        )}
      </div>
    </div>
  );
}
