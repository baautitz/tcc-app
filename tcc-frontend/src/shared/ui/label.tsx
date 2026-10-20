import type { LabelHTMLAttributes } from "react";
import { cn } from "@/shared/lib/utils";
function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      data-slot="label"
      className={cn("flex items-center gap-2 text-xs leading-none", className)}
      {...props}
    />
  );
}
export { Label };
