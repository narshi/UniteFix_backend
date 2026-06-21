import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-[hsl(217,91%,60%)] focus:ring-offset-0",
  {
    variants: {
      variant: {
        default:
          "border-[hsla(217,91%,60%,0.3)] bg-[hsla(217,91%,60%,0.12)] text-[hsl(217,91%,70%)]",
        secondary:
          "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.06)] text-[hsl(210,20%,70%)]",
        destructive:
          "border-[hsla(347,77%,50%,0.3)] bg-[hsla(347,77%,50%,0.12)] text-[hsl(347,77%,65%)]",
        outline: "border-[rgba(255,255,255,0.1)] text-[hsl(210,20%,75%)] bg-transparent",
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
