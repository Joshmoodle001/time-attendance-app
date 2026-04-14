/* eslint-disable react-refresh/only-export-components */
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.04em] transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border border-cyan-500/30 bg-cyan-500/20 text-cyan-300",
        secondary: "border border-white/10 bg-white/5 text-slate-300",
        destructive: "border border-red-500/30 bg-red-500/20 text-red-300",
        outline: "border border-white/20 bg-white/5 text-slate-300",
        success: "border border-emerald-500/30 bg-emerald-500/20 text-emerald-300",
        warning: "border border-amber-500/30 bg-amber-500/20 text-amber-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
