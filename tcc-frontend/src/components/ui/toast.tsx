import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CircleCheck, Info, OctagonX, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type ToastKind = "success" | "error" | "info" | "warning";
type ToastItem = { id: number; kind: ToastKind; title: string; description?: string };
type ToastContextValue = { push: (kind: ToastKind, title: string, description?: string) => void };
const ToastContext = createContext<ToastContextValue | null>(null);
let publish: ToastContextValue["push"] | undefined;
const icons = { success: CircleCheck, error: OctagonX, info: Info, warning: TriangleAlert };
const colors = { success: "text-emerald-600", error: "text-destructive", info: "text-sky-600", warning: "text-amber-600" };

function Toaster({ children }: { children?: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastKind, title: string, description?: string) => {
    const id = Date.now() + Math.round(Math.random() * 1_000);
    setItems((current) => [...current, { id, kind, title, description }]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 5_000);
  }, []);
  publish = push;
  const value = useMemo(() => ({ push }), [push]);
  return <ToastContext.Provider value={value}>{children}<div data-slot="toast-viewport" className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] ml-auto flex w-auto max-w-sm flex-col gap-3 sm:right-4 sm:left-auto sm:w-full">{items.map((item) => { const Icon = icons[item.kind]; return <div key={item.id} data-slot="toast" className="pointer-events-auto flex items-start gap-3 border bg-popover p-4 text-xs shadow-lg"><Icon className={colors[item.kind]} /><div className="min-w-0 flex-1"><p className="font-medium">{item.title}</p>{item.description && <p className="mt-1 text-muted-foreground">{item.description}</p>}</div><Button size="icon-sm" variant="ghost" aria-label="Fechar notificação" onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}><X /></Button></div>; })}</div></ToastContext.Provider>;
}

function useToast(): ToastContextValue { const context = useContext(ToastContext); if (!context) throw new Error("useToast deve ser usado dentro de Toaster."); return context; }
const toast = { success: (title: string, description?: string) => publish?.("success", title, description), error: (title: string, description?: string) => publish?.("error", title, description), info: (title: string, description?: string) => publish?.("info", title, description), warning: (title: string, description?: string) => publish?.("warning", title, description) };
export { Toaster, toast, useToast };
