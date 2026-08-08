import { motion } from "framer-motion";

interface ScoreGaugeProps {
  score: number; // 0-100
  size?: "sm" | "md" | "lg";
  label?: string;
  showLabel?: boolean;
}

export function ScoreGauge({ score, size = "md", label, showLabel = true }: ScoreGaugeProps) {
  // Determine color based on score
  const getColor = (val: number) => {
    if (val >= 80) return "text-emerald-500";
    if (val >= 60) return "text-blue-500";
    if (val >= 40) return "text-yellow-500";
    return "text-red-500";
  };

  const getRingColor = (val: number) => {
    if (val >= 80) return "stroke-emerald-500";
    if (val >= 60) return "stroke-blue-500";
    if (val >= 40) return "stroke-yellow-500";
    return "stroke-red-500";
  };

  const dimensions = {
    sm: { width: 60, stroke: 4, text: "text-sm" },
    md: { width: 120, stroke: 8, text: "text-3xl" },
    lg: { width: 180, stroke: 12, text: "text-5xl" },
  };

  const dim = dimensions[size];
  const radius = (dim.width - dim.stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-center">
      <div className={`relative flex items-center justify-center ${size === 'sm' ? 'w-[60px] h-[60px]' : size === 'lg' ? 'w-[180px] h-[180px]' : 'w-[120px] h-[120px]'}`}>
        {/* Background Ring */}
        <svg className="transform -rotate-90 w-full h-full">
          <circle
            cx="50%"
            cy="50%"
            r={radius}
            stroke="currentColor"
            strokeWidth={dim.stroke}
            fill="transparent"
            className="text-gray-100"
          />
          {/* Progress Ring */}
          <motion.circle
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.5, ease: "easeOut" }}
            cx="50%"
            cy="50%"
            r={radius}
            stroke="currentColor"
            strokeWidth={dim.stroke}
            fill="transparent"
            strokeDasharray={circumference}
            strokeLinecap="round"
            className={getRingColor(score)}
          />
        </svg>
        
        {/* Score Text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span 
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className={`font-display font-bold ${dim.text} ${getColor(score)}`}
          >
            {score}
          </motion.span>
        </div>
      </div>
      
      {showLabel && label && (
        <span className="mt-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      )}
    </div>
  );
}
