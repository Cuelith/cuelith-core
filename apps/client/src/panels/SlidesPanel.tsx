import { slideSequence, type Item } from "@cuelith/protocol";
import { useEffect, useRef, useState } from "react";
import { useConnection, useEngine, useT } from "../engine/react.js";
import { useLibraries } from "../station/library.js";
import { directItemId } from "../station/direct.js";
import { itemOfEntry, roomStyleFor, slideText } from "../station/show.js";
import { itemFit } from "../station/textStyles.js";
import { useEditItem } from "../station/editItem.js";
import { useRun, useStation } from "../station/station.js";
import { Button } from "../ui/Button.js";
import { FieldLabel, INPUT, ModalDialog } from "../ui/Dialogs.js";
import { EmptyState, Panel } from "../ui/Panel.js";
import { backgroundUrl } from "../station/backgrounds.js";
import { SlideText } from "../ui/SlideText.js";

/** Dimensioni delle miniature: piccole per vedere tutto un brano, grandi per leggere il testo. */
const ZOOMS = {
  s: { min: 110, label: "S" },
  m: { min: 150, label: "M" },
  l: { min: 240, label: "L" },
} as const;
type Zoom = keyof typeof ZOOMS;
const ZOOM_KEY = "cuelith.slides.zoom";

function readZoom(): Zoom {
  try {
    const saved = localStorage.getItem(ZOOM_KEY);
    return saved === "s" || saved === "l" ? saved : "m";
  } catch {
    return "m";
  }
}

/** Colore dell'etichetta di una sezione, dalla sua lettera (V strofa, C ritornello, B ponte...). */
function groupTone(group: string): string {
  switch (group.charAt(0).toLowerCase()) {
    case "c":
      return "bg-cue-bg text-cue";
    case "b":
      return "bg-stage-bg text-stage";
    case "p":
      return "bg-cue-bg text-mod";
    case "v":
      return "bg-mod-chip text-mod";
    default:
      return "bg-bg-3 text-muted";
  }
}

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
  const [zoom, setZoom] = useState<Zoom>(readZoom);
  // La slide in onda o in anteprima si porta da sola in vista (brani lunghi).
  const focused = useRef<HTMLLIElement | null>(null);
  const liveKey =
    state === undefined ? "" : `${state.live.cursor.slideIndex}/${state.live.preview.slideIndex}`;
  useEffect(() => {
    focused.current?.scrollIntoView({ block: "nearest" });
  }, [liveKey]);
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

  const style = roomStyleFor(state, item);
  const fit = itemFit(state, style, item);
  const slides = slideSequence(item);
  const here = (cursor: { entryId?: string | undefined; itemId?: string | undefined }) =>
    "itemId" in where ? cursor.itemId === where.itemId : cursor.entryId === where.entryId;
  const liveIndex =
    live.layers.content.visible && here(live.cursor) ? live.cursor.slideIndex : undefined;
  const previewIndex = here(live.preview) ? live.preview.slideIndex : undefined;
  const choose = (next: Zoom) => {
    setZoom(next);
    try {
      localStorage.setItem(ZOOM_KEY, next);
    } catch {
      // La dimensione vale comunque finche' la finestra resta aperta.
    }
  };

  return (
    <Panel
      label={t("core.panel.slides")}
      actions={
        directId !== undefined ? (
          <DirectActions item={item} />
        ) : (
          <div className="flex gap-1.5">
            <div
              role="group"
              aria-label={t("core.slides.zoom")}
              className="flex overflow-hidden rounded-md border border-line-2"
            >
              {(Object.keys(ZOOMS) as Zoom[]).map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={zoom === size}
                  title={t("core.slides.zoom")}
                  onClick={() => {
                    choose(size);
                  }}
                  className={`px-2 py-0.5 text-xs ${
                    zoom === size ? "bg-cue-bg text-fg" : "text-muted hover:text-fg"
                  }`}
                >
                  {ZOOMS[size].label}
                </button>
              ))}
            </div>
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
      <p className="-mt-1 text-xs text-faint">
        {t("core.playlist.slideCount", { count: slides.length })}
      </p>
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
          className="grid content-start gap-2.5"
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${String(ZOOMS[zoom].min)}px, 1fr))`,
          }}
        >
          {slides.map((slide, index) => {
            const isLive = index === liveIndex;
            const isPreview = !isLive && index === previewIndex;
            return (
              <li
                key={`${slide.id}/${String(index)}`}
                ref={(node) => {
                  if (isLive || (liveIndex === undefined && isPreview)) focused.current = node;
                }}
              >
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
                    <SlideText
                      text={slideText(slide)}
                      style={style}
                      fit={fit}
                      background={backgroundUrl(style, item, slide)}
                    />
                  </span>
                  {slide.group !== undefined && (
                    <span
                      data-testid="slide-group"
                      className={`absolute top-1 left-1 rounded px-1.5 font-mono text-[10px] font-semibold ${groupTone(slide.group)}`}
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
                    {/* Non solo il colore: chi non distingue il rosso dal ciano legge lo stato. */}
                    {(isLive || isPreview) && (
                      <span className="ml-1 font-sans">
                        {t(isLive ? "core.slides.state.live" : "core.slides.state.preview")}
                      </span>
                    )}
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
