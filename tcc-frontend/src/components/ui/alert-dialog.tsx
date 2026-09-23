import * as React from "react";
import { AlertDialog as Primitive } from "@base-ui/react/alert-dialog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
function AlertDialog(props: Primitive.Root.Props) { return <Primitive.Root data-slot="alert-dialog" {...props} />; }
function AlertDialogContent({ className, ...props }: Primitive.Popup.Props) { return <Primitive.Portal><Primitive.Backdrop className="fixed inset-0 z-50 bg-black/10" /><Primitive.Popup data-slot="alert-dialog-content" className={cn("fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 bg-popover p-6 ring-1 ring-foreground/10 outline-none", className)} {...props} /></Primitive.Portal>; }
function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="alert-dialog-header" className={cn("flex flex-col gap-1", className)} {...props} />; }
function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="alert-dialog-footer" className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />; }
function AlertDialogTitle(props: Primitive.Title.Props) { return <Primitive.Title data-slot="alert-dialog-title" className="font-heading text-sm font-medium" {...props} />; }
function AlertDialogDescription(props: Primitive.Description.Props) { return <Primitive.Description data-slot="alert-dialog-description" className="text-xs/relaxed text-muted-foreground" {...props} />; }
function AlertDialogAction(props: React.ComponentProps<typeof Button>) { return <Button data-slot="alert-dialog-action" {...props} />; }
function AlertDialogCancel(props: Primitive.Close.Props) { return <Primitive.Close data-slot="alert-dialog-cancel" render={<Button variant="outline" />} {...props} />; }
export { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel };
