import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
function Sheet(props: DialogPrimitive.Root.Props) { return <DialogPrimitive.Root data-slot="sheet" {...props} />; }
function SheetContent({ className, children, side = "right", ...props }: DialogPrimitive.Popup.Props & { side?: "right" | "left" }) { return <DialogPrimitive.Portal><DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs" /><DialogPrimitive.Popup data-slot="sheet-content" data-side={side} className={cn("fixed inset-y-0 z-50 flex w-3/4 flex-col border-l bg-popover text-popover-foreground shadow-lg outline-none sm:max-w-sm", side === "right" ? "right-0" : "left-0 border-r border-l-0", className)} {...props}>{children}<DialogPrimitive.Close render={<Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" />}><X /><span className="sr-only">Fechar</span></DialogPrimitive.Close></DialogPrimitive.Popup></DialogPrimitive.Portal>; }
function SheetHeader({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="sheet-header" className={cn("flex flex-col gap-1", className)} {...props} />; }
function SheetFooter({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="sheet-footer" className={cn("mt-auto flex flex-col gap-2", className)} {...props} />; }
function SheetTitle(props: DialogPrimitive.Title.Props) { return <DialogPrimitive.Title data-slot="sheet-title" className="font-heading text-sm font-medium" {...props} />; }
function SheetDescription(props: DialogPrimitive.Description.Props) { return <DialogPrimitive.Description data-slot="sheet-description" className="text-xs/relaxed text-muted-foreground" {...props} />; }
export { Sheet, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription };
