import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowUpRight, ChevronDown, ChevronsUpDown, House, KeyRound, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun, Users, type LucideIcon } from "lucide-react";
import { DropdownMenu, Tooltip } from "radix-ui";
import * as React from "react";

import { BrandMark, SectionMark, type Section } from "@/components/brand";
import { useTheme } from "@/components/theme-provider";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { authClient } from "@/lib/auth-client";
import { BRAND } from "@/lib/brand";
import { readCookie, writeCookie } from "@/lib/cookie";
import { cn } from "@/lib/utils";
import type { Viewer } from "@/server/viewer";

const COLLAPSED_COOKIE = "hermes-sidebar";
const MONITORING_COOKIE = "hermes-monitoring";

export const savedCollapsed = () => readCookie(COLLAPSED_COOKIE) === "collapsed";
/** The System monitoring group starts open; closing it is remembered like the rail. */
export const savedMonitoringOpen = () => readCookie(MONITORING_COOKIE) !== "closed";

type Item = {
  /** Every page path; a new module adds its own. */
  to: "/" | "/api-keys" | "/conversations" | "/infra" | "/models" | "/team";
  label: string;
  hint: string;
  section?: Exclude<Section, "hermes">;
  /** Replaces the section mark for pages that are not a section. */
  icon?: LucideIcon;
};

/**
 * One line per module, under Home. A new module gets its line here (`section` set), its mark in brand.tsx and its
 * page in src/routes. The dashboard ships with none: the owner asks their agent for the ones they want.
 */
export const ITEMS: Item[] = [{ to: "/", label: "Home", hint: "Your agent at a glance" }];

/**
 * Built in, admins only, in the "System monitoring" group at the bottom of the rail: the agent's conversations, the
 * health of the server (src/server/infra) and the AI model it answers with (src/server/models.ts).
 */
export const MONITORING: Item[] = [
  { to: "/conversations", label: "Conversations", hint: "Your latest conversations with Hermes", section: "conversations" },
  { to: "/infra", label: "Infra", hint: "Server health, daily audit and fixes", section: "infra" },
  { to: "/models", label: "Models", hint: "The AI model Hermes uses", section: "models" },
];

/** Built in, admins only, in the account menu at the bottom of the rail. */
const KEYS: Item = { to: "/api-keys", label: "API keys", hint: "Keys for dashboard-cli and agents", icon: KeyRound };
const TEAM: Item = { to: "/team", label: "Team", hint: "Who can sign in, and their role", icon: Users };

