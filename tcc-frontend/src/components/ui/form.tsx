import * as React from "react";
import { Controller, type ControllerProps, type FieldPath, type FieldValues, FormProvider, useFormContext } from "react-hook-form";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

const Form = FormProvider;
type FormFieldContextValue<TFieldValues extends FieldValues = FieldValues, TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>> = { name: TName };
const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue);
const FormItemContext = React.createContext<{ id: string }>({ id: "" });

function FormField<TFieldValues extends FieldValues = FieldValues, TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>>(props: ControllerProps<TFieldValues, TName>) {
  return <FormFieldContext.Provider value={{ name: props.name }}><Controller {...props} /></FormFieldContext.Provider>;
}
function useFormField() {
  const field = React.useContext(FormFieldContext);
  const item = React.useContext(FormItemContext);
  const { getFieldState, formState } = useFormContext();
  return { ...getFieldState(field.name, formState), id: item.id, formItemId: `${item.id}-form-item`, formMessageId: `${item.id}-form-message` };
}
function FormItem({ className, ...props }: React.ComponentProps<"div">) { const id = React.useId(); return <FormItemContext.Provider value={{ id }}><div data-slot="form-item" className={cn("flex flex-col gap-2", className)} {...props} /></FormItemContext.Provider>; }
function FormLabel({ className, ...props }: React.ComponentProps<typeof Label>) { const { error, formItemId } = useFormField(); return <Label data-slot="form-label" htmlFor={formItemId} className={cn(error && "text-destructive", className)} {...props} />; }
function FormControl({ className, ...props }: React.ComponentProps<"div">) { const { error, formItemId } = useFormField(); return <div data-slot="form-control" id={formItemId} aria-invalid={Boolean(error)} className={className} {...props} />; }
function FormMessage({ className, children, ...props }: React.ComponentProps<"p">) { const { error, formMessageId } = useFormField(); const content = error?.message ?? children; return content ? <p data-slot="form-message" id={formMessageId} className={cn("text-xs font-medium text-destructive", className)} {...props}>{String(content)}</p> : null; }
export { Form, FormField, FormItem, FormLabel, FormControl, FormMessage };
