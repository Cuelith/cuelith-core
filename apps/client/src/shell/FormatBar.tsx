import { fontInfo, type FullscreenStyle } from "@cuelith-core/core-looks";
import {
  OUTLINE_PRESETS,
  SHADOW_PRESETS,
  outlinePresetOf,
  shadowPresetOf,
  styleRange,
  type OutlinePreset,
  type ShadowPreset,
  type Span,
} from "@cuelith/protocol";
import { useState, type RefObject } from "react";
import { useT } from "../engine/react.js";

const BUTTON =
  "rounded-md border px-2 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-40";
const OFF = "border-line-2 text-muted hover:text-fg";

/** Dimensioni offerte per un tratto di testo: multipli di quella dello stile. */
const SIZES = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3] as const;

/**
 * Barra della formattazione: cambia dimensione, grassetto, corsivo e colore del tratto
 * selezionato nella casella di testo. La casella resta testo semplice; le parole formattate
 * stanno accanto (protocollo 1.21) e si portano con il testo mentre lo si scrive.
 */
export function FormatBar({
  area,
  text,
  spans,
  selection,
  font,
  onChange,
}: {
  area: RefObject<HTMLTextAreaElement | null>;
  text: string;
  spans: readonly Span[];
  selection: { readonly start: number; readonly end: number };
  /** Il carattere in uso: il corsivo c'e' solo se ne ha uno vero. */
  font: FullscreenStyle["text"]["font"];
  onChange: (spans: Span[]) => void;
}) {
  const t = useT();
  // Colori scelti per il bordo e l'ombra (si applicano quando si sceglie lo spessore).
  const [edge, setEdge] = useState("#000000");
  const has = selection.end > selection.start;
  const italic = fontInfo(font).italic;
  const apply = (change: Parameters<typeof styleRange>[4]): void => {
    const box = area.current;
    const start = box?.selectionStart ?? selection.start;
    const end = box?.selectionEnd ?? selection.end;
    if (end <= start) return;
    onChange(styleRange(text, spans, start, end, change));
  };
  // Cosa ha il tratto selezionato adesso: lo si vede dai pulsanti accesi.
  const covered = (key: "bold" | "italic"): boolean =>
    has &&
    Array.from(
      { length: selection.end - selection.start },
      (_, offset) => selection.start + offset,
    ).every((index) =>
      spans.some((span) => span[key] === true && span.start <= index && index < span.end),
    );
  const sizeHere = (() => {
    if (!has) return 1;
    const found = spans.find((span) => span.start <= selection.start && selection.start < span.end);
    return found?.size ?? 1;
  })();
  const spanHere = spans.find(
    (span) => span.start <= selection.start && selection.start < span.end,
  );
  const outlineHere: OutlinePreset | "none" = outlinePresetOf(spanHere?.outline) ?? "none";
  const shadowHere: ShadowPreset | "none" = shadowPresetOf(spanHere?.shadow) ?? "none";
  const keep = (event: { preventDefault: () => void }): void => {
    // I pulsanti non tolgono la selezione alla casella di testo.
    event.preventDefault();
  };

  return (
    <div
      role="toolbar"
      aria-label={t("core.editor.format.label")}
      className="flex flex-wrap items-center gap-2"
    >
      <label className="flex items-center gap-1.5 text-xs text-muted">
        {t("core.editor.format.size")}
        <select
          value={String(sizeHere)}
          disabled={!has}
          onChange={(event) => {
            apply({ size: Number(event.target.value) });
          }}
          className="rounded-md border border-line-2 bg-bg px-1.5 py-0.5 text-xs text-fg disabled:opacity-40"
        >
          {SIZES.map((size) => (
            <option key={size} value={String(size)}>
              {size === 1
                ? t("core.editor.format.sizeNormal")
                : `${String(Math.round(size * 100))}%`}
            </option>
          ))}
          {!(SIZES as readonly number[]).includes(sizeHere) && (
            <option value={String(sizeHere)}>{`${String(Math.round(sizeHere * 100))}%`}</option>
          )}
        </select>
      </label>
      <button
        type="button"
        aria-pressed={covered("bold")}
        aria-label={t("core.editor.format.bold")}
        disabled={!has}
        title={`${t("core.editor.format.bold")} (Ctrl+B)`}
        onMouseDown={keep}
        onClick={() => {
          apply({ bold: "toggle" });
        }}
        className={`${BUTTON} font-bold ${covered("bold") ? "border-cue bg-cue-bg text-fg" : OFF}`}
      >
        {t("core.editor.format.boldShort")}
      </button>
      <button
        type="button"
        aria-pressed={covered("italic")}
        aria-label={t("core.editor.format.italic")}
        disabled={!has || !italic}
        title={
          italic ? `${t("core.editor.format.italic")} (Ctrl+I)` : t("core.textstyles.italicNo")
        }
        onMouseDown={keep}
        onClick={() => {
          apply({ italic: "toggle" });
        }}
        className={`${BUTTON} italic ${covered("italic") ? "border-cue bg-cue-bg text-fg" : OFF}`}
      >
        {t("core.editor.format.italicShort")}
      </button>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        {t("core.editor.format.color")}
        <input
          type="color"
          disabled={!has}
          defaultValue="#FFD166"
          onChange={(event) => {
            apply({ color: event.target.value });
          }}
          className="h-6 w-9 rounded-md border border-line-2 bg-bg disabled:opacity-40"
        />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        {t("core.editor.format.outline")}
        <select
          value={outlineHere}
          disabled={!has}
          onChange={(event) => {
            const preset = event.target.value as OutlinePreset | "none";
            apply({
              outline: preset === "none" ? null : { width: OUTLINE_PRESETS[preset], color: edge },
            });
          }}
          className="rounded-md border border-line-2 bg-bg px-1.5 py-0.5 text-xs text-fg disabled:opacity-40"
        >
          <option value="none">{t("core.editor.format.none")}</option>
          {(Object.keys(OUTLINE_PRESETS) as OutlinePreset[]).map((preset) => (
            <option key={preset} value={preset}>
              {t(`core.editor.format.outline.${preset}`)}
            </option>
          ))}
        </select>
        <input
          type="color"
          aria-label={t("core.editor.format.outlineColor")}
          value={edge}
          disabled={!has}
          onChange={(event) => {
            setEdge(event.target.value.toUpperCase());
            if (outlineHere !== "none") {
              apply({
                outline: { width: OUTLINE_PRESETS[outlineHere], color: event.target.value },
              });
            }
          }}
          className="h-6 w-9 rounded-md border border-line-2 bg-bg disabled:opacity-40"
        />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        {t("core.editor.format.shadow")}
        <select
          value={shadowHere}
          disabled={!has}
          onChange={(event) => {
            const preset = event.target.value as ShadowPreset | "none";
            apply({
              shadow: preset === "none" ? null : { ...SHADOW_PRESETS[preset], color: "#000000" },
            });
          }}
          className="rounded-md border border-line-2 bg-bg px-1.5 py-0.5 text-xs text-fg disabled:opacity-40"
        >
          <option value="none">{t("core.editor.format.shadow.none")}</option>
          {(Object.keys(SHADOW_PRESETS) as ShadowPreset[]).map((preset) => (
            <option key={preset} value={preset}>
              {t(`core.editor.format.shadow.${preset}`)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={!has}
        onMouseDown={keep}
        onClick={() => {
          apply({
            size: null,
            bold: false,
            italic: false,
            color: null,
            outline: null,
            shadow: null,
          });
        }}
        className={`${BUTTON} ${OFF}`}
      >
        {t("core.editor.format.clear")}
      </button>
      {!has && <span className="text-xs text-faint">{t("core.editor.format.hint")}</span>}
    </div>
  );
}
