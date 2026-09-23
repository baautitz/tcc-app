import type { SelectHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => <select ref={ref} data-slot="select" className={cn("h-8 w-full rounded-none border border-input bg-background px-2.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:bg-input/50 disabled:opacity-50", className)} {...props}>{children}</select>);
Select.displayName = "Select";
export { Select };
