import * as React from "react";

import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** One key per module. A new module adds its key here, a drawing in DRAWINGS and a name in SECTION_NAMES. */
export type Section = "hermes" | "chat" | "conversations" | "infra" | "models" | "team";

/** Tile shared by every mark, in the --mark-* colors of styles.css; `public/favicon.svg` is the Hermes drawing on the same tile. */
function Tile({ className, section, children }: { className?: string; section: Section; children: React.ReactNode }) {
  const gradient = `brand-${React.useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7 shrink-0", className)} data-testid="brand-mark" data-section={section}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="[stop-color:var(--mark-from)]" />
          <stop offset="1" className="[stop-color:var(--mark-to)]" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7.5" fill={`url(#${gradient})`} />
      {children}
    </svg>
  );
}

const DRAWINGS: Record<Section, React.ReactNode> = {
  // A winged H.
  hermes: (
    <>
      <rect x="8" y="8.5" width="4.5" height="16" rx="1.5" fill="#fff" />
      <rect x="19.5" y="8.5" width="4.5" height="16" rx="1.5" fill="#fff" />
      <rect x="11" y="14.75" width="10" height="3.5" rx="1.2" className="fill-(--mark-softer)" />
      <path d="M24 10.4c2.6-.2 4.2-1.5 4.9-3.6-2.2.5-3.8.4-4.9-.2z" className="fill-(--mark-soft)" />
      <path d="M8 10.4c-2.6-.2-4.2-1.5-4.9-3.6 2.2.5 3.8.4 4.9-.2z" className="fill-(--mark-soft)" />
    </>
  ),
  // A chat bubble with a spark: talking to Hermes.
  chat: (
    <>
      <path d="M8 7.5h16a2.5 2.5 0 0 1 2.5 2.5v9a2.5 2.5 0 0 1-2.5 2.5h-8.5L10 25.5v-4H8A2.5 2.5 0 0 1 5.5 19v-9A2.5 2.5 0 0 1 8 7.5z" fill="#fff" />
      <path d="M16 10.3l1.15 3.15 3.15 1.15-3.15 1.15L16 18.9l-1.15-3.15-3.15-1.15 3.15-1.15z" className="fill-(--mark-ink)" />
    </>
  ),
  // Two speech bubbles.
  conversations: (
    <>
      <path d="M7 8.5h13a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7.5L8.5 23v-3.5H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z" fill="#fff" />
      <path d="M24 13h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1v3l-3.5-3H16a2 2 0 0 1-2-1.5h6a4 4 0 0 0 4-4z" className="fill-(--mark-soft)" />
      <rect x="9" y="12.5" width="9" height="1.8" rx=".9" className="fill-(--mark-soft)" />
      <rect x="9" y="15.5" width="6" height="1.8" rx=".9" className="fill-(--mark-soft)" />
    </>
  ),
  // A server with a pulse line.
  infra: (
    <>
      <rect x="7" y="7.5" width="18" height="7" rx="2" fill="#fff" />
      <rect x="7" y="17.5" width="18" height="7" rx="2" className="fill-(--mark-softer)" />
      <circle cx="10.5" cy="11" r="1.2" className="fill-(--mark-ink)" />
      <circle cx="10.5" cy="21" r="1.2" className="fill-(--mark-ink)" />
      <path d="M14 21h2.2l1.3-2.4 2 4.8 1.3-2.4H22" fill="none" className="stroke-(--mark-ink)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="14" y="10.2" width="8" height="1.6" rx=".8" className="fill-(--mark-soft)" />
    </>
  ),
  // A chip with a spark: the AI model.
  models: (
    <>
      <path d="M12 6v3M16 6v3M20 6v3M12 23v3M16 23v3M20 23v3M6 12h3M6 16h3M6 20h3M23 12h3M23 16h3M23 20h3" className="stroke-(--mark-soft)" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="9" y="9" width="14" height="14" rx="3" fill="#fff" />
      <path d="M16 11.5l1.2 3.3 3.3 1.2-3.3 1.2-1.2 3.3-1.2-3.3-3.3-1.2 3.3-1.2z" className="fill-(--mark-ink)" />
    </>
  ),
  // Two people, one in front: the team.
  team: (
    <>
      <circle cx="20.5" cy="11.5" r="3.3" className="fill-(--mark-soft)" />
      <path d="M14.5 24c.4-4 2.9-6.5 6-6.5s5.6 2.5 6 6.5z" className="fill-(--mark-soft)" />
      <circle cx="12.5" cy="12" r="3.8" fill="#fff" />
      <path d="M5.5 25.5c.5-4.6 3.3-7.4 7-7.4s6.5 2.8 7 7.4z" fill="#fff" />
    </>
  ),
};

export function SectionMark({ section, className }: { section: Section; className?: string }) {
  return (
    <Tile section={section} className={className}>
      {DRAWINGS[section]}
    </Tile>
  );
}

export const SECTION_NAMES: Record<Section, string> = {
  hermes: BRAND.name,
  chat: "Chat",
  conversations: "Conversations",
  infra: "Infra",
  models: "Models",
  team: "Team",
};

/** Page heading: the section mark + its name (the name is visually hidden on phones, where the header is tight). */
export function SectionTitle({ section, className }: { section: Section; className?: string }) {
  return (
    <h1 className={cn("flex items-center gap-2.5 text-lg font-semibold tracking-tight", className)}>
      <SectionMark section={section} />
      <span className="sr-only sm:not-sr-only">{SECTION_NAMES[section]}</span>
    </h1>
  );
}

/** The dashboard's own mark: the owner's logo (BRAND.logo in lib/brand.ts) when set, otherwise the drawn Hermes tile. */
export function BrandMark({ className }: { className?: string }) {
  if (BRAND.logo) return <img src={BRAND.logo} alt="" aria-hidden className={cn("size-7 shrink-0 rounded-[24%] object-contain", className)} data-testid="brand-mark" />;
  return <SectionMark section="hermes" className={className} />;
}
