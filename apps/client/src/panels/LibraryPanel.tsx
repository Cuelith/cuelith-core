import type { Library, LibraryItemSummary } from "@cuelith/protocol";
import { useState, type DragEvent, type KeyboardEvent } from "react";
import { useT } from "../engine/react.js";
import {
  LIBRARY_ITEM_DRAG,
  LIBRARY_PAGE,
  useLibraries,
  useLibraryItems,
  useLibraryTags,
} from "../station/library.js";
import { useRun, useStation } from "../station/station.js";
import { Button } from "../ui/Button.js";
import { ConfirmDialog, FieldLabel, INPUT, ModalDialog, PromptDialog } from "../ui/Dialogs.js";
import { LibraryDialog } from "./library/LibraryDialog.js";
import { LibraryPicker } from "./library/LibraryPicker.js";
import { MenuButton, type MenuItem } from "../ui/Menu.js";
import { EmptyState, Panel } from "../ui/Panel.js";

/** "INN 245 · Natale": in quali librerie sta un brano (nella vista di tutto l'archivio). */
function whereLabel(item: LibraryItemSummary): string {
  return item.libraries
    .map((m) =>
      m.code !== undefined ? [m.code, m.number].filter((p) => p !== undefined).join(" ") : m.name,
    )
    .join(", ");
}

const ENTRY_DRAG = "application/x-cuelith-library-entry";
const LIBRARY_KEY = "cuelith.library";

