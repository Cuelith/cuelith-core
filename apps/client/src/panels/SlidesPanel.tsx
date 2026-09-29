import { slideSequence } from "@cuelith/protocol";
import { useEngine, useT } from "../engine/react.js";
import { itemOfEntry, roomStyle, slideText } from "../station/show.js";
import { useRun, useStation } from "../station/station.js";
import { Button } from "../ui/Button.js";
import { EmptyState, Panel } from "../ui/Panel.js";
import { SlideText } from "../ui/SlideText.js";

/**
 * Slide dell'elemento scelto, in miniature 16:9 disegnate col look Sala.
 * Clic = anteprima, doppio clic = in onda. Bordo rosso in onda, ciano in anteprima.
 */
export function SlidesPanel() {
  const t = useT();
  const { state } = useEngine();
  const { selectedEntryId, openEditor } = useStation();
  const run = useRun();
  if (state === undefined) return null;

  const item = itemOfEntry(state, selectedEntryId);
  if (selectedEntryId === undefined || item === undefined) {
    return (
      <Panel label={t("core.panel.slides")}>
        <EmptyState title={t("core.slides.empty")} />
      </Panel>
    );
  }

  const entryId = selectedEntryId;
  const { live } = state;
  const style = roomStyle(state);
  const slides = slideSequence(item);
  const liveIndex =
    live.layers.content.visible && live.cursor.entryId === entryId
      ? live.cursor.slideIndex
      : undefined;
  const previewIndex = live.preview.entryId === entryId ? live.preview.slideIndex : undefined;

  return (
    <Panel
      label={t("core.panel.slides")}
      actions={
        <Button
          size="sm"
          onClick={() => {
            openEditor({ mode: "edit", itemId: item.id });
          }}
        >
          {t("core.action.edit")}
        </Button>
      }
    >
      <h3 className="truncate font-display text-lg font-semibold">
        {item.title === "" ? t("core.editor.untitled") : item.title}
      </h3>
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
                    void run("preview.set", { entryId, slideIndex: index });
                  }}
                  onDoubleClick={() => {
                    void run("cue.goto", { entryId, slideIndex: index });
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
      <p className="text-xs text-faint">{t("core.slides.hint")}</p>
    </Panel>
  );
}
