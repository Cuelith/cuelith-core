import type { Library } from "@cuelith/protocol";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useT } from "../../engine/react.js";
import { useRun } from "../../station/station.js";

const RECENT_KEY = "cuelith.library.recent";
const RECENT_MAX = 5;

export function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function rememberRecent(id: string): void {
  try {
    const next = [id, ...readRecent().filter((v) => v !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Le recenti sono una comodita': senza memoria locale si fa senza.
  }
}

interface Section {
  readonly key: string;
  readonly title: string;
  readonly libraries: readonly Library[];
}

/** Gruppi del selettore: preferite, recenti, poi una sezione per categoria. */
function sections(
  libraries: readonly Library[],
  recent: readonly string[],
  labels: { favorites: string; recent: string; none: string },
): Section[] {
  const result: Section[] = [];
  const favorites = libraries.filter((l) => l.favorite);
  if (favorites.length > 0)
    result.push({ key: "fav", title: labels.favorites, libraries: favorites });
  const recents = recent
    .map((id) => libraries.find((l) => l.id === id))
    .filter((l): l is Library => l !== undefined && !l.favorite);
  if (recents.length > 0) result.push({ key: "recent", title: labels.recent, libraries: recents });
  const byCategory = new Map<string, Library[]>();
  for (const library of libraries) {
    const category = library.category ?? "";
    byCategory.set(category, [...(byCategory.get(category) ?? []), library]);
  }
  const collator = new Intl.Collator(undefined, { sensitivity: "base" });
  const names = [...byCategory.keys()].filter((c) => c !== "").sort(collator.compare);
  for (const name of names) {
    result.push({ key: `cat:${name}`, title: name, libraries: byCategory.get(name) ?? [] });
  }
  const loose = byCategory.get("");
  if (loose !== undefined) result.push({ key: "none", title: labels.none, libraries: loose });
  return result;
}

function matches(library: Library, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (q === "") return true;
  const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  return [library.name, library.code ?? "", library.category ?? ""].some((field) =>
    plain(field).includes(plain(q)),
  );
}

export function LibraryDot({ color }: { color: string | undefined }) {
  return (
    <span
      aria-hidden="true"
      className="h-2.5 w-2.5 shrink-0 rounded-full border border-line-2"
      style={color === undefined ? undefined : { background: color, borderColor: color }}
    />
  );
}

/**
 * Scelta della libreria quando sono tante (decisione 0004): ricerca per nome,
 * sigla o categoria; preferite e recenti in cima; poi per categoria.
 */
export function LibraryPicker({
  libraries,
  selected,
  onSelect,
  onNew,
  onEdit,
  onDelete,
}: {
  libraries: readonly Library[];
  selected: Library | undefined;
  onSelect: (id: string | undefined) => void;
  onNew: () => void;
  onEdit: (library: Library) => void;
  onDelete: (library: Library) => void;
}) {
  const t = useT();
  const run = useRun();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [place, setPlace] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  }>();
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const popupId = useId();

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    // Se la finestra cambia misura l'elenco non sarebbe piu' al suo posto: si chiude.
    const onResize = () => {
      setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const choose = (id: string | undefined) => {
    if (id !== undefined) rememberRecent(id);
    onSelect(id);
    setOpen(false);
    setQuery("");
  };

  const onKey = (event: KeyboardEvent) => {
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>("[data-choice]") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = index === -1 ? (step === 1 ? 0 : buttons.length - 1) : index + step;
      buttons[(next + buttons.length) % buttons.length]?.focus();
    }
  };

  const filtered = libraries.filter((l) => matches(l, query));
  const groups =
    query.trim() === ""
      ? sections(libraries, readRecent(), {
          favorites: t("core.library.favorites"),
          recent: t("core.library.recent"),
          none: t("core.library.noCategory"),
        })
      : [{ key: "found", title: t("core.library.found"), libraries: filtered }];

  const row = (library: Library, sectionKey: string) => (
    <li key={`${sectionKey}:${library.id}`} className="flex items-center gap-1">
      <button
        type="button"
        data-choice
        aria-current={selected?.id === library.id ? "true" : undefined}
        onClick={() => {
          choose(library.id);
        }}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg-3 focus:bg-bg-3 ${
          selected?.id === library.id ? "bg-bg-3 font-semibold" : ""
        }`}
      >
        <LibraryDot color={library.color} />
        <span className="min-w-0 flex-1 truncate">{library.name}</span>
        {library.code !== undefined && (
          <span className="shrink-0 rounded bg-bg px-1.5 font-mono text-[11px] text-muted">
            {library.code}
          </span>
        )}
        <span className="shrink-0 font-mono text-[11px] text-faint">{library.count}</span>
      </button>
      <button
        type="button"
        aria-pressed={library.favorite}
        aria-label={t(library.favorite ? "core.library.unfavorite" : "core.library.favorite", {
          name: library.name,
        })}
        title={t(library.favorite ? "core.library.unfavorite" : "core.library.favorite", {
          name: library.name,
        })}
        onClick={() => void run("library.update", { id: library.id, favorite: !library.favorite })}
        className={`shrink-0 rounded px-1.5 py-1 text-sm ${library.favorite ? "text-stage" : "text-faint hover:text-muted"}`}
      >
        {library.favorite ? "★" : "☆"}
      </button>
    </li>
  );

  return (
    <div ref={root} className="relative min-w-0" onKeyDown={open ? onKey : undefined}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        aria-label={t("core.library.chooseCurrent", {
          name: selected?.name ?? t("core.library.archive"),
        })}
        onClick={(event) => {
          // Si riapre sempre pulito: la ricerca precedente non resta.
          if (!open) {
            setQuery("");
            // L'elenco galleggia sopra tutto, ancorato al pulsante e dentro la finestra.
            const rect = event.currentTarget.getBoundingClientRect();
            const top = rect.bottom + 4;
            setPlace({
              top,
              left: rect.left,
              width: Math.max(rect.width, 320),
              maxHeight: Math.max(200, window.innerHeight - top - 16),
            });
          }
          setOpen(!open);
        }}
        className="flex w-full min-w-0 items-center gap-2 rounded-md border border-line-2 bg-bg px-3 py-1.5 text-left text-sm hover:border-faint"
      >
        {selected === undefined ? (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-sm border border-faint"
            aria-hidden="true"
          />
        ) : (
          <LibraryDot color={selected.color} />
        )}
        <span className="min-w-0 flex-1 truncate">
          {selected?.name ?? t("core.library.archive")}
        </span>
        {selected?.code !== undefined && (
          <span className="shrink-0 rounded bg-bg-3 px-1.5 font-mono text-[11px] text-muted">
            {selected.code}
          </span>
        )}
        <span aria-hidden="true" className="text-faint">
          ▾
        </span>
      </button>

      {open && (
        <div
          id={popupId}
          role="dialog"
          aria-label={t("core.library.choose")}
          style={place}
          className="fixed z-40 flex flex-col rounded-lg border border-line-2 bg-bg-2 shadow-xl"
        >
          <div className="border-b border-line p-2">
            <input
              ref={search}
              type="search"
              aria-label={t("core.library.findLibrary")}
              placeholder={t("core.library.findLibraryHint")}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              className="w-full rounded-md border border-line-2 bg-bg px-3 py-1.5 text-sm"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-1">
            {query.trim() === "" && (
              <ul>
                <li>
                  <button
                    type="button"
                    data-choice
                    aria-current={selected === undefined ? "true" : undefined}
                    onClick={() => {
                      choose(undefined);
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg-3 focus:bg-bg-3 ${
                      selected === undefined ? "bg-bg-3 font-semibold" : ""
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-sm border border-faint"
                      aria-hidden="true"
                    />
                    {t("core.library.archive")}
                  </button>
                </li>
              </ul>
            )}
            {groups.map((group) => (
              <section key={group.key} aria-label={group.title} className="mt-1">
                <h3 className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                  {group.title}
                </h3>
                <ul>{group.libraries.map((library) => row(library, group.key))}</ul>
              </section>
            ))}
            {query.trim() !== "" && filtered.length === 0 && (
              <p className="px-2 py-3 text-sm text-faint">{t("core.library.noLibraryFound")}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-1 border-t border-line p-1.5">
            <button
              type="button"
              data-choice
              onClick={() => {
                setOpen(false);
                onNew();
              }}
              className="rounded-md px-2 py-1 text-[13px] text-cue hover:bg-bg-3 focus:bg-bg-3"
            >
              + {t("core.library.new")}
            </button>
            {selected !== undefined && (
              <>
                <button
                  type="button"
                  data-choice
                  onClick={() => {
                    setOpen(false);
                    onEdit(selected);
                  }}
                  className="rounded-md px-2 py-1 text-[13px] text-muted hover:bg-bg-3 hover:text-fg focus:bg-bg-3"
                >
                  {t("core.library.edit")}
                </button>
                <button
                  type="button"
                  data-choice
                  onClick={() => {
                    setOpen(false);
                    onDelete(selected);
                  }}
                  className="ml-auto rounded-md px-2 py-1 text-[13px] text-live-soft hover:bg-bg-3 focus:bg-bg-3"
                >
                  {t("core.library.delete")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