function readLibrary(): string | undefined {
  try {
    return localStorage.getItem(LIBRARY_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

type Dialog =
  | { kind: "library"; library: Library | undefined }
  | { kind: "deleteLibrary"; library: Library }
  | { kind: "addTo"; item: LibraryItemSummary }
  | { kind: "number"; item: LibraryItemSummary }
  | { kind: "deleteItem"; item: LibraryItemSummary };

/**
 * Librerie (decisione 0001): archivio con ricerca, librerie come playlist,
 * copie indipendenti, tag e numeri. Un elemento va in scaletta con
 * "In scaletta", doppio clic o trascinandolo nella scaletta.
 */
export function LibraryPanel() {
  const t = useT();
  const run = useRun();
  const { openEditor } = useStation();
  const libraries = useLibraries();
  const tags = useLibraryTags();
  const [saved, setSaved] = useState(readLibrary);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | undefined>();
  const [limit, setLimit] = useState(LIBRARY_PAGE);
  const [dialog, setDialog] = useState<Dialog | undefined>();
  const [dropIndex, setDropIndex] = useState<number | undefined>();

  // La libreria scelta vale solo se esiste ancora (un'altra postazione puo' eliminarla).
  const library = libraries?.find((l) => l.id === saved);
  const categories = [
    ...new Set((libraries ?? []).flatMap((l) => (l.category === undefined ? [] : [l.category]))),
  ];
  const libraryId = library?.id;
  const { items, total, loading } = useLibraryItems({ libraryId, query, tag, limit });

  const chooseLibrary = (id: string | undefined) => {
    setSaved(id);
    setLimit(LIBRARY_PAGE);
    try {
      if (id === undefined) localStorage.removeItem(LIBRARY_KEY);
      else localStorage.setItem(LIBRARY_KEY, id);
    } catch {
      // Vale comunque per questa sessione.
    }
  };

  const toPlaylist = (item: LibraryItemSummary) => {
    void run("playlist.addFromLibrary", { itemId: item.id });
  };

  const moveEntry = (entryId: string, toIndex: number) => {
    if (toIndex < 0 || toIndex >= items.length) return;
    void run("library.moveEntry", { entryId, toIndex });
  };

  // Invio resta sempre "manda in onda" (tasti della regia): qui solo Alt+frecce.
  const onRowKey = (event: KeyboardEvent, item: LibraryItemSummary, index: number) => {
    if (!event.altKey || item.entryId === undefined) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    moveEntry(item.entryId, index + (event.key === "ArrowUp" ? -1 : 1));
  };

  const insertionAt = (event: DragEvent<HTMLLIElement>, index: number) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? index : index + 1;
  };

  const onDrop = (event: DragEvent, target: number | undefined) => {
    const entryId = event.dataTransfer.getData(ENTRY_DRAG);
    setDropIndex(undefined);
    if (entryId === "" || target === undefined) return;
    event.preventDefault();
    const from = items.findIndex((i) => i.entryId === entryId);
    moveEntry(entryId, target > from ? target - 1 : target);
  };

  const itemMenu = (item: LibraryItemSummary): MenuItem[] => [
    {
      label: t("core.library.duplicate"),
      action: () =>
        void run("library.duplicateItem", {
          id: item.id,
          ...(libraryId === undefined ? {} : { libraryId }),
        }),
    },
    {
      label: t("core.library.addTo"),
      action: () => {
        setDialog({ kind: "addTo", item });
      },
    },
    ...(item.entryId === undefined
      ? []
      : [
          {
            label: t("core.library.setNumber"),
            action: () => {
              setDialog({ kind: "number", item });
            },
          },
          {
            label: t("core.library.removeFrom"),
            action: () => {
              if (item.entryId !== undefined)
                void run("library.removeEntry", { entryId: item.entryId });
            },
          },
        ]),
    {
      label: t("core.library.deleteItem"),
      danger: true,
      action: () => {
        setDialog({ kind: "deleteItem", item });
      },
    },
  ];

  return (
    <Panel
      label={t("core.panel.library")}
      actions={
        <Button
          size="sm"
          onClick={() => {
            openEditor({ mode: "libraryCreate", libraryId });
          }}
        >
          + {t("core.library.newItem")}
        </Button>
      }
    >
      <LibraryPicker
        libraries={libraries ?? []}
        selected={library}
        onSelect={chooseLibrary}
        onNew={() => {
          setDialog({ kind: "library", library: undefined });
        }}
        onEdit={(chosen) => {
          setDialog({ kind: "library", library: chosen });
        }}
        onDelete={(chosen) => {
          setDialog({ kind: "deleteLibrary", library: chosen });
        }}
      />

      <div className="flex items-center gap-1.5">
        <input
          type="search"
          aria-label={t("core.library.search")}
          placeholder={t("core.library.searchHint")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(LIBRARY_PAGE);
          }}
          className={`${INPUT} min-w-0 flex-1 py-1.5`}
        />
        {tags.length > 0 && (
          <select
            aria-label={t("core.library.tag")}
            value={tag ?? ""}
            onChange={(event) => {
              setTag(event.target.value === "" ? undefined : event.target.value);
            }}
            className={`${INPUT} w-28 py-1.5`}
          >
            <option value="">{t("core.library.allTags")}</option>
            {tags.map((entry) => (
              <option key={entry.tag} value={entry.tag}>
                {entry.tag}
              </option>
            ))}
          </select>
        )}
      </div>

      <p className="text-xs text-faint" aria-live="polite">
        {loading ? t("core.library.searching") : t("core.library.count", { count: total })}
      </p>

      {!loading && items.length === 0 ? (
        <EmptyState
          title={t(
            query !== "" || tag !== undefined ? "core.library.noResults" : "core.library.empty",
          )}
          hint={t("core.library.emptyHint")}
        />
      ) : (
        <ol
          aria-label={t("core.library.items")}
          className="flex min-h-0 flex-col gap-1 overflow-auto"
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setDropIndex(undefined);
          }}
          onDrop={(event) => {
            onDrop(event, dropIndex);
          }}
        >
          {items.map((item, index) => (
            <li
              key={item.entryId ?? item.id}
              draggable
              data-item={item.id}
              onDragStart={(event) => {
                event.dataTransfer.setData(LIBRARY_ITEM_DRAG, item.id);
                if (item.entryId !== undefined)
                  event.dataTransfer.setData(ENTRY_DRAG, item.entryId);
                event.dataTransfer.effectAllowed = "copyMove";
              }}
              onDragEnd={() => {
                setDropIndex(undefined);
              }}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(ENTRY_DRAG)) return;
                event.preventDefault();
                setDropIndex(insertionAt(event, index));
              }}
              onDrop={(event) => {
                if (!event.dataTransfer.types.includes(ENTRY_DRAG)) return;
                event.stopPropagation();
                onDrop(event, insertionAt(event, index));
              }}
              className="group relative flex items-center gap-2 rounded-md py-1.5 pr-1.5 pl-2 hover:bg-bg-2 focus-within:bg-bg-2"
            >
              {dropIndex === index && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 -top-[3px] h-0.5 rounded bg-cue"
                />
              )}
              {item.number !== undefined && (
                <span className="w-10 shrink-0 text-right font-mono text-xs text-muted">
                  {item.number}
                </span>
              )}
              <button
                type="button"
                onDoubleClick={() => {
                  toPlaylist(item);
                }}
                onKeyDown={(event) => {
                  onRowKey(event, item, index);
                }}
                title={t("core.library.rowHint")}
                className="flex min-w-0 flex-1 flex-col items-start text-left"
              >
                <span className="flex w-full items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{item.title}</span>
                  {item.derivedFrom !== undefined && (
                    <span className="shrink-0 rounded border border-mod-line px-1 text-[10px] text-mod">
                      {t("core.library.version")}
                    </span>
                  )}
                  {item.hasAttachments && (
                    <span
                      aria-label={t("core.library.hasAttachments")}
                      className="shrink-0 text-xs text-cue"
                    >
                      ♪
                    </span>
                  )}
                </span>
                <span className="w-full truncate text-xs text-muted">
                  {[
                    libraryId === undefined ? whereLabel(item) : "",
                    item.authors.join(", "),
                    t("core.playlist.slideCount", { count: item.slideCount }),
                    ...item.tags.map((tg) => `#${tg}`),
                  ]
                    .filter((part) => part !== "")
                    .join(" · ")}
                </span>
              </button>
              <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1 rounded-md bg-inherit pl-2 opacity-0 pointer-events-none group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
                <Button
                  size="sm"
                  tone="cue"
                  onClick={() => {
                    toPlaylist(item);
                  }}
                >
                  {t("core.library.toPlaylist")}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    openEditor({ mode: "libraryEdit", itemId: item.id });
                  }}
                >
                  {t("core.action.edit")}
                </Button>
                <MenuButton
                  label={t("core.library.itemMenu", { title: item.title })}
                  items={itemMenu(item)}
                  align="right"
                  className="rounded-md border border-line-2 px-1.5 py-0.5 text-xs text-muted hover:text-fg"
                >
                  ⋯
                </MenuButton>
              </div>
            </li>
          ))}
        </ol>
      )}
      {items.length < total && (
        <Button
          size="sm"
          onClick={() => {
            setLimit(limit + LIBRARY_PAGE);
          }}
        >
          {t("core.library.more")}
        </Button>
      )}

      {dialog?.kind === "library" && (
        <LibraryDialog
          library={dialog.library}
          categories={categories}
          onClose={() => {
            setDialog(undefined);
          }}
          onCreated={chooseLibrary}
        />
      )}
      {dialog?.kind === "deleteLibrary" && (
        <ConfirmDialog
          title={t("core.library.deleteTitle", { name: dialog.library.name })}
          message={t("core.library.deleteMessage")}
          confirm={t("core.library.delete")}
          onClose={() => {
            setDialog(undefined);
          }}
          onConfirm={() => {
            void run("library.delete", { id: dialog.library.id }).then((done) => {
              if (done !== undefined) chooseLibrary(undefined);
            });
          }}
        />
      )}
      {dialog?.kind === "deleteItem" && (
        <ConfirmDialog
          title={t("core.library.deleteItemTitle", { title: dialog.item.title })}
          message={t("core.library.deleteItemMessage")}
          confirm={t("core.library.deleteItem")}
          onClose={() => {
            setDialog(undefined);
          }}
          onConfirm={() => void run("library.deleteItem", { id: dialog.item.id })}
        />
      )}
      {dialog?.kind === "number" && dialog.item.entryId !== undefined && (
        <PromptDialog
          title={t("core.library.setNumber")}
          label={t("core.library.number")}
          initial={dialog.item.number ?? ""}
          confirm={t("core.action.save")}
          onClose={() => {
            setDialog(undefined);
          }}
          onSubmit={async (number) =>
            (await run("library.updateEntry", { entryId: dialog.item.entryId ?? "", number })) !==
            undefined
          }
        />
      )}
      {dialog?.kind === "addTo" && (
        <AddToLibraryDialog
          item={dialog.item}
          libraries={libraries ?? []}
          onClose={() => {
            setDialog(undefined);
          }}
        />
      )}
    </Panel>
  );
}

