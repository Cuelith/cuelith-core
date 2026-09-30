import type { Credits, Item } from "@cuelith/protocol";

/**
 * Riga dei crediti come la mostrano le uscite (cap. 07, decisione 0001):
 * "Titolo — Autori · © Copyright · CCLI 123". "CCLI" e' un nome proprio.
 */
export function creditsLine(title: string, credits: Credits): string | undefined {
  const authors = credits.authors.map((a) => a.name).join(", ");
  const copyright = credits.copyright?.trim();
  const rest = [
    copyright === undefined || copyright === ""
      ? undefined
      : copyright.startsWith("©")
        ? copyright
        : `© ${copyright}`,
    credits.ccli === undefined ? undefined : `CCLI ${credits.ccli}`,
  ].filter((part): part is string => part !== undefined);
  const head = [title.trim(), authors].filter((part) => part !== "").join(" — ");
  const line = [head, ...rest].filter((part) => part !== "").join(" · ");
  return line === "" ? undefined : line;
}

/** Crediti da mostrare su questa slide (indice nella sequenza di proiezione), se previsti. */
export function creditsFor(item: Item, index: number, count: number): string | undefined {
  const credits = item.credits;
  if (credits === undefined || credits.show === "none" || count === 0) return undefined;
  const due = credits.show === "first" ? index === 0 : index === count - 1;
  return due ? creditsLine(item.title, credits) : undefined;
}
