import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
import "./styles/styles.css";
import "./button.css";

const pixelButtonVariants = cva(
  "pixel__button pixel-font cursor-pointer rounded-none w-fit items-center justify-center whitespace-nowrap text-xs transition-all duration-75",
  {
    variants: {
      variant: {
        default: "pixel-default__button box-shadow-margin",
        green: "pixel-green__button box-shadow-margin",
        secondary: "pixel-secondary__button box-shadow-margin",
        warning: "pixel-warning__button box-shadow-margin",
        success: "pixel-success__button box-shadow-margin",
        destructive: "pixel-destructive__button box-shadow-margin",
        ghost: "pixel-ghost__button",
        link: "bg-transparent text-cyan-400 underline-offset-4 underline hover:text-cyan-300",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-8 px-3 text-[10px]",
        lg: "h-12 px-8 text-sm",
        icon: "h-10 w-10 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const Button = React.forwardRef(({ className, variant, size, children, ...props }, ref) => {
  return (
    <button
      className={cn(pixelButtonVariants({ variant, size }), className)}
      ref={ref}
      {...props}
    >
      {children}
    </button>
  );
});

Button.displayName = "PixelButton";

export { Button, pixelButtonVariants };
