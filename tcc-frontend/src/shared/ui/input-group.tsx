import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/shared/ui/input";
function InputGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div data-slot="input-group" role="group" className={cn("flex h-8 w-full items-center border border-input focus-within:border-ring focus-within:ring-1 focus-within:ring-ring", className)} {...props} />; }
function InputGroupAddon({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div data-slot="input-group-addon" className={cn("flex h-full items-center px-2 text-muted-foreground [&_svg]:size-4", className)} {...props} />; }
function InputGroupInput({ className, ...props }: React.ComponentProps<typeof Input>) { return <Input data-slot="input-group-control" className={cn("border-0 bg-transparent shadow-none focus-visible:ring-0", className)} {...props} />; }
export { InputGroup, InputGroupAddon, InputGroupInput };
