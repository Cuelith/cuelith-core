import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Le lingue sono moduli (passo 7): nel codice della postazione non ci sono
// testi, solo chiavi tradotte dal modulo lingua. Queste prove falliscono se
// qualcuno scrive un testo direttamente nell'interfaccia, o usa una chiave
// che il modulo italiano non ha.

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../src");
const catalog = JSON.parse(
  readFileSync(path.resolve(here, "../../../../plugin-locale-it/locales/it.json"), "utf8"),
) as Record<string, string>;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return files(file);
    return /\.tsx?$/.test(name) ? [file] : [];
  });
}

/** Attributi il cui valore viene letto o mostrato all'utente. */
const TEXT_ATTRIBUTES = new Set(["aria-label", "title", "placeholder", "alt", "label"]);

/**
 * Testi ammessi nel codice: il nome del prodotto e nomi propri che non si
 * traducono (la licenza). Tutto il resto passa dalle chiavi.
 */
const ALLOWED = new Set(["Cuelith", "Apache 2.0"]);

/** Un testo "vero" contiene almeno una lettera: simboli e frecce non contano. */
const hasWords = (text: string) => /\p{L}{2,}/u.test(text);

function literalTexts(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: string[] = [];
  const report = (node: ts.Node, text: string) => {
    const clean = text.trim();
    if (!hasWords(clean) || ALLOWED.has(clean)) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart());
    found.push(`${path.relative(src, file)}:${String(line + 1)} «${clean}»`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) report(node, node.text);
    if (
      ts.isJsxAttribute(node) &&
      TEXT_ATTRIBUTES.has(node.name.getText()) &&
      node.initializer !== undefined
    ) {
      const value = ts.isJsxExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer;
      if (value !== undefined && ts.isStringLiteralLike(value)) report(node, value.text);
    }
    // Testo dentro {"..."} tra i tag.
    if (
      ts.isJsxExpression(node) &&
      node.expression !== undefined &&
      ts.isStringLiteralLike(node.expression) &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      report(node, node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("lingue come moduli", () => {
  it("nessun testo scritto direttamente nell'interfaccia della postazione", () => {
    expect(files(src).flatMap(literalTexts)).toEqual([]);
  });

  it("ogni chiave usata dalla postazione esiste nel modulo italiano", () => {
    const missing = new Set<string>();
    // Chiavi passate a t(...), a notify(...) e ai titoli dichiarati (titleKey/title).
    const pattern = /\b(?:t|notify)\(\s*"(core\.[A-Za-z0-9.]+)"/g;
    for (const file of files(src)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(pattern)) {
        const key = match[1] ?? "";
        const plural = [`${key}#one`, `${key}#other`].some((k) => Object.hasOwn(catalog, k));
        if (!Object.hasOwn(catalog, key) && !plural)
          missing.add(`${path.relative(src, file)} ${key}`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
