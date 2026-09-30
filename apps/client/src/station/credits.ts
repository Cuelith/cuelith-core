import { AUTHOR_ROLES, type Author, type Credits } from "@cuelith/protocol";

export type AuthorRole = (typeof AUTHOR_ROLES)[number];
export type CreditsShow = Credits["show"];

/** Crediti come li modifica l'operatore: tutti testi, anche l'anno. */
export interface CreditsForm {
  readonly authors: readonly { readonly name: string; readonly role: AuthorRole }[];
  readonly altTitles: string;
  readonly copyright: string;
  readonly publisher: string;
  readonly year: string;
  readonly ccli: string;
  readonly license: string;
  readonly show: CreditsShow;
}

export const EMPTY_CREDITS: CreditsForm = {
  authors: [],
  altTitles: "",
  copyright: "",
  publisher: "",
  year: "",
  ccli: "",
  license: "",
  show: "none",
};

export function creditsToForm(credits: Credits | undefined): CreditsForm {
  if (credits === undefined) return EMPTY_CREDITS;
  return {
    authors: credits.authors,
    altTitles: (credits.altTitles ?? []).join("\n"),
    copyright: credits.copyright ?? "",
    publisher: credits.publisher ?? "",
    year: credits.year === undefined ? "" : String(credits.year),
    ccli: credits.ccli ?? "",
    license: credits.license ?? "",
    show: credits.show,
  };
}

export type CreditsProblem = "year" | "ccli";

/** Problemi da correggere prima di salvare (chiavi dei campi). */
export function creditsProblems(form: CreditsForm): CreditsProblem[] {
  const problems: CreditsProblem[] = [];
  const year = form.year.trim();
  if (year !== "" && !/^\d{4}$/.test(year)) problems.push("year");
  const ccli = form.ccli.trim();
  if (ccli !== "" && !/^\d{1,10}$/.test(ccli)) problems.push("ccli");
  return problems;
}

/** Modulo -> crediti; undefined se non c'e' nulla (l'elemento resta senza crediti). */
export function formToCredits(form: CreditsForm): Credits | undefined {
  const authors: Author[] = form.authors
    .map((a) => ({ name: a.name.trim(), role: a.role }))
    .filter((a) => a.name !== "");
  const text = (value: string) => {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  };
  const altTitles = form.altTitles
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const copyright = text(form.copyright);
  const publisher = text(form.publisher);
  const year = text(form.year);
  const ccli = text(form.ccli);
  const license = text(form.license);
  const empty =
    authors.length === 0 &&
    altTitles.length === 0 &&
    [copyright, publisher, year, ccli, license].every((v) => v === undefined);
  if (empty && form.show === "none") return undefined;
  return {
    authors,
    ...(altTitles.length === 0 ? {} : { altTitles }),
    ...(copyright === undefined ? {} : { copyright }),
    ...(publisher === undefined ? {} : { publisher }),
    ...(year === undefined ? {} : { year: Number(year) }),
    ...(ccli === undefined ? {} : { ccli }),
    ...(license === undefined ? {} : { license }),
    show: form.show,
  };
}
