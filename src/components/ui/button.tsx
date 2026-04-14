/* eslint-disable react-refresh/only-export-components */
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-[14px] font-semibold tracking-[0.01em] ring-offset-background transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.985]",
  {
    variants: {
      variant: {
        default: "border border-cyan-500/30 bg-gradient-to-r from-cyan-600 to-cyan-700 text-white hover:from-cyan-500 hover:to-cyan-600 shadow-[0_4px_12px_rgba(0,212,255,0.2)] hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(0,212,255,0.3)]",
        destructive: "border border-red-900/50 bg-red-900/80 text-white hover:bg-red-800/80",
        outline: "border border-white/20 bg-white/5 text-white hover:bg-white/10 hover:border-cyan-500/30 hover:shadow-[0_0_15px_rgba(0,212,255,0.2)]",
        secondary: "border border-white/10 bg-white/5 text-white hover:bg-white/10",
        ghost: "text-slate-300 hover:bg-white/10 hover:text-white",
        link: "text-cyan-400 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-5 py-2.5",
        sm: "h-9 rounded-xl px-3 text-[13px]",
        lg: "h-12 rounded-xl px-8 text-[15px]",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
