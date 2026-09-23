import type { ReactNode } from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
type MobileCardProps = { primary: string; secondary?: string; fields: Array<{ label: string; value: ReactNode }>; actions?: ReactNode };
function MobileCard({ primary, secondary, fields, actions }: MobileCardProps) { return <Card><CardContent><div className="flex flex-col gap-1"><span className="text-sm font-semibold">{primary}</span>{secondary && <span className="font-mono text-xs text-muted-foreground">{secondary}</span>}</div><Separator className="my-3" /><div className="grid grid-cols-2 gap-x-4 gap-y-2">{fields.map((field) => <div key={field.label} className="flex flex-col gap-0.5"><span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{field.label}</span><span className="break-words text-xs font-medium">{field.value}</span></div>)}</div></CardContent>{actions && <CardFooter className="justify-end">{actions}</CardFooter>}</Card>; }
export { MobileCard };
