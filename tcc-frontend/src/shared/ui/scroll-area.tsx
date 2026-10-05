import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
function ScrollArea({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div data-slot="scroll-area" className={cn("overflow-y-auto", className)} {...props} />; }
export { ScrollArea };