/** Aggiunge un elemento a un'altra libreria, con un numero facoltativo. */
function AddToLibraryDialog({
  item,
  libraries,
  onClose,
}: {
  item: LibraryItemSummary;
  libraries: readonly Library[];
  onClose: () => void;
}) {
  const t = useT();
  const run = useRun();
  const [target, setTarget] = useState(libraries[0]?.id ?? "");
  const [number, setNumber] = useState("");
  return (
    <ModalDialog title={t("core.library.addToTitle", { title: item.title })} onClose={onClose}>
      {(close) =>
        libraries.length === 0 ? (
          <div className="flex flex-col gap-4 p-5">
            <p className="text-sm text-muted">{t("core.library.noLibraries")}</p>
            <div className="flex justify-end">
              <Button onClick={close}>{t("core.action.close")}</Button>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = number.trim();
              void run("library.addEntry", {
                libraryId: target,
                itemId: item.id,
                ...(trimmed === "" ? {} : { number: trimmed }),
              }).then((done) => {
                if (done !== undefined) close();
              });
            }}
          >
            <label className="flex flex-col gap-1.5">
              <FieldLabel>{t("core.library.choose")}</FieldLabel>
              <select
                value={target}
                onChange={(event) => {
                  setTarget(event.target.value);
                }}
                className={INPUT}
              >
                {libraries.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <FieldLabel>{t("core.library.numberOptional")}</FieldLabel>
              <input
                value={number}
                onChange={(event) => {
                  setNumber(event.target.value);
                }}
                className={INPUT}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button onClick={close}>{t("core.action.cancel")}</Button>
              <Button type="submit" tone="primary">
                {t("core.library.add")}
              </Button>
            </div>
          </form>
        )
      }
    </ModalDialog>
  );
}
