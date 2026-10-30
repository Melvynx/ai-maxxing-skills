import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowUpRight, House, KeyRound, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun, UserRound, type LucideIcon } from "lucide-react";
import * as React from "react";

import { SectionMark, type Section } from "@/components/brand";
import { useTheme } from "@/components/theme-provider";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { readCookie, writeCookie } from "@/lib/cookie";
import { cn } from "@/lib/utils";
import type { Viewer } from "@/server/viewer";

const COLLAPSED_COOKIE = "hermes-sidebar";

export const savedCollapsed = () => readCookie(COLLAPSED_COOKIE) === "collapsed";

type Item = {
  /** Every page path; a new module adds its own. */
  to: "/" | "/api-keys";
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

const KEYS: Item = { to: "/api-keys", label: "API keys", hint: "Keys for dashboard-cli and agents", icon: KeyRound };

const isActive = (pathname: string, to: Item["to"]) => (to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`));

export function currentItem(pathname: string): Item | undefined {
  return [...ITEMS, KEYS].find((item) => item.to !== "/" && isActive(pathname, item.to)) ?? (pathname === "/" ? ITEMS[0] : undefined);
}

const ROW =
  "group/row flex h-9 items-center gap-2.5 rounded-lg px-2 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40";
const IDLE = "text-muted-foreground hover:bg-accent hover:text-foreground";
const ACTIVE = "bg-card text-foreground shadow-panel ring-1 ring-border";

function NavLink({ item, collapsed, onNavigate }: { item: Item; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = isActive(pathname, item.to);
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? `${item.label} · ${item.hint}` : item.hint}
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
  );
}

function Nav({ collapsed, hermesUrl, onNavigate }: { collapsed: boolean; hermesUrl: string | null; onNavigate?: () => void }) {
  return (
    <nav aria-label="Sections" className="grid gap-1" data-testid="hub-nav">
      {ITEMS.map((item) => (
        <NavLink key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />
      ))}
      {hermesUrl ? (
        <a
          href={hermesUrl}
          target="_blank"
          rel="noreferrer"
          className={cn(ROW, IDLE, "mt-2", collapsed && "justify-center px-0")}
          title="Open the Hermes dashboard: chat, settings, logs"
          data-testid="hub-hermes"
        >
          <SectionMark section="hermes" className="size-5" />
          <span className={cn("truncate", collapsed && "sr-only")}>Hermes agent</span>
          <ArrowUpRight className={cn("ml-auto size-4 opacity-60", collapsed && "sr-only")} aria-hidden />
        </a>
      ) : null}
    </nav>
  );
}

function Footer({ collapsed, viewer, onNavigate }: { collapsed: boolean; viewer: Viewer; onNavigate?: () => void }) {
  const { theme, toggle } = useTheme();
  const themeLabel = theme === "dark" ? "Light theme" : "Dark theme";
  return (
    <div className="grid gap-1">
      {/* API keys open the dashboard to scripts: admins only. */}
      {viewer.role === "admin" ? <NavLink item={KEYS} collapsed={collapsed} onNavigate={onNavigate} /> : null}
      <button type="button" onClick={toggle} className={cn(ROW, IDLE, collapsed && "justify-center px-0")} title={themeLabel} data-testid="theme">
        {theme === "dark" ? <Sun className="size-5 p-0.5" aria-hidden /> : <Moon className="size-5 p-0.5" aria-hidden />}
        <span className={cn(collapsed && "sr-only")}>{themeLabel}</span>
      </button>
      {/* The server's gate owns the session: its sign-out ends it for every page it protects. */}
      <a href="/.gate/logout" className={cn(ROW, IDLE, collapsed && "justify-center px-0")} title="Sign out" data-testid="logout">
        <LogOut className="size-5 p-0.5" aria-hidden />
        <span className={cn(collapsed && "sr-only")}>Sign out</span>
      </a>
      {viewer.email ? (
        <p
          className={cn("flex h-9 items-center gap-2.5 px-2 text-xs text-muted-foreground", collapsed && "justify-center px-0")}
          title={`Signed in as ${viewer.email} (${viewer.role})`}
          data-testid="hub-viewer"
        >
          <UserRound className="size-5 shrink-0 p-0.5" aria-hidden />
          <span className={cn("truncate", collapsed && "sr-only")}>{viewer.email}</span>
        </p>
      ) : null}
    </div>
  );
}

function HomeLink({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <Link to="/" onClick={onNavigate} className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40" aria-label="Dashboard home">
      <SectionMark section="hermes" className="size-7" />
      <span className={cn("truncate text-[0.9375rem] font-semibold tracking-[-0.01em]", collapsed && "sr-only")}>Hermes</span>
    </Link>
  );
}

/**
 * The hub frame: a left rail on large screens (expanded or icon-only, remembered in a cookie so the server renders it
 * right) and a top bar with a menu sheet below `lg`. Each page keeps its own header.
 */
export function HubFrame({
  initialCollapsed,
  hermesUrl,
  viewer,
  children,
}: {
  initialCollapsed: boolean;
  hermesUrl: string | null;
  viewer: Viewer;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = React.useState(initialCollapsed);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = currentItem(pathname);
  const toggle = () =>
    setCollapsed((value) => {
      writeCookie(COLLAPSED_COOKIE, value ? "expanded" : "collapsed");
      return !value;
    });
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <div className="flex min-h-dvh">
      <aside
        className={cn("sticky top-0 hidden h-dvh shrink-0 flex-col gap-4 border-r bg-sidebar p-2.5 transition-[width] duration-200 ease-out-quart lg:flex", collapsed ? "w-[3.75rem]" : "w-56")}
        data-collapsed={collapsed}
        data-testid="hub-sidebar"
      >
        <div className={cn("flex h-9 items-center gap-1 px-1", collapsed && "justify-center px-0")}>
          <HomeLink collapsed={collapsed} />
        </div>
        <Nav collapsed={collapsed} hermesUrl={hermesUrl} />
        <div className="mt-auto grid gap-1 border-t pt-2.5">
          <Footer collapsed={collapsed} viewer={viewer} />
          <button
            type="button"
            onClick={toggle}
            className={cn(ROW, IDLE, collapsed && "justify-center px-0")}
            aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
            title={collapsed ? "Expand" : "Collapse"}
            data-testid="hub-collapse"
          >
            <CollapseIcon className="size-5 p-0.5" aria-hidden />
            <span className={cn(collapsed && "sr-only")}>Collapse</span>
          </button>
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
              <SheetTitle className="sr-only">Hermes</SheetTitle>
              <div className="flex h-9 items-center px-1">
                <HomeLink onNavigate={() => setMenuOpen(false)} />
              </div>
              <Nav collapsed={false} hermesUrl={hermesUrl} onNavigate={() => setMenuOpen(false)} />
              <div className="mt-auto border-t pt-2.5">
                <Footer collapsed={false} viewer={viewer} onNavigate={() => setMenuOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
          <HomeLink collapsed />
          <span className="truncate text-sm font-semibold">{current?.label ?? "Hermes"}</span>
        </div>
        {children}
      </div>
    </div>
  );
}
