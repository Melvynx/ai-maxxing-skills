import { DropdownMenu as MenuPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Menus on Radix (arrow keys, typeahead, Escape, focus back to the trigger), in the look of the sidebar's account menu:
 * popover surface, 36–40 px rows, the same open and close motion.
 */

const DropdownMenu = MenuPrimitive.Root;
const DropdownMenuTrigger = MenuPrimitive.Trigger;
const DropdownMenuSub = MenuPrimitive.Sub;

const SURFACE =
  "z-50 grid min-w-56 max-w-[calc(100vw-1rem)] gap-0.5 rounded-xl border bg-popover p-1 text-popover-foreground shadow-float ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-96 data-[state=closed]:duration-100 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-96 data-[state=open]:duration-150";

function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content sideOffset={sideOffset} collisionPadding={8} className={cn(SURFACE, "origin-(--radix-dropdown-menu-content-transform-origin)", className)} {...props} />
    </MenuPrimitive.Portal>
  );
}

const ITEM =
  "flex h-10 cursor-default select-none items-center gap-2.5 rounded-lg px-2 text-sm text-foreground outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent lg:h-9 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

function DropdownMenuItem({ className, destructive, ...props }: React.ComponentProps<typeof MenuPrimitive.Item> & { destructive?: boolean }) {
  return <MenuPrimitive.Item className={cn(ITEM, destructive && "text-bad data-[highlighted]:bg-bad-soft [&_svg]:text-bad", className)} {...props} />;
}

function DropdownMenuSubTrigger({ className, children, ...props }: React.ComponentProps<typeof MenuPrimitive.SubTrigger>) {
  return (
    <MenuPrimitive.SubTrigger className={cn(ITEM, "data-[state=open]:bg-accent", className)} {...props}>
      {children}
    </MenuPrimitive.SubTrigger>
  );
}

function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.SubContent>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.SubContent sideOffset={4} collisionPadding={8} className={cn(SURFACE, "origin-(--radix-dropdown-menu-content-transform-origin)", className)} {...props} />
    </MenuPrimitive.Portal>
  );
}

function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.Label>) {
  return <MenuPrimitive.Label className={cn("px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground", className)} {...props} />;
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger };
