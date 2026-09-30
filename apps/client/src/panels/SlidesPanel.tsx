import { slideSequence, type Item } from "@cuelith/protocol";
import { useEffect, useState } from "react";
import { useConnection, useEngine, useT } from "../engine/react.js";
import { useLibraries } from "../station/library.js";
import { directItemId } from "../station/direct.js";
import { itemOfEntry, roomStyle, slideText } from "../station/show.js";
import { useEditItem } from "../station/editItem.js";
import { useRun, useStation } from "../station/station.js";
import { Button } from "../ui/Button.js";
import { FieldLabel, INPUT, ModalDialog } from "../ui/Dialogs.js";
import { EmptyState, Panel } from "../ui/Panel.js";
import { SlideText } from "../ui/SlideText.js";

/**
 * Slide dell'elemento scelto, in miniature 16:9 disegnate col look Sala.
 * Clic = anteprima, doppio clic = in onda. Bordo rosso in onda, ciano in anteprima.
 */
export function SlidesPanel() {
  const t = useT();
  const { state } = useEngine();
  const { selectedEntryId } = useStation();
  const { editShowItem } = useEditItem();
  const run = useRun();
  if (state === undefined) return null;

  const { live } = state;
  // La voce di scaletta scelta; se non c'e', l'elemento mandato fuori scaletta.
  const directId = selectedEntryId === undefined ? directItemId(live) : undefined;
  const item =
    directId === undefined ? itemOfEntry(state, selectedEntryId) : live.direct?.[directId];
  const where =
    directId !== undefined
      ? { itemId: directId }
      : selectedEntryId === undefined
        ? undefined
        : { entryId: selectedEntryId };
  if (where === undefined || item === undefined) {
    return (
      <Panel label={t("core.panel.slides")}>
        <EmptyState title={t("core.slides.empty")} />
      </Panel>
    );
  }

  const style = roomStyle(state);
  const slides = slideSequence(item);
  const here = (cursor: { entryId?: string | undefined; itemId?: string | undefined }) =>
    "itemId" in where ? cursor.itemId === where.itemId : cursor.entryId === where.entryId;
  const liveIndex =
    live.layers.content.visible && here(live.cursor) ? live.cursor.slideIndex : undefined;
  const previewIndex = here(live.preview) ? live.preview.slideIndex : undefined;

  return (
    <Panel
      label={t("core.panel.slides")}
      actions={
        directId !== undefined ? (
          <DirectActions item={item} />
        ) : (
          <div className="flex gap-1.5">
            <SaveToLibrary item={item} />
            <Button
              size="sm"
              onClick={() => {
                editShowItem(item);
              }}
            >
              {t("core.action.edit")}
            </Button>
          </div>
        )
      }
    >
      <h3 className="truncate font-display text-lg font-semibold">
        {item.title === "" ? t("core.editor.untitled") : item.title}
      </h3>
      {directId !== undefined ? (
        <p className="text-xs" data-testid="direct-badge">
          <span
            title={t("core.direct.hint")}
            className="rounded border border-stage-line px-1.5 py-0.5 text-stage"
          >
            {t("core.direct.badge")}
          </span>
        </p>
      ) : (
        <LibraryLink item={item} />
      )}
      {slides.length === 0 ? (
        <EmptyState title={t("core.slides.none")} />
      ) : (
        <ol
          aria-label={t("core.panel.slides")}
          className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] content-start gap-2.5"
        >
          {slides.map((slide, index) => {
            const isLive = index === liveIndex;
            const isPreview = !isLive && index === previewIndex;
            return (
              <li key={`${slide.id}/${String(index)}`}>
                <button
                  type="button"
                  aria-label={t("core.slides.tileLabel", { n: index + 1 })}
                  data-state={isLive ? "live" : isPreview ? "preview" : undefined}
                  onClick={() => {
                    void run("preview.set", { ...where, slideIndex: index });
                  }}
                  onDoubleClick={() => {
                    void run("cue.goto", { ...where, slideIndex: index });
                  }}
                  className={`relative block aspect-video w-full overflow-hidden rounded-md border-2 bg-screen text-left ${
                    isLive
                      ? "border-live"
                      : isPreview
                        ? "border-cue"
                        : "border-line hover:border-line-2"
                  }`}
                >
                  <span className="absolute inset-0" style={{ containerType: "size" }}>
                    <SlideText text={slideText(slide)} style={style} />
                  </span>
                  {slide.group !== undefined && (
                    <span
                      data-testid="slide-group"
                      className="absolute top-1 left-1 rounded bg-mod-chip px-1.5 font-mono text-[10px] font-semibold text-mod"
                    >
                      {slide.group.toUpperCase()}
                    </span>
                  )}
                  <span
                    className={`absolute bottom-1 left-1 rounded px-1.5 font-mono text-[10px] font-semibold ${
                      isLive
                        ? "bg-live text-live-ink"
                        : isPreview
                          ? "bg-cue text-cue-ink"
                          : "bg-bg-3 text-muted"
                    }`}
                  >
                    {index + 1}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

/** Elemento fuori scaletta: si puo' mettere in scaletta (la copia viene dalla libreria). */
function DirectActions({ item }: { item: Item }) {
  const t = useT();
  const run = useRun();
  const { notify } = useStation();
  const libraryItemId = item.libraryRef?.itemId;
  if (libraryItemId === undefined) return null;
  return (
    <Button
      size="sm"
      onClick={() => {
        void run("playlist.addFromLibrary", { itemId: libraryItemId }).then((added) => {
          if (added !== undefined) notify("core.direct.added", { title: item.title }, "info");
        });
      }}
    >
      {t("core.direct.addToPlaylist")}
    </Button>
  );
}

/** Data dell'originale in libreria, riletta quando le librerie cambiano; null se non c'e' piu'. */
function useLibraryVersion(libraryItemId: string | undefined): string | null | undefined {
  const connection = useConnection();
  const rev = useEngine().state?.live.libraryRev;
  const [version, setVersion] = useState<{ id: string; updatedAt: string | null }>();
  useEffect(() => {
    if (libraryItemId === undefined || rev === undefined) return;
    let cancelled = false;
    connection
      .call("library.getItem", { id: libraryItemId })
      .then(({ updatedAt }) => {
        if (!cancelled) setVersion({ id: libraryItemId, updatedAt });
      })
      .catch(() => {
        if (!cancelled) setVersion({ id: libraryItemId, updatedAt: null });
      });
    return () => {
      cancelled = true;
    };
  }, [connection, libraryItemId, rev]);
  return version !== undefined && version.id === libraryItemId ? version.updatedAt : undefined;
}

/** Da quale libreria viene la copia nello show, e se l'originale e' cambiato. */
function LibraryLink({ item }: { item: Item }) {
  const t = useT();
  const run = useRun();
  const ref = item.libraryRef;
  const current = useLibraryVersion(ref?.itemId);
  if (ref === undefined) return null;
  const newer = typeof current === "string" && current > ref.updatedAt;
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-muted" data-testid="library-link">
      <span className="rounded border border-line-2 px-1.5 py-0.5">
        {t("core.library.fromLibrary")}
      </span>
      {current === null && <span className="text-faint">{t("core.library.originalGone")}</span>}
      {newer && (
        <>
          <span className="text-stage">{t("core.library.newerVersion")}</span>
          <Button
            size="sm"
            tone="cue"
            onClick={() => void run("item.refreshFromLibrary", { id: item.id })}
          >
            {t("core.library.refresh")}
          </Button>
        </>
      )}
    </p>
  );
}

/**
 * Salva in libreria un elemento dello show. Se viene gia' da una libreria
 * aggiorna l'originale; altrimenti chiede in quale libreria metterlo.
 */
function SaveToLibrary({ item }: { item: Item }) {
  const t = useT();
  const run = useRun();
  const { notify } = useStation();
  const [choosing, setChoosing] = useState(false);
  const save = async (libraryId?: string) => {
    const saved = await run("library.saveFromShow", {
      itemId: item.id,
      ...(libraryId === undefined ? {} : { libraryId }),
    });
    if (saved !== undefined) notify("core.library.saved", { title: item.title }, "info");
    return saved !== undefined;
  };
  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          if (item.libraryRef !== undefined) void save();
          else setChoosing(true);
        }}
      >
        {t("core.library.saveToLibrary")}
      </Button>
      {choosing && (
        <ChooseLibraryDialog
          title={t("core.library.saveToLibraryTitle", { title: item.title })}
          onClose={() => {
            setChoosing(false);
          }}
          onChoose={save}
        />
      )}
    </>
  );
}

function ChooseLibraryDialog({
  title,
  onClose,
  onChoose,
}: {
  title: string;
  onClose: () => void;
  onChoose: (libraryId: string | undefined) => Promise<boolean>;
}) {
  const t = useT();
  const libraries = useLibraries() ?? [];
  const [target, setTarget] = useState("");
  return (
    <ModalDialog title={title} onClose={onClose}>
      {(close) => (
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void onChoose(target === "" ? undefined : target).then((ok) => {
              if (ok) close();
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
              <option value="">{t("core.library.archiveOnly")}</option>
              {libraries.map((library) => (
                <option key={library.id} value={library.id}>
                  {library.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={close}>{t("core.action.cancel")}</Button>
            <Button type="submit" tone="primary">
              {t("core.action.save")}
            </Button>
          </div>
        </form>
      )}
    </ModalDialog>
  );
}
