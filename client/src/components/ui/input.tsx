import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-[hsl(210,20%,92%)] placeholder:text-[hsl(215,20%,40%)] transition-all duration-200 focus-visible:outline-none focus-visible:border-[hsl(217,91%,60%)] focus-visible:ring-2 focus-visible:ring-[hsla(217,91%,60%,0.25)] focus-visible:bg-[rgba(255,255,255,0.06)] disabled:cursor-not-allowed disabled:opacity-40 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
