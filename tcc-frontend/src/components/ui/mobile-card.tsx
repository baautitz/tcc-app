import React from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface MobileCardField {
  label: string;
  value: React.ReactNode;
}

interface MobileCardProps {
  primary: string;
  secondary?: string;
  fields: MobileCardField[];
  actions?: React.ReactNode;
}

export const MobileCard: React.FC<MobileCardProps> = ({
  primary,
  secondary,
  fields,
  actions,
}) => {
  return (
    <Card size="sm">
      <CardContent>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold leading-none">{primary}</span>
          {secondary && (
            <span className="font-mono text-xs text-muted-foreground">{secondary}</span>
          )}
        </div>

        <Separator className="my-3" />

        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {fields.map((field) => (
            <div key={field.label} className="flex flex-col gap-0.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {field.label}
              </span>
              <span className="text-sm font-medium break-words">{field.value}</span>
            </div>
          ))}
        </div>
      </CardContent>

      {actions && (
        <>
          <CardFooter className="justify-end">
            {actions}
          </CardFooter>
        </>
      )}
    </Card>
  );
};
