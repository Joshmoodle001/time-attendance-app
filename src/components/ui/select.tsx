import * as React from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  onValueChange?: (value: string) => void
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, onValueChange, onChange, value, ...props }, ref) => {
    return (
      <select
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-xl border border-white/10 bg-[#0d1117] px-3 py-2 text-sm text-white ring-offset-background placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange?.(e)
          onValueChange?.(e.target.value)
        }}
        {...props}
      >
        {children}
      </select>
    )
  }
)
Select.displayName = "Select"

interface SelectTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value?: string
  placeholder?: string
}

const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, children, value, placeholder, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-xl border border-white/10 bg-[#0d1117] px-3 py-2 text-sm text-white ring-offset-background placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      >
        {value ? children : <span className="text-slate-500">{placeholder || "Select..."}</span>}
        <ChevronDown className="h-4 w-4 opacity-50 text-slate-400" />
      </button>
    )
  }
)
SelectTrigger.displayName = "SelectTrigger"

interface SelectContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

const SelectContent = React.forwardRef<HTMLDivElement, SelectContentProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "relative z-50 min-w-[8rem] overflow-hidden rounded-xl border border-white/10 bg-[#12121a] text-white shadow-lg",
          className
        )}
        {...props}
      >
        <div className="max-h-60 overflow-y-auto p-1">{children}</div>
      </div>
    )
  }
)
SelectContent.displayName = "SelectContent"

interface SelectItemProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string
}

const SelectItem = React.forwardRef<HTMLDivElement, SelectItemProps>(
  ({ className, children, value, onClick, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="option"
        data-value={value}
        className={cn(
          "relative flex w-full cursor-pointer select-none items-center rounded-lg py-1.5 pl-8 pr-2 text-sm text-slate-300 outline-none hover:bg-cyan-500/20 hover:text-cyan-300",
          className
        )}
        onClick={(e) => {
          onClick?.(e)
        }}
        {...props}
      >
        {children}
      </div>
    )
  }
)
SelectItem.displayName = "SelectItem"

interface SelectValueProps {
  value?: string
  placeholder?: string
}

const SelectValue = ({ value, placeholder }: SelectValueProps) => {
  return <span>{value || placeholder || "Select..."}</span>
}

export { Select, SelectTrigger, SelectContent, SelectItem, SelectValue }
