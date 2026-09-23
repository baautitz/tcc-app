import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
function Dialog(props: DialogPrimitive.Root.Props) { return <DialogPrimitive.Root data-slot="dialog" {...props} />; }
function DialogContent({ className, children, ...props }: DialogPrimitive.Popup.Props) { return <DialogPrimitive.Portal><DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs" /><DialogPrimitive.Popup data-slot="dialog-content" className={cn("fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 bg-popover p-6 text-popover-foreground ring-1 ring-foreground/10 outline-none", className)} {...props}>{children}<DialogPrimitive.Close render={<Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" />}><X /><span className="sr-only">Fechar</span></DialogPrimitive.Close></DialogPrimitive.Popup></DialogPrimitive.Portal>; }
function DialogHeader({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="dialog-header" className={cn("flex flex-col gap-1", className)} {...props} />; }
function DialogFooter({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="dialog-footer" className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />; }
function DialogTitle(props: DialogPrimitive.Title.Props) { return <DialogPrimitive.Title data-slot="dialog-title" className="font-heading text-sm font-medium" {...props} />; }
function DialogDescription(props: DialogPrimitive.Description.Props) { return <DialogPrimitive.Description data-slot="dialog-description" className="text-xs/relaxed text-muted-foreground" {...props} />; }
export { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription };
