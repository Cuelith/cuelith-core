import type { FullscreenStyle } from "@cuelith-core/core-looks";
import { useMemo } from "react";
import { useEngine, useT } from "../engine/react.js";
import {
  previewSlide,
  programSlide,
  roomStyle,
  slideText,
  type ShownSlide,
} from "../station/show.js";
import { useRun } from "../station/station.js";
import { Button } from "../ui/Button.js";
import { Crossfade } from "../ui/Crossfade.js";
import { Panel } from "../ui/Panel.js";
import { Screen, ScreenEmpty } from "../ui/Screen.js";
import { SlideText } from "../ui/SlideText.js";

const keyOf = (slide: ShownSlide | undefined): string => slide?.key ?? "empty";

function transitionMs(style: FullscreenStyle | undefined): number {
  return style?.transition.type === "fade" ? style.transition.durationMs : 0;
}

function Caption({ slide }: { slide: ShownSlide | undefined }) {
  const t = useT();
  return (
    <p className="min-h-5 truncate text-xs text-muted">
      {slide !== undefined &&
        t("core.program.position", {
          title: slide.item.title === "" ? t("core.editor.untitled") : slide.item.title,
          n: slide.index + 1,
          count: slide.count,
        })}
    </p>
  );
}

/** Programma: cio' che e' in onda, con la dissolvenza del look Sala. */
export function ProgramPanel() {
  const t = useT();
  const { state } = useEngine();
  const run = useRun();
  const slide = useMemo(() => (state === undefined ? undefined : programSlide(state)), [state]);
  const style = useMemo(() => (state === undefined ? undefined : roomStyle(state)), [state]);
  const program = state?.live.cursor.entryId;

  return (
    <Panel label={t("core.panel.program")} labelHidden>
      <Screen tone="live" label={t("core.panel.program")}>
        <Crossfade
          value={slide}
          keyOf={keyOf}
          durationMs={transitionMs(style)}
          render={(shown) =>
            shown === undefined ? (
              <ScreenEmpty text={t("core.program.empty")} />
            ) : (
              <SlideText text={slideText(shown.slide)} style={style} />
            )
          }
        />
      </Screen>
      <Caption slide={slide} />
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
      </div>
    </Panel>
  );
}

/** Anteprima: la prossima slide, piu' piccola; Invio la manda in onda. */
export function PreviewPanel() {
  const t = useT();
  const { state } = useEngine();
  const run = useRun();
  const slide = useMemo(() => (state === undefined ? undefined : previewSlide(state)), [state]);
  const style = useMemo(() => (state === undefined ? undefined : roomStyle(state)), [state]);

  return (
    <Panel label={t("core.panel.preview")} labelHidden>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-[55%] min-w-40">
          <Screen tone="cue" label={t("core.panel.preview")}>
            {slide === undefined ? (
              <ScreenEmpty text={t("core.preview.empty")} />
            ) : (
              <SlideText text={slideText(slide.slide)} style={style} />
            )}
          </Screen>
        </div>
        <Button tone="cue" disabled={slide === undefined} onClick={() => void run("cue.take", {})}>
          {t("core.preview.take")}
        </Button>
      </div>
      <Caption slide={slide} />
      <p className="text-xs text-faint">{t("core.program.keys")}</p>
    </Panel>
  );
}
