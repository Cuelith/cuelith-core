import { cursorItem, slideSequence, type StateDocument } from "@cuelith/protocol";
import { useMemo } from "react";
import { useEngine, useT } from "../engine/react.js";
import { liveSections } from "../station/sections.js";
import { useRun } from "../station/station.js";
import { Button } from "../ui/Button.js";
import { EmptyState, Panel } from "../ui/Panel.js";

/**
 * Sezioni dell'elemento in onda come grossi pulsanti (disposizione Band): un
 * tocco manda in onda l'inizio della sezione. Rosso = in onda, ciano = la
 * prossima. Pensato anche per il tocco (tablet): pulsanti alti almeno 64 px.
 */
export function SectionsPanel() {
  const t = useT();
  const { state } = useEngine();
  const run = useRun();
  const sections = useMemo(() => (state === undefined ? undefined : liveSections(state)), [state]);
  if (sections === undefined) {
    return (
      <Panel label={t("core.panel.sections")}>
        <EmptyState title={t("core.sections.empty")} />
      </Panel>
    );
  }
  const { item, occurrences } = sections;
  return (
    <Panel label={t("core.panel.sections")}>
      <h3 className="truncate font-display text-xl font-semibold">
        {item.title === "" ? t("core.editor.untitled") : item.title}
      </h3>
      <ol
        aria-label={t("core.panel.sections")}
        className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] content-start gap-2.5"
      >
        {occurrences.map((section) => (
          <li key={section.start}>
            <button
              type="button"
              data-state={section.state}
              aria-label={t("core.sections.goto", { section: section.label })}
              onClick={() => void run("cue.goto", section.position)}
              className={`flex min-h-24 w-full flex-col items-start gap-1.5 rounded-xl border-2 p-3 text-left ${
                section.state === "live"
                  ? "border-live bg-live-bg"
                  : section.state === "next"
                    ? "border-cue bg-cue-bg"
                    : "border-line-2 bg-bg-2 hover:border-faint"
              }`}
            >
              <span
                className={`font-mono text-lg font-bold ${
                  section.state === "live"
                    ? "text-live"
                    : section.state === "next"
                      ? "text-cue"
                      : "text-mod"
                }`}
              >
                {section.label}
              </span>
              <span className="line-clamp-2 text-sm text-muted">{section.firstLine}</span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => void run("layer.clear", { layer: "content" })}
            className="flex min-h-24 w-full flex-col items-start gap-1.5 rounded-xl border-2 border-dashed border-line-2 p-3 text-left hover:border-faint"
          >
            <span className="font-mono text-lg font-bold text-muted">
              {t("core.sections.clear")}
            </span>
            <span className="text-sm text-faint">{t("core.sections.clearHint")}</span>
          </button>
        </li>
      </ol>
    </Panel>
  );
}

/** Striscia dell'ordine di proiezione (disposizione Band): dove sei e cosa viene dopo. */
export function OrderPanel() {
  const t = useT();
  const { state } = useEngine();
  const run = useRun();
  const sections = useMemo(() => (state === undefined ? undefined : liveSections(state)), [state]);
  return (
    <Panel label={t("core.panel.order")} labelHidden>
      <ol aria-label={t("core.panel.order")} className="flex flex-wrap items-center gap-1.5">
        {(sections?.occurrences ?? []).map((section) => (
          <li key={section.start}>
            <button
              type="button"
              data-state={section.state}
              onClick={() => void run("cue.goto", section.position)}
              className={`min-h-11 min-w-12 rounded-lg px-3 font-mono text-sm font-bold ${
                section.state === "live"
                  ? "bg-live text-live-ink"
                  : section.state === "next"
                    ? "bg-cue text-cue-ink"
                    : "bg-bg-3 text-fg hover:bg-line"
              }`}
            >
              {section.label}
            </button>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function notesAt(doc: StateDocument, which: "program" | "preview"): string | undefined {
  const cursor = which === "program" ? doc.live.cursor : doc.live.preview;
  const item = cursorItem(doc, cursor);
  if (item === undefined) return undefined;
  const value = slideSequence(item)[cursor.slideIndex]?.fields["notes"]?.value;
  return value === undefined || value.trim() === "" ? undefined : value;
}

/** Note della slide in onda e della successiva (disposizione Conferenza). */
export function NotesPanel() {
  const t = useT();
  const { state } = useEngine();
  const now = state === undefined ? undefined : notesAt(state, "program");
  const next = state === undefined ? undefined : notesAt(state, "preview");
  return (
    <Panel label={t("core.panel.notes")}>
      {now === undefined && next === undefined ? (
        <EmptyState title={t("core.notes.empty")} />
      ) : (
        <div className="flex flex-col gap-3">
          {now !== undefined && (
            <p className="whitespace-pre-line text-[15px] leading-relaxed">{now}</p>
          )}
          {next !== undefined && (
            <p className="whitespace-pre-line border-t border-line pt-3 text-sm text-muted">
              <span className="mr-2 font-mono text-[11px] font-semibold text-cue">
                {t("core.notes.next")}
              </span>
              {next}
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

/**
 * Comandi tra anteprima e programma (disposizione Regia), come in un mixer
 * video: TAKE grande al centro, avanti, indietro, pulisci e nero su tutte le uscite.
 */
export function TransitionsPanel() {
  const t = useT();
  const { state } = useEngine();
  const run = useRun();
  const outputs = Object.keys(state?.live.outputs ?? {});
  const allBlack =
    outputs.length > 0 && outputs.every((id) => state?.live.outputs[id]?.blackout === true);
  return (
    <Panel label={t("core.panel.transitions")} labelHidden>
      <div className="flex h-full flex-col justify-center gap-2" role="group">
        <button
          type="button"
          onClick={() => void run("cue.take", {})}
          className="min-h-16 rounded-xl bg-live font-bold tracking-wider text-live-ink hover:brightness-110"
        >
          {t("core.transitions.take")}
        </button>
        <Button onClick={() => void run("cue.next", {})}>{t("core.program.next")} →</Button>
        <Button onClick={() => void run("cue.prev", {})}>← {t("core.program.prev")}</Button>
        <Button onClick={() => void run("layer.clear", { layer: "content" })}>
          {t("core.program.clear")}
        </Button>
        <Button
          tone={allBlack ? "live" : "default"}
          aria-pressed={allBlack}
          title={t("core.transitions.black")}
          disabled={outputs.length === 0}
          onClick={() => {
            for (const outputId of outputs)
              void run("output.blackout", { outputId, on: !allBlack });
          }}
        >
          {t("core.outputs.blackout")}
        </Button>
      </div>
    </Panel>
  );
}
