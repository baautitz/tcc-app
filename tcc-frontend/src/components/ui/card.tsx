import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div data-slot="card" className={cn("flex flex-col gap-4 rounded-none bg-card py-4 text-xs/relaxed text-card-foreground ring-1 ring-foreground/10", className)} {...props} />; }
function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div data-slot="card-header" className={cn("grid gap-1 px-4", className)} {...props} />; }
function CardTitle({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div data-slot="card-title" className={cn("font-heading text-sm font-medium", className)} {...props} />; }
function CardDescription({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div data-slot="card-description" className={cn("text-xs/relaxed text-muted-foreground", className)} {...props} />; }
function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div data-slot="card-content" className={cn("px-4", className)} {...props} />; }
function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div data-slot="card-footer" className={cn("flex items-center border-t px-4 pt-4", className)} {...props} />; }
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
