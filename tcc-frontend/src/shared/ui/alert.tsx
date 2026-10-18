import type { HTMLAttributes } from "react";
import { cn } from "@/shared/lib/utils";
function Alert({ className, variant = "default", ...props }: HTMLAttributes<HTMLDivElement> & { variant?: "default" | "destructive" }) { return <div role="alert" data-slot="alert" data-variant={variant} className={cn("grid gap-1 border px-3 py-2 text-xs", variant === "destructive" ? "border-destructive/30 text-destructive" : "bg-card text-card-foreground", className)} {...props} />; }
function AlertTitle({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div data-slot="alert-title" className={cn("font-medium", className)} {...props} />; }
function AlertDescription({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div data-slot="alert-description" className={cn("text-xs/relaxed text-muted-foreground", className)} {...props} />; }
export { Alert, AlertTitle, AlertDescription };
