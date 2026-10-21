import * as React from "react";

import { cn } from "@/lib/utils";

/** One key per module. A new module adds its key here, a drawing in DRAWINGS and a name in SECTION_NAMES. */
export type Section = "hermes";

/** Indigo tile shared by every mark; `public/favicon.svg` is the Hermes drawing on the same tile. */
function Tile({ className, section, children }: { className?: string; section: Section; children: React.ReactNode }) {
  const gradient = `brand-${React.useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7 shrink-0", className)} data-testid="brand-mark" data-section={section}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#4338ca" />
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
      <rect x="11" y="14.75" width="10" height="3.5" rx="1.2" fill="#e0e7ff" />
      <path d="M24 10.4c2.6-.2 4.2-1.5 4.9-3.6-2.2.5-3.8.4-4.9-.2z" fill="#c7d2fe" />
      <path d="M8 10.4c-2.6-.2-4.2-1.5-4.9-3.6 2.2.5 3.8.4 4.9-.2z" fill="#c7d2fe" />
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
  hermes: "Hermes",
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
