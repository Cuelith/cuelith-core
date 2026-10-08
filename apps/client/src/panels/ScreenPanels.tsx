import type { FullscreenStyle } from "@cuelith-core/core-looks";
import { useContext, useMemo } from "react";
import { CurrentModeContext } from "../station/currentMode.js";
import { useEngine, useT } from "../engine/react.js";
import {
  previewSlide,
  programSlide,
  roomStyleFor,
  slideText,
  type ShownSlide,
} from "../station/show.js";
import { useScreensSwapped } from "../station/screenSwap.js";
import { useRun } from "../station/station.js";
import { itemFit } from "../station/textStyles.js";
import { Button } from "../ui/Button.js";
import { Crossfade } from "../ui/Crossfade.js";
import { Panel } from "../ui/Panel.js";
import { Screen, ScreenEmpty } from "../ui/Screen.js";
import { backgroundUrl } from "../station/backgrounds.js";
import { SlideText } from "../ui/SlideText.js";

const keyOf = (slide: ShownSlide | undefined): string => slide?.key ?? "empty";

function transitionMs(style: FullscreenStyle | undefined): number {
  return style?.transition.type === "fade" ? style.transition.durationMs : 0;
}

/** «Titolo · 3 di 7», o niente se non c'e' una slide. */
function useCaption(slide: ShownSlide | undefined): string {
  const t = useT();
  if (slide === undefined) return "";
  return t("core.program.position", {
    title: slide.item.title === "" ? t("core.editor.untitled") : slide.item.title,
    n: slide.index + 1,
    count: slide.count,
  });
}

function Caption({ slide }: { slide: ShownSlide | undefined }) {
  const text = useCaption(slide);
  return <p className="min-h-5 truncate text-xs text-muted">{text}</p>;
}

/**
 * Programma: cio' che e' in onda, con la dissolvenza del look Sala. In «Presenta» il riquadro
 * riempie lo spazio che ha (niente scorrimento) e i comandi stanno sotto, su una riga.
 */
export function ProgramPanel() {
  const t = useT();
  const mode = useContext(CurrentModeContext);
  const { state } = useEngine();
  const run = useRun();
  const slide = useMemo(() => (state === undefined ? undefined : programSlide(state)), [state]);
  const style = useMemo(
    () => (state === undefined ? undefined : roomStyleFor(state, slide?.item)),
    [state, slide],
  );
  const fit = state === undefined ? 1 : itemFit(state, style, slide?.item);
  const program = state?.live.cursor.entryId;
  // «Solo sfondo»: il programma mostra quello che vede il pubblico, cioe' lo sfondo senza testo.
  const bare = state?.live.textHidden === true;
  const caption = useCaption(slide);
  const fill = mode === "core.present";
  const [swapped, toggleSwap] = useScreensSwapped();

  const screen = (
    <Crossfade
      value={slide}
      keyOf={keyOf}
      durationMs={transitionMs(style)}
      render={(shown) =>
        shown === undefined ? (
          <ScreenEmpty text={t("core.program.empty")} />
        ) : (
          <SlideText
            text={slideText(shown.slide)}
            style={style}
            fit={fit}
            hideText={bare}
            credits={shown.credits}
            background={backgroundUrl(style, shown.item, shown.slide)}
          />
        )
      }
    />
  );

  return (
    <Panel label={t("core.panel.program")} labelHidden>
      {fill ? (
        <Screen tone="live" fill label={t("core.panel.program")} caption={caption}>
          {screen}
        </Screen>
      ) : (
        <>
          <Screen tone="live" label={t("core.panel.program")}>
            {screen}
          </Screen>
          <Caption slide={slide} />
        </>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button disabled={program === undefined} onClick={() => void run("cue.prev", {})}>
          ← {t("core.program.prev")}
        </Button>
        <Button onClick={() => void run("cue.next", {})}>{t("core.program.next")} →</Button>
        <Button
          tone="live"
          disabled={slide === undefined}
          onClick={() => void run("layer.clear", { layer: "content" })}
        >
          {t("core.program.clear")}
        </Button>
        <Button
          tone="live"
          aria-pressed={bare}
          title={t("core.program.bare.hint")}
          className={bare ? "bg-live-bg text-fg" : ""}
          onClick={() => void run("live.textHidden", { hidden: !bare })}
        >
          {t("core.program.bare")}
        </Button>
        {fill && (
          <button
            type="button"
            aria-label={t("core.program.swap")}
            aria-pressed={swapped}
            title={t("core.program.swap")}
            onClick={toggleSwap}
            className="ml-auto grid h-7 w-8 place-items-center rounded-md border border-line-2 text-muted hover:border-faint hover:text-fg"
          >
            <svg
              viewBox="0 0 20 20"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M16.5 8A6.5 6.5 0 0 0 4.6 5.6" />
              <path d="M4.6 2.6v3h3" />
              <path d="M3.5 12a6.5 6.5 0 0 0 11.9 2.4" />
              <path d="M15.4 17.4v-3h-3" />
            </svg>
          </button>
        )}
      </div>
    </Panel>
  );
}

/** Anteprima: la prossima slide, la piu' grande possibile; Invio la manda in onda. */
export function PreviewPanel() {
  const t = useT();
  const mode = useContext(CurrentModeContext);
  const { state } = useEngine();
  const run = useRun();
  const slide = useMemo(() => (state === undefined ? undefined : previewSlide(state)), [state]);
  const style = useMemo(
    () => (state === undefined ? undefined : roomStyleFor(state, slide?.item)),
    [state, slide],
  );
  const fit = state === undefined ? 1 : itemFit(state, style, slide?.item);
  const caption = useCaption(slide);

  const content =
    slide === undefined ? (
      <ScreenEmpty text={t("core.preview.empty")} />
    ) : (
      <SlideText
        text={slideText(slide.slide)}
        style={style}
        fit={fit}
        credits={slide.credits}
        background={backgroundUrl(style, slide.item, slide.slide)}
      />
    );
  const take = (
    <Button tone="cue" disabled={slide === undefined} onClick={() => void run("cue.take", {})}>
      {t("core.preview.take")}
    </Button>
  );

  if (mode === "core.present") {
    return (
      <Panel label={t("core.panel.preview")} labelHidden tight>
        <Screen tone="cue" fill label={t("core.panel.preview")} caption={caption}>
          {content}
        </Screen>
        <div className="flex flex-wrap gap-1.5">{take}</div>
      </Panel>
    );
  }
  return (
    <Panel label={t("core.panel.preview")} labelHidden tight>
      <div className="flex flex-wrap items-end gap-3">
        {/* In Regia anteprima e programma sono grandi uguali, come in un mixer video. */}
        <div className={mode === "core.director" ? "w-full" : "w-[55%] min-w-40"}>
          <Screen tone="cue" label={t("core.panel.preview")}>
            {content}
          </Screen>
        </div>
        {take}
      </div>
      <Caption slide={slide} />
    </Panel>
  );
}
