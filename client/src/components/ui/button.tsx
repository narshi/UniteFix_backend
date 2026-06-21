import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(217,91%,60%)] focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.97]",
  {
    variants: {
      variant: {
        default: "bg-[hsl(217,91%,60%)] text-white hover:bg-[hsl(217,91%,55%)] shadow-lg shadow-[hsla(217,91%,60%,0.25)] hover:shadow-[hsla(217,91%,60%,0.35)]",
        destructive:
          "bg-[hsl(347,77%,50%)] text-white hover:bg-[hsl(347,77%,45%)] shadow-lg shadow-[hsla(347,77%,50%,0.25)]",
        outline:
          "border border-[rgba(255,255,255,0.1)] bg-transparent text-[hsl(210,20%,85%)] hover:bg-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.18)] hover:text-white",
        secondary:
          "bg-[rgba(255,255,255,0.06)] text-[hsl(210,20%,85%)] border border-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.1)] hover:text-white",
        ghost: "text-[hsl(210,20%,70%)] hover:bg-[rgba(255,255,255,0.06)] hover:text-white",
        link: "text-[hsl(217,91%,60%)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-lg px-3 text-xs",
        lg: "h-11 rounded-lg px-8",
        icon: "h-10 w-10",
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
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