const isActive = (pathname: string, to: Item["to"]) => (to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`));

export function currentItem(pathname: string): Item | undefined {
  return [...ITEMS, ...MONITORING, KEYS, TEAM].find((item) => item.to !== "/" && isActive(pathname, item.to)) ?? (pathname === "/" ? ITEMS[0] : undefined);
}

const FOCUS = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40";
const ROW = cn("group/row flex h-9 items-center gap-2.5 rounded-lg px-2 text-sm font-medium transition-colors", FOCUS);
const IDLE = "text-muted-foreground hover:bg-accent hover:text-foreground";
const ACTIVE = "bg-card text-foreground shadow-panel ring-1 ring-border";
/** Icon-only buttons: colour on hover, a small press. */
const ICON_BUTTON = cn("grid shrink-0 place-items-center rounded-md text-muted-foreground transition-[color,background-color,scale] duration-150 ease-out hover:bg-accent hover:text-foreground active:scale-[0.96]", FOCUS);

/**
 * On the icon-only rail, the name (and hint) of a line shows beside it on hover and on keyboard focus; a native `title`
 * only shows on hover. Expanded, the line already shows its name and nothing is added.
 */
function RailTip({ show, label, hint, children }: { show: boolean; label: string; hint?: string; children: React.ReactElement }) {
  if (!show) return children;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={8}
          collisionPadding={8}
          className="z-50 grid max-w-64 gap-0.5 rounded-lg border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-float origin-(--radix-tooltip-content-transform-origin) data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-96 data-[state=delayed-open]:duration-150 data-[state=instant-open]:animate-in data-[state=instant-open]:fade-in-0"
        >
          <span className="text-sm font-medium">{label}</span>
          {hint ? <span className="text-2xs text-muted-foreground">{hint}</span> : null}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function NavLink({ item, collapsed, onNavigate }: { item: Item; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = isActive(pathname, item.to);
  return (
    <RailTip show={collapsed} label={item.label} hint={item.hint}>
      <Link
        to={item.to}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        title={collapsed ? undefined : item.hint}
        className={cn(ROW, active ? ACTIVE : IDLE, collapsed && "justify-center px-0")}
        data-testid={`hub-nav-${item.to === "/" ? "home" : item.to.slice(1)}`}
      >
        {item.icon ? (
          <item.icon className={cn("size-5 p-0.5", active && "text-brand")} aria-hidden />
        ) : item.section ? (
          <SectionMark section={item.section} className="size-5" />
        ) : (
          <House className="size-5 p-0.5" aria-hidden />
        )}
        <span className={cn("truncate", collapsed && "sr-only")}>{item.label}</span>
      </Link>
    </RailTip>
  );
}

function Nav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Sections" className="grid gap-1" data-testid="hub-nav">
      {ITEMS.map((item) => (
        <NavLink key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />
      ))}
    </nav>
  );
}

/** Admins only, at the bottom of the rail: a group that folds, with the link to Hermes's own dashboard last. */
function Monitoring({
  collapsed,
  open,
  onToggle,
  hermesUrl,
  onNavigate,
}: {
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
  hermesUrl: string | null;
  onNavigate?: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Folded, the group still shows the page you are on.
  const shown = open || collapsed ? MONITORING : MONITORING.filter((item) => isActive(pathname, item.to));
  return (
    <nav aria-label="System monitoring" className="grid gap-1" data-testid="hub-monitoring">
      {collapsed ? (
        <span className="mx-auto mb-1 h-px w-6 bg-border" aria-hidden />
      ) : (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
          data-testid="hub-monitoring-toggle"
        >
          System monitoring
          <ChevronDown className={cn("ml-auto size-3.5 transition-transform", !open && "-rotate-90")} aria-hidden />
        </button>
      )}
      {shown.map((item) => (
        <NavLink key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />
      ))}
      {hermesUrl && (open || collapsed) ? <HermesLink url={hermesUrl} collapsed={collapsed} /> : null}
    </nav>
  );
}

/** Hermes's own dashboard (chat, settings, logs), in a new tab. Its URL is only sent to admins. */
function HermesLink({ url, collapsed }: { url: string; collapsed: boolean }) {
  const hint = "Its own dashboard: chat, settings, logs";
  return (
    <RailTip show={collapsed} label="Hermes agent" hint={`${hint} (new tab)`}>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={cn(ROW, IDLE, collapsed && "justify-center px-0")}
        title={collapsed ? undefined : hint}
        data-testid="hub-hermes"
      >
        <SectionMark section="hermes" className="size-5" />
        <span className={cn("truncate", collapsed && "sr-only")}>Hermes agent</span>
        <ArrowUpRight className={cn("ml-auto size-4 opacity-60", collapsed && "sr-only")} aria-hidden />
      </a>
    </RailTip>
  );
}

/** Menu rows sit 4px inside a 14px card: 10px corners keep the curves concentric. */
const MENU_ITEM = "flex h-9 cursor-default select-none items-center gap-2.5 rounded-lg px-2 text-sm text-foreground outline-none data-[highlighted]:bg-accent";
const MENU_ICON = "size-4 shrink-0 text-muted-foreground";

/** The theme icon cross-fades (scale, blur, opacity) instead of popping: both stay in the DOM. */
const ICON_SWAP = "size-4 transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]";
const ICON_SHOWN = "scale-100 opacity-100 blur-none";
const ICON_HIDDEN = "scale-[0.25] opacity-0 blur-[4px]";

/**
 * Flips the theme without every coloured transition of the page firing at once (the switch would smear). Only the
 * theme icon (`data-icon-swap`) keeps its cross-fade.
 */
function withoutTransitions(change: () => void) {
  const style = document.createElement("style");
  style.append(document.createTextNode("*:not([data-icon-swap]),*::before,*::after{transition:none!important}"));
  document.head.append(style);
  change();
  requestAnimationFrame(() => {
    void document.body.offsetHeight;
    requestAnimationFrame(() => style.remove());
  });
}

/**
 * One account button at the bottom of the rail (avatar, email, role). It opens a small menu: the full email, API keys
 * and Team for admins, the theme, sign out.
 */
function AccountMenu({ collapsed, viewer, onNavigate }: { collapsed: boolean; viewer: Viewer; onNavigate?: () => void }) {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  const admin = viewer.role === "admin";
  const email = viewer.email;
  const role = admin ? "Admin" : "Member";
  return (
    <DropdownMenu.Root>
      <RailTip show={collapsed} label={email} hint={role}>
        <DropdownMenu.Trigger asChild>
          {/* No aria-label: the name is the email and role the button shows (kept for screen readers when folded). */}
          <button
            type="button"
            className={cn(
              // A boxed card, like the account button of the other apps: border, card background, a light shadow.
              "flex h-12 w-full items-center gap-2.5 rounded-lg border bg-card px-2 text-start shadow-panel transition-colors duration-150 ease-out hover:bg-accent data-[state=open]:bg-accent",
              FOCUS,
              collapsed && "mx-auto size-10 justify-center px-0",
            )}
            title={collapsed ? undefined : `${email} (${role})`}
            data-testid="hub-account"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-brand/15 text-xs font-semibold uppercase text-brand" aria-hidden>
              {email.charAt(0)}
            </span>
            <span className={cn("grid min-w-0 flex-1", collapsed && "sr-only")}>
              <span className="truncate text-xs font-medium text-foreground" data-testid="hub-viewer">
                {email}
              </span>
              <span className="truncate text-2xs text-muted-foreground">{role}</span>
            </span>
            <ChevronsUpDown className={cn("size-4 shrink-0 text-muted-foreground", collapsed && "sr-only")} aria-hidden />
          </button>
        </DropdownMenu.Trigger>
      </RailTip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side={collapsed ? "right" : "top"}
          align={collapsed ? "end" : "start"}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 grid w-60 max-w-[calc(100vw-1rem)] gap-0.5 rounded-xl border bg-popover p-1 text-popover-foreground shadow-float origin-(--radix-dropdown-menu-content-transform-origin) ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-96 data-[state=closed]:duration-100 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-96 data-[state=open]:duration-150"
          data-testid="hub-account-menu"
        >
          {/* The email is cut in the rail: here it shows whole, also on touch where a `title` never does. */}
          <DropdownMenu.Label className="grid gap-0.5 px-2 py-1.5" data-testid="hub-account-email">
            <span className="text-sm font-medium break-all">{email}</span>
            <span className="text-2xs text-muted-foreground">{role}</span>
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-border" />
          {/* API keys open the dashboard to scripts, Team changes who can sign in: admins only. */}
          {admin ? (
            <>
              {[KEYS, TEAM].map((item) => (
                <DropdownMenu.Item key={item.to} asChild className={MENU_ITEM}>
                  <Link to={item.to} onClick={onNavigate} data-testid={`hub-nav-${item.to.slice(1)}`}>
                    {item.icon ? <item.icon className={MENU_ICON} aria-hidden /> : null}
                    {item.label}
                  </Link>
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-border" />
            </>
          ) : null}
          {/* The menu stays open so the switch is seen; the label names what a press does. */}
          <DropdownMenu.Item className={MENU_ITEM} onSelect={(event) => (event.preventDefault(), withoutTransitions(toggle))} data-testid="theme">
            <span className="relative size-4 shrink-0 text-muted-foreground" aria-hidden>
              <Sun className={cn(ICON_SWAP, "absolute inset-0", dark ? ICON_SHOWN : ICON_HIDDEN)} data-icon-swap />
              <Moon className={cn(ICON_SWAP, dark ? ICON_HIDDEN : ICON_SHOWN)} data-icon-swap />
            </span>
            {dark ? "Light theme" : "Dark theme"}
          </DropdownMenu.Item>
          {/* Ends the session on the server, then a full load on the sign-in page. */}
          <DropdownMenu.Item className={MENU_ITEM} onSelect={() => void signOut()} data-testid="logout">
            <LogOut className={MENU_ICON} aria-hidden />
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

async function signOut() {
  await authClient.signOut().catch(() => null);
  window.location.assign("/login");
}

function HomeLink({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <Link to="/" onClick={onNavigate} className={cn("flex min-w-0 items-center gap-2.5 rounded-lg", FOCUS)} aria-label="Dashboard home">
      <BrandMark className="size-7" />
      <span className={cn("truncate text-[0.9375rem] font-semibold tracking-[-0.01em]", collapsed && "sr-only")}>{BRAND.name}</span>
    </Link>
  );
}

/**
 * The hub frame: a left rail on large screens (expanded or icon-only, remembered in a cookie so the server renders it
 * right) and a top bar with a menu sheet below `lg`. Each page keeps its own header.
 */
export function HubFrame({
  initialCollapsed,
  initialMonitoringOpen,
  hermesUrl,
  viewer,
  children,
}: {
  initialCollapsed: boolean;
  initialMonitoringOpen: boolean;
  hermesUrl: string | null;
  viewer: Viewer;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = React.useState(initialCollapsed);
  const [monitoringOpen, setMonitoringOpen] = React.useState(initialMonitoringOpen);
  const admin = viewer.role === "admin";
  const [menuOpen, setMenuOpen] = React.useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = currentItem(pathname);
  const toggle = () =>
    setCollapsed((value) => {
      writeCookie(COLLAPSED_COOKIE, value ? "expanded" : "collapsed");
      return !value;
    });
  const toggleMonitoring = () =>
    setMonitoringOpen((value) => {
      writeCookie(MONITORING_COOKIE, value ? "closed" : "open");
      return !value;
    });
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const collapseLabel = collapsed ? "Expand the sidebar" : "Collapse the sidebar";
  return (
    <Tooltip.Provider delayDuration={300} skipDelayDuration={200}>
      <div className="flex min-h-dvh">
        <aside
          className={cn("sticky top-0 hidden h-dvh shrink-0 flex-col gap-4 border-r bg-sidebar p-2.5 transition-[width] duration-200 ease-out-quart lg:flex", collapsed ? "w-[3.75rem]" : "w-56")}
          data-collapsed={collapsed}
          data-testid="hub-sidebar"
        >
          <div className={cn("flex h-9 shrink-0 items-center gap-1 px-1", collapsed && "h-auto flex-col gap-2 px-0")}>
            <HomeLink collapsed={collapsed} />
            <RailTip show label={collapseLabel}>
              <button type="button" onClick={toggle} className={cn(ICON_BUTTON, "size-8", !collapsed && "ml-auto")} aria-label={collapseLabel} data-testid="hub-collapse">
                <CollapseIcon className="size-4" aria-hidden />
              </button>
            </RailTip>
          </div>
          <Nav collapsed={collapsed} />
          {admin ? (
            <div className="mt-auto">
              <Monitoring collapsed={collapsed} open={monitoringOpen} onToggle={toggleMonitoring} hermesUrl={hermesUrl} />
            </div>
          ) : null}
          <div className={cn("pt-2.5", !admin && "mt-auto")}>
            <AccountMenu collapsed={collapsed} viewer={viewer} />
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 items-center gap-2 border-b bg-sidebar px-3 lg:hidden" data-testid="hub-topbar">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <button type="button" className={cn(ROW, IDLE, "size-9 justify-center px-0")} aria-label="Menu" data-testid="hub-menu">
                  <Menu className="size-5" aria-hidden />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[min(18rem,85vw)] gap-4 bg-sidebar p-3" data-testid="hub-sheet">
                <SheetTitle className="sr-only">{BRAND.name}</SheetTitle>
                <div className="flex h-9 items-center px-1">
                  <HomeLink onNavigate={() => setMenuOpen(false)} />
                </div>
                <Nav collapsed={false} onNavigate={() => setMenuOpen(false)} />
                {admin ? (
                  <div className="mt-auto">
                    <Monitoring collapsed={false} open={monitoringOpen} onToggle={toggleMonitoring} hermesUrl={hermesUrl} onNavigate={() => setMenuOpen(false)} />
                  </div>
                ) : null}
                <div className={cn("border-t pt-2.5", !admin && "mt-auto")}>
                  <AccountMenu collapsed={false} viewer={viewer} onNavigate={() => setMenuOpen(false)} />
                </div>
              </SheetContent>
            </Sheet>
            <HomeLink collapsed />
            <span className="truncate text-sm font-semibold">{current?.label ?? BRAND.name}</span>
          </div>
          {children}
        </div>
      </div>
    </Tooltip.Provider>
  );
}
