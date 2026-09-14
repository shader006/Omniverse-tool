import * as React from "react";
import { cn } from "@/lib/utils";
import "./styles/styles.css";

export function Badge({ className, variant = "default", children, ...props }) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1 text-[11px] pixel-font uppercase select-none transition-colors",
        variant === "default" && "bg-slate-900/90 text-cyan-300 border-2 border-cyan-500/60 shadow-[2px_2px_0px_#000]",
        variant === "green" && "bg-emerald-950/80 text-emerald-400 border-2 border-emerald-500/60 shadow-[2px_2px_0px_#000]",
        variant === "amber" && "bg-amber-950/80 text-amber-300 border-2 border-amber-500/60 shadow-[2px_2px_0px_#000]",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
