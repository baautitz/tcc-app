import * as React from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/shared/lib/utils";

function BubbleGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bubble-group"
      className={cn("flex min-w-0 flex-col", className)}
      {...props}
    />
  );
}

const bubbleVariants = cva(
  "group/bubble relative flex w-fit min-w-0 flex-col gap-1 data-[align=end]:self-end",
  {
    variants: {
      variant: {
        default:
          "max-w-[80%] *:data-[slot=bubble-content]:bg-primary *:data-[slot=bubble-content]:text-primary-foreground",
        secondary:
          "max-w-[80%] *:data-[slot=bubble-content]:bg-secondary *:data-[slot=bubble-content]:text-secondary-foreground",
        muted:
          "max-w-[80%] *:data-[slot=bubble-content]:bg-muted *:data-[slot=bubble-content]:text-foreground",
        tinted:
          "max-w-[80%] *:data-[slot=bubble-content]:bg-primary/10 *:data-[slot=bubble-content]:text-foreground",
        outline:
          "max-w-[80%] *:data-[slot=bubble-content]:border-border *:data-[slot=bubble-content]:bg-background",
        ghost:
          "max-w-full *:data-[slot=bubble-content]:bg-transparent *:data-[slot=bubble-content]:p-0",
        destructive:
          "max-w-[80%] *:data-[slot=bubble-content]:bg-destructive/10 *:data-[slot=bubble-content]:text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Bubble({
  variant = "default",
  align = "start",
  className,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof bubbleVariants> & { align?: "start" | "end" }) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      data-align={align}
      className={cn(bubbleVariants({ variant }), className)}
      {...props}
    />
  );
}

function BubbleContent({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "w-fit max-w-full min-w-0 overflow-hidden rounded-none border border-transparent px-3 py-2 text-left leading-relaxed whitespace-pre-wrap break-words [button,a]:text-left [button,a]:transition-colors",
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: "bubble-content" },
  });
}

export { BubbleGroup, Bubble, BubbleContent };
