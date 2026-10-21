import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Custom sizes and shadows from styles.css; unknown to tailwind-merge they would be read as colours and dropped.
const twMerge = extendTailwindMerge({
  extend: {
    theme: { text: ["2xs", "meta", "md", "kpi", "display"], shadow: ["panel", "float", "lift"] },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
