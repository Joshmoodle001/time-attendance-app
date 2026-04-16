import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      // Default to a text input when type is not provided. Explicitly
      // specifying a default helps ensure consistent behavior across
      // browsers and avoids unintended fallbacks (e.g., password or
      // number). Consumers can still override this by passing a
      // different `type` value.
      type = "text",
      // Use `autoComplete` to control browser autofill. Many forms in
      // the dashboard collect sensitive or unique identifiers (employee
      // codes, national IDs). Setting a sensible default such as
      // "off" prevents browsers from suggesting unrelated data. Callers
      // can override this by passing their own `autoComplete` prop.
      autoComplete = "off",
      ...props
    },
    ref
  ) => {
    return (
      <input
        type={type}
        autoComplete={autoComplete}
        className={cn(
          "flex h-11 w-full rounded-xl border border-white/10 bg-[#0d1117] px-3.5 py-2.5 text-[15px] leading-6 text-white ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };