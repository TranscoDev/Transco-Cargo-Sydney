import type { ReactNode } from "react";

/**
 * Renders WhatsApp's own text formatting (*bold*, _italic_, ~strikethrough~)
 * as real styled elements, so the console preview matches what the customer
 * actually sees on WhatsApp instead of showing raw asterisks/underscores.
 */
export function renderWhatsAppText(text: string): ReactNode[] {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g);

  return parts.map((part, i) => {
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
      return <strong key={i}>{part.slice(1, -1)}</strong>;
    }
    if (part.length > 2 && part.startsWith("_") && part.endsWith("_")) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    if (part.length > 2 && part.startsWith("~") && part.endsWith("~")) {
      return <s key={i}>{part.slice(1, -1)}</s>;
    }
    return part;
  });
}
