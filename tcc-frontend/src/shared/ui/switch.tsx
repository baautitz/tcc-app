import type { InputHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> & { onCheckedChange?: (checked: boolean) => void };
const Switch = forwardRef<HTMLInputElement, SwitchProps>(({ className, checked, onCheckedChange, ...props }, ref) => <input ref={ref} data-slot="switch" type="checkbox" role="switch" checked={checked} onChange={(event) => onCheckedChange?.(event.target.checked)} className={cn("h-[18px] w-8 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50", className)} {...props} />);
Switch.displayName = "Switch";
export { Switch };
