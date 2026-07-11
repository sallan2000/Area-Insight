"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"
import { setRule, removeRule } from "@/lib/dynamic-styles"

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => {
  const uid = React.useId().replace(/:/g, "")

  React.useEffect(() => {
    setRule(
      `progress-${uid}`,
      `[data-progress-id="${uid}"] { transform: translateX(-${100 - (value || 0)}%); }`,
    )
    return () => removeRule(`progress-${uid}`)
  }, [uid, value])

  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn(
        "relative h-4 w-full overflow-hidden rounded-full bg-secondary",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-progress-id={uid}
        className="h-full w-full flex-1 bg-primary transition-all"
      />
    </ProgressPrimitive.Root>
  )
})
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
