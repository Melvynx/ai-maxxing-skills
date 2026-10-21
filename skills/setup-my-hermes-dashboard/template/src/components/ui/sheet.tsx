import { XIcon } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

const SIDES = {
  // Navigation panels (hub menu, accounts sidebar on narrow screens).
  left: "left-0 w-[min(22rem,88vw)] border-r p-4 shadow-lg ease-in-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
  // Detail panels (cron run history, idea detail).
  right:
    "right-0 w-[min(44rem,94vw)] overscroll-contain border-l p-4 shadow-2xl ease-out data-[state=closed]:duration-200 data-[state=closed]:slide-out-to-right data-[state=open]:duration-300 data-[state=open]:slide-in-from-right sm:p-6",
} as const;

/** A dialog sliding in from the left (navigation) or the right (details) edge. */
function SheetContent({ className, children, side = "left", ...props }: React.ComponentProps<typeof SheetPrimitive.Content> & { side?: keyof typeof SIDES }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn("fixed inset-y-0 z-50 flex flex-col gap-3 overflow-y-auto bg-background transition data-[state=closed]:animate-out data-[state=open]:animate-in", SIDES[side], className)}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute top-3 right-3 z-10 inline-flex size-8 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title data-slot="sheet-title" className={cn("font-semibold", className)} {...props} />;
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description data-slot="sheet-description" className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger };
