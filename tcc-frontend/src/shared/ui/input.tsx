import type { InputHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "@/shared/lib/utils";
const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <input ref={ref} data-slot="input" className={cn("h-8 w-full min-w-0 rounded-none border border-input bg-transparent px-2.5 py-1 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-input/50 disabled:opacity-50", className)} {...props} />);
Input.displayName = "Input";
export { Input };
