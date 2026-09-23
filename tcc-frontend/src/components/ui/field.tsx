import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
function FieldGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div data-slot="field-group" className={cn("flex w-full flex-col gap-5", className)} {...props} />; }
function Field({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div data-slot="field" role="group" className={cn("flex w-full flex-col gap-2", className)} {...props} />; }
function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) { return <Label data-slot="field-label" className={cn("font-medium", className)} {...props} />; }
function FieldDescription({ className, ...props }: React.ComponentProps<"p">) { return <p data-slot="field-description" className={cn("text-xs/relaxed text-muted-foreground", className)} {...props} />; }
export { FieldGroup, Field, FieldLabel, FieldDescription };
