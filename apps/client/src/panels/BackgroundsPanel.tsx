import {
  mediaUri,
  mediaUrl,
  slideSequence,
  type MediaInfo,
  type MediaRef,
} from "@cuelith/protocol";
import { useEffect, useState } from "react";
import { useConnection, useEngine, useT } from "../engine/react.js";
import { roomLook, useChooseBackground } from "../station/backgrounds.js";
import { itemOfEntry } from "../station/show.js";
import { useRun, useStation } from "../station/station.js";
import { HScroll } from "../ui/HScroll.js";
import { Panel } from "../ui/Panel.js";

/** Velo scuro sopra gli sfondi: nessuno, leggero, medio, forte. */
const DIMS = [
  ["none", 0],
  ["light", 0.25],
  ["medium", 0.45],
  ["strong", 0.65],
] as const;

type Target = "slide" | "item" | "look";

/**
 * Sfondi dei testi (decisione 0003): le immagini dell'archivio come
 * miniature; un clic mette lo sfondo dove si e' scelto (la slide, tutto
 * l'elemento, o il predefinito del look Sala), «Nessuno» lo toglie. Il velo
 * scurisce gli sfondi perche' il testo resti leggibile.
 */
export function BackgroundsPanel() {
  const t = useT();
  const run = useRun();
  const connection = useConnection();
  const { state } = useEngine();
  const { selectedEntryId } = useStation();
  const choose = useChooseBackground();
  const [images, setImages] = useState<readonly MediaInfo[]>([]);
  const [wanted, setWanted] = useState<Target>("item");
  // L'archivio cambia quando si importa un file: l'elenco si rilegge.
  const libraryRev = state?.live.libraryRev;
  const [imported, setImported] = useState(0);
  useEffect(() => {
    let alive = true;
    connection.call("media.list", { kind: "image" }).then(
      (result) => {
        if (alive) setImages(result.media);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [connection, libraryRev, imported]);

  if (state === undefined) return null;
  const room = roomLook(state);
  const item = itemOfEntry(state, selectedEntryId);
  // La slide a cui si riferisce «Slide»: quella in anteprima, altrimenti quella in onda.
  const { live } = state;
  const here = (cursor: { entryId?: string | undefined }) =>
    selectedEntryId !== undefined && cursor.entryId === selectedEntryId;
  const slideIndex = here(live.preview)
    ? live.preview.slideIndex
    : here(live.cursor)
      ? live.cursor.slideIndex
      : undefined;
  const slide =
    item === undefined || slideIndex === undefined ? undefined : slideSequence(item)[slideIndex];

  // Se quello scelto non c'e' (nessun elemento, nessuna slide) si ripiega sul successivo.
  const available: Record<Target, boolean> = {
    slide: slide !== undefined,
    item: item !== undefined,
    look: room !== undefined,
  };
  const target = available[wanted]
    ? wanted
    : (["item", "look", "slide"] as const).find((candidate) => available[candidate]);
  const current =
    target === "slide"
      ? slide?.background?.uri
      : target === "item"
        ? item?.background?.uri
        : room?.style.background.image;

  const setLook = (background: { image?: string | undefined; dim?: number }) => {
    if (room === undefined) return;
    const { image, ...rest } = { ...room.style.background, ...background };
    void run("look.update", {
      id: room.look.id,
      style: { ...room.style, background: image === undefined ? rest : { ...rest, image } },
    });
  };
  const apply = (background: MediaRef | null) => {
    if (target === "slide" && item !== undefined && slide !== undefined) {
      void run("slide.update", { itemId: item.id, slideId: slide.id, background });
    } else if (target === "item" && item !== undefined) {
      void run("item.update", { id: item.id, background });
    } else if (target === "look") {
      setLook({ image: background?.uri });
    }
  };
  const targetLabel = (which: Target) =>
    which === "slide"
      ? t("core.backgrounds.target.slide", {
          n: slideIndex === undefined ? "" : String(slideIndex + 1),
        })
      : which === "item"
        ? t("core.backgrounds.target.item")
        : t("core.backgrounds.target.look", { look: room?.look.name ?? "" });
  const tile =
    "relative h-14 w-24 flex-none overflow-hidden rounded-md border-2 bg-screen text-[11px] text-muted";
  const dim = room?.style.background.dim ?? 0;

  return (
    <Panel
      label={t("core.panel.backgrounds")}
      labelHidden
      tight
      actions={
        <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
          <HScroll
            role="radiogroup"
            label={t("core.backgrounds.target")}
            className="min-w-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {(["slide", "item", "look"] as const).map((which) => (
              <button
                key={which}
                type="button"
                role="radio"
                aria-checked={target === which}
                disabled={!available[which]}
                onClick={() => {
                  setWanted(which);
                }}
                className={`flex-none rounded-md border px-2 py-0.5 text-xs disabled:opacity-40 ${
                  target === which
                    ? "border-cue bg-cue-bg text-fg"
                    : "border-line-2 text-muted hover:text-fg"
                }`}
              >
                {targetLabel(which)}
              </button>
            ))}
          </HScroll>
          {room !== undefined && (
            <label className="flex items-center gap-1.5 text-xs text-muted">
              {t("core.backgrounds.dim")}
              <select
                value={String(dim)}
                onChange={(event) => {
                  setLook({ dim: Number(event.target.value) });
                }}
                className="rounded-md border border-line-2 bg-bg px-1.5 py-0.5 text-xs text-fg"
              >
                {/* Un valore salvato fuori dall'elenco resta scelto cosi' com'e'. */}
                {!DIMS.some(([, value]) => value === dim) && (
                  <option value={String(dim)}>{`${String(Math.round(dim * 100))}%`}</option>
                )}
                {DIMS.map(([name, value]) => (
                  <option key={name} value={String(value)}>
                    {t(`core.backgrounds.dim.${name}`)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      }
    >
      <ul
        aria-label={t("core.backgrounds.images")}
        onWheel={(event) => {
          // Rotella verticale = scorrimento di lato: la fila non scorre mai in verticale.
          if (Math.abs(event.deltaY) > Math.abs(event.deltaX))
            event.currentTarget.scrollLeft += event.deltaY;
        }}
        className="flex flex-none flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden pb-1"
      >
        <li className="flex-none">
          <button
            type="button"
            aria-pressed={current === undefined}
            disabled={target === undefined}
            onClick={() => {
              apply(null);
            }}
            className={`${tile} grid place-items-center ${
              current === undefined ? "border-cue" : "border-line hover:border-line-2"
            }`}
          >
            {t("core.backgrounds.none")}
          </button>
        </li>
        {images.map((image) => {
          const uri = mediaUri(image.id);
          return (
            <li key={image.id}>
              <button
                type="button"
                aria-label={image.name}
                title={image.name}
                aria-pressed={current === uri}
                disabled={target === undefined}
                onClick={() => {
                  apply({ uri, kind: "image" });
                }}
                className={`${tile} block ${
                  current === uri ? "border-cue" : "border-line hover:border-line-2"
                }`}
              >
                <img
                  src={mediaUrl(uri)}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className="h-full w-full object-cover"
                />
              </button>
            </li>
          );
        })}
        {choose !== undefined && (
          <li className="flex-none">
            <button
              type="button"
              aria-label={t("core.backgrounds.add")}
              title={t("core.backgrounds.add")}
              disabled={target === undefined}
              onClick={() => {
                void choose().then((background) => {
                  if (background === undefined) return;
                  apply(background);
                  setImported((n) => n + 1);
                });
              }}
              className={`${tile} grid place-items-center border-dashed border-faint text-lg hover:border-muted hover:text-fg`}
            >
              +
            </button>
          </li>
        )}
      </ul>
    </Panel>
  );
}
