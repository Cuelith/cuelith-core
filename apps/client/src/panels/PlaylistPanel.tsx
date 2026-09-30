import { slideSequence } from "@cuelith/protocol";
import { useState, type DragEvent, type KeyboardEvent } from "react";
import { useEngine, useT } from "../engine/react.js";
import { useChooseEntry } from "../station/choose.js";
import { useRun, useStation } from "../station/station.js";
import { Button } from "../ui/Button.js";
import { EmptyState, Panel } from "../ui/Panel.js";

const DRAG_TYPE = "application/x-cuelith-entry";

/** Scaletta (cap. 04): voci nell'ordine dell'evento, in onda in rosso, in anteprima in ciano. */
export function PlaylistPanel() {
  const t = useT();
  const { state } = useEngine();
  const { selectedEntryId, select, openEditor } = useStation();
  const choose = useChooseEntry();
  const run = useRun();
  const [dropIndex, setDropIndex] = useState<number | undefined>();
  if (state === undefined) return null;

  const { playlist, items } = state.show;
  const { live } = state;
  const liveEntry = live.layers.content.visible ? live.cursor.entryId : undefined;
  const previewEntry = live.preview.entryId;

  const move = (entryId: string, toIndex: number) => {
    const from = playlist.findIndex((e) => e.id === entryId);
    if (from === -1 || toIndex === from || toIndex < 0 || toIndex >= playlist.length) return;
    void run("playlist.move", { entryId, toIndex });
  };

  const remove = async (entryId: string, itemId: string) => {
    if ((await run("playlist.remove", { entryId })) === undefined) return;
    if (selectedEntryId === entryId) select(undefined);
    // In Presenta non c'e' una libreria: un elemento senza voci resterebbe invisibile.
    if (!playlist.some((e) => e.id !== entryId && e.itemId === itemId)) {
      await run("item.delete", { id: itemId });
    }
  };

  /** Punto d'inserimento sopra o sotto la voce, dalla posizione del puntatore. */
  const insertionAt = (event: DragEvent<HTMLLIElement>, index: number): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? index : index + 1;
  };

  const onDragOver = (event: DragEvent<HTMLLIElement>, index: number) => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    setDropIndex(insertionAt(event, index));
  };

  // Il punto di rilascio si calcola dall'evento stesso: lo stato della linea
  // guida potrebbe non essere ancora aggiornato se si rilascia molto in fretta.
  const onDrop = (event: DragEvent, target: number | undefined) => {
    event.preventDefault();
    event.stopPropagation();
    const entryId = event.dataTransfer.getData(DRAG_TYPE);
    setDropIndex(undefined);
    if (entryId === "" || target === undefined) return;
    const from = playlist.findIndex((e) => e.id === entryId);
    move(entryId, target > from ? target - 1 : target);
  };

  const onRowKey = (event: KeyboardEvent, entryId: string, index: number) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    move(entryId, index + (event.key === "ArrowUp" ? -1 : 1));
  };

  const newText = () => {
    openEditor({ mode: "create" });
  };

  return (
    <Panel
      label={t("core.panel.playlist")}
      actions={
        <Button size="sm" onClick={newText}>
          + {t("core.playlist.newText")}
        </Button>
      }
    >
      {playlist.length === 0 ? (
        <EmptyState title={t("core.playlist.empty")} hint={t("core.playlist.emptyHint")} />
      ) : (
        <ol
          aria-label={t("core.playlist.label")}
          className="flex min-h-0 flex-col gap-1 overflow-auto"
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDropIndex(undefined);
            }
          }}
          onDrop={(event) => {
            onDrop(event, dropIndex);
          }}
        >
          {playlist.map((entry, index) => {
            const item = items[entry.itemId];
            if (item === undefined) return null;
            const count = slideSequence(item).length;
            const isLive = entry.id === liveEntry;
            const isPreview = !isLive && entry.id === previewEntry;
            const selected = entry.id === selectedEntryId;
            return (
              <li
                key={entry.id}
                draggable
                data-entry={entry.id}
                data-state={isLive ? "live" : isPreview ? "preview" : undefined}
                onDragStart={(event) => {
                  event.dataTransfer.setData(DRAG_TYPE, entry.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  setDropIndex(undefined);
                }}
                onDragOver={(event) => {
                  onDragOver(event, index);
                }}
                onDrop={(event) => {
                  onDrop(event, insertionAt(event, index));
                }}
                className={`group relative flex items-center gap-2 rounded-md border-l-[3px] py-1.5 pr-1.5 pl-2.5 ${
                  isLive
                    ? "border-live bg-live-bg"
                    : isPreview
                      ? "border-cue bg-cue-bg"
                      : selected
                        ? "border-transparent bg-bg-3"
                        : "border-transparent hover:bg-bg-2"
                } ${selected ? "outline outline-line-2" : ""}`}
              >
                {dropIndex === index && <DropLine edge="top" />}
                {dropIndex === index + 1 && index === playlist.length - 1 && (
                  <DropLine edge="bottom" />
                )}
                <button
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => {
                    choose(entry.id);
                  }}
                  onDoubleClick={() => {
                    openEditor({ mode: "edit", itemId: item.id });
                  }}
                  onKeyDown={(event) => {
                    onRowKey(event, entry.id, index);
                  }}
                  className="flex min-w-0 flex-1 flex-col items-start text-left"
                >
                  <span className="w-full truncate text-sm font-medium">
                    {item.title === "" ? t("core.editor.untitled") : item.title}
                  </span>
                  <span className="text-xs text-muted">
                    {isLive
                      ? t("core.playlist.live")
                      : isPreview
                        ? t("core.playlist.inPreview")
                        : t("core.playlist.slideCount", { count })}
                  </span>
                </button>
                <div className="flex shrink-0 gap-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                  <Button
                    size="sm"
                    onClick={() => {
                      openEditor({ mode: "edit", itemId: item.id });
                    }}
                  >
                    {t("core.action.edit")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={isLive}
                    title={isLive ? t("core.playlist.removeLive") : undefined}
                    onClick={() => {
                      void remove(entry.id, item.id);
                    }}
                  >
                    {t("core.action.remove")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {playlist.length > 1 && <p className="text-xs text-faint">{t("core.playlist.moveHint")}</p>}
    </Panel>
  );
}

function DropLine({ edge }: { edge: "top" | "bottom" }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-0 h-0.5 rounded bg-cue ${
        edge === "top" ? "-top-[3px]" : "-bottom-[3px]"
      }`}
    />
  );
}
