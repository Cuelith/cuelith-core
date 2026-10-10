import {
  FONT_GROUPS,
  FONTS,
  fontInfo,
  weightsOffered,
  type FontGroup,
  type FullscreenStyle,
  type TextStyle,
} from "@cuelith-core/core-looks";
import { useEffect, useRef, useState } from "react";
import { useT } from "../engine/react.js";
import { useFontsVersion } from "../station/textStyles.js";
import { SlideText } from "../ui/SlideText.js";
import type { SavedStyle } from "../station/textStyles.js";

const FIELD =
  "rounded-md border border-line-2 bg-bg px-1.5 py-0.5 text-xs text-fg disabled:opacity-50";

/** Le lettere con cui ogni carattere si presenta (non e' un testo da tradurre). */
const GLYPH = "Aa";

const num = (value: string, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value.trim() !== "" ? parsed : fallback;
};

/** Scelta tra poche voci, tutte visibili (allineamento, posizione). */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { readonly value: T; readonly text: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex">
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => {
            onChange(option.value);
          }}
          className={`border px-2 py-0.5 text-xs ${
            index === 0 ? "rounded-l-md" : "-ml-px"
          } ${index === options.length - 1 ? "rounded-r-md" : ""} ${
            value === option.value
              ? "z-10 border-cue bg-cue-bg text-fg"
              : "border-line-2 text-muted hover:text-fg"
          }`}
        >
          {option.text}
        </button>
      ))}
    </div>
  );
}

/** I caratteri, per gruppo, ognuno scritto col suo stesso carattere: si sceglie guardando. */
function FontGrid({
  value,
  onChange,
}: {
  value: TextStyle["font"];
  onChange: (id: TextStyle["font"]) => void;
}) {
  const t = useT();
  const current = fontInfo(value);
  const [group, setGroup] = useState<FontGroup>(current.group);
  return (
    <div className="flex flex-col gap-2">
      <div
        role="tablist"
        aria-label={t("core.textstyles.fontGroups")}
        className="flex flex-wrap gap-1"
      >
        {FONT_GROUPS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={group === id}
            onClick={() => {
              setGroup(id);
            }}
            className={`rounded-md border px-2 py-0.5 text-xs ${
              group === id
                ? "border-cue bg-cue-bg text-fg"
                : "border-line-2 text-muted hover:text-fg"
            }`}
          >
            {t(`core.textstyles.fontGroup.${id}`)}
          </button>
        ))}
      </div>
      <p className="text-xs text-faint">{t(`core.textstyles.fontGroup.${group}.hint`)}</p>
      <div
        role="listbox"
        aria-label={t("core.textstyles.font")}
        className="grid grid-cols-2 gap-1.5"
      >
        {FONTS.filter((font) => font.group === group).map((font) => (
          <button
            key={font.id}
            type="button"
            role="option"
            aria-selected={value === font.id}
            title={font.name}
            onClick={() => {
              onChange(font.id);
            }}
            className={`flex items-baseline justify-between gap-2 rounded-md border px-2 py-1 text-left ${
              value === font.id
                ? "border-cue bg-cue-bg text-fg"
                : "border-line-2 text-muted hover:text-fg"
            }`}
          >
            <span
              className="truncate text-lg leading-tight"
              style={{ fontFamily: `"${font.family}"` }}
            >
              {GLYPH}
            </span>
            <span className="truncate text-xs">{font.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2 border-t border-line pt-3 first:border-0 first:pt-0">
      <legend className="sr-only">{title}</legend>
      <h3 className="text-xs font-medium text-fg">{title}</h3>
      {children}
    </fieldset>
  );
}

/**
 * Form di un solo stile: i cambiamenti si applicano subito (con un attimo di pausa mentre si scrive).
 * A destra, sempre in vista, l'anteprima con il testo della slide in anteprima (o un testo di prova).
 */
export function StyleEditor({
  style,
  armed,
  note,
  sample,
  fromSlide,
  baseStyle,
  onSave,
  onDelete,
  onClose,
}: {
  style: SavedStyle;
  armed: boolean;
  note: string | undefined;
  sample: string;
  /** Il testo viene dalla slide in anteprima (altrimenti e' il testo di prova). */
  fromSlide: boolean;
  baseStyle: FullscreenStyle;
  onSave: (patch: { name?: string; text?: TextStyle }) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const t = useT();
  useFontsVersion();
  const [name, setName] = useState(style.name);
  const [text, setText] = useState<TextStyle>(style.style);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    },
    [],
  );
  const later = (patch: { name?: string; text?: TextStyle }) => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      onSave(patch);
    }, 250);
  };
  const apply = (next: TextStyle) => {
    setText(next);
    later({ text: next });
  };
  const change = (patch: Partial<TextStyle>) => {
    apply({ ...text, ...patch });
  };
  /** Cambia un campo facoltativo: vuoto/falso lo toglie, cosi' lo stile resta com'era prima. */
  const toggle = (key: "outline" | "shadow" | "fit", on: boolean, value: TextStyle[typeof key]) => {
    const { [key]: _removed, ...rest } = text;
    apply(on ? { ...rest, [key]: value } : rest);
  };

  const font = fontInfo(text.font);
  const offered = weightsOffered(font);
  const weight =
    text.weight === "bold" && !offered.includes("bold") ? "normal" : (text.weight ?? "normal");

  return (
    <div className="flex max-h-[calc(100vh-9rem)] flex-col gap-3 overflow-y-auto px-5 py-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="order-2 flex flex-col gap-3 text-xs text-muted sm:order-1">
          <label className="flex flex-col gap-1">
            {t("core.textstyles.name")}
            <input
              value={name}
              maxLength={60}
              onChange={(event) => {
                setName(event.target.value);
                if (event.target.value.trim() !== "") later({ name: event.target.value.trim() });
              }}
              className={FIELD}
            />
          </label>

          <Section title={t("core.textstyles.section.font")}>
            <FontGrid
              value={text.font}
              onChange={(id) => {
                // Un carattere senza il corsivo (o con meno spessori) non lascia valori che non puo' avere.
                const next = fontInfo(id);
                const kept = weightsOffered(next);
                change({
                  font: id,
                  ...(text.weight !== undefined && !kept.includes(text.weight)
                    ? { weight: "normal" as const }
                    : {}),
                  ...(text.italic === true && !next.italic ? { italic: false } : {}),
                });
              }}
            />
          </Section>

          <Section title={t("core.textstyles.section.look")}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <label className="flex items-center gap-1.5">
                {t("core.textstyles.weight")}
                <select
                  value={weight}
                  onChange={(event) => {
                    change({ weight: event.target.value as TextStyle["weight"] & string });
                  }}
                  className={FIELD}
                >
                  {offered.map((id) => (
                    <option key={id} value={id}>
                      {t(`core.textstyles.weight.${id}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label
                className="flex items-center gap-1.5"
                title={font.italic ? undefined : t("core.textstyles.italicNo")}
              >
                <input
                  type="checkbox"
                  checked={text.italic === true && font.italic}
                  disabled={!font.italic}
                  onChange={(event) => {
                    change({ italic: event.target.checked });
                  }}
                />
                {t("core.textstyles.italic")}
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={text.uppercase === true}
                  onChange={(event) => {
                    change({ uppercase: event.target.checked });
                  }}
                />
                {t("core.textstyles.uppercase")}
              </label>
              <label className="flex items-center gap-1.5">
                {t("core.textstyles.color")}
                <input
                  type="color"
                  value={text.color}
                  onChange={(event) => {
                    change({ color: event.target.value.toUpperCase() });
                  }}
                  className="h-6 w-10 rounded-md border border-line-2 bg-bg"
                />
              </label>
            </div>
          </Section>

          <Section title={t("core.textstyles.section.layout")}>
            <div className="grid grid-cols-3 gap-x-3 gap-y-2">
              <label className="flex flex-col gap-1">
                {t("core.textstyles.size")}
                <input
                  type="number"
                  min={8}
                  max={400}
                  value={text.size}
                  onChange={(event) => {
                    change({
                      size: Math.min(400, Math.max(8, num(event.target.value, text.size))),
                    });
                  }}
                  className={FIELD}
                />
              </label>
              <label className="flex flex-col gap-1">
                {t("core.textstyles.lineHeight")}
                <input
                  type="number"
                  step={0.05}
                  min={0.8}
                  max={2.5}
                  value={text.lineHeight ?? 1.25}
                  onChange={(event) => {
                    change({
                      lineHeight: Math.min(
                        2.5,
                        Math.max(0.8, num(event.target.value, text.lineHeight ?? 1.25)),
                      ),
                    });
                  }}
                  className={FIELD}
                />
              </label>
              <label className="flex flex-col gap-1">
                {t("core.textstyles.letterSpacing")}
                <input
                  type="number"
                  step={1}
                  min={-10}
                  max={50}
                  value={Math.round((text.letterSpacing ?? 0) * 100)}
                  onChange={(event) => {
                    change({
                      letterSpacing: Math.min(50, Math.max(-10, num(event.target.value, 0))) / 100,
                    });
                  }}
                  className={FIELD}
                />
              </label>
              <label className="flex flex-col gap-1">
                {t("core.textstyles.margin")}
                <input
                  type="number"
                  step={1}
                  min={0}
                  max={40}
                  value={Math.round(text.margin * 100)}
                  onChange={(event) => {
                    change({
                      margin:
                        Math.min(40, Math.max(0, num(event.target.value, text.margin * 100))) / 100,
                    });
                  }}
                  className={FIELD}
                />
              </label>
              <div className="col-span-2 flex flex-wrap items-end gap-x-3 gap-y-2">
                <div className="flex flex-col gap-1">
                  {t("core.textstyles.align")}
                  <Segmented
                    label={t("core.textstyles.align")}
                    value={text.align}
                    options={(["left", "center", "right"] as const).map((value) => ({
                      value,
                      text: t(`core.textstyles.align.${value}`),
                    }))}
                    onChange={(align) => {
                      change({ align });
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  {t("core.textstyles.vAlign")}
                  <Segmented
                    label={t("core.textstyles.vAlign")}
                    value={text.vAlign ?? "middle"}
                    options={(["top", "middle", "bottom"] as const).map((value) => ({
                      value,
                      text: t(`core.textstyles.vAlign.${value}`),
                    }))}
                    onChange={(vAlign) => {
                      change({ vAlign });
                    }}
                  />
                </div>
              </div>
            </div>
          </Section>

          <Section title={t("core.textstyles.section.effects")}>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={text.outline !== undefined}
                onChange={(event) => {
                  toggle("outline", event.target.checked, { width: 3, color: "#000000" });
                }}
              />
              {t("core.textstyles.outline")}
              {text.outline !== undefined && (
                <span className="ml-auto flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={20}
                    aria-label={t("core.textstyles.outlineWidth")}
                    value={text.outline.width}
                    onChange={(event) => {
                      change({
                        outline: {
                          color: text.outline?.color ?? "#000000",
                          width: Math.min(20, Math.max(0, num(event.target.value, 3))),
                        },
                      });
                    }}
                    className={`${FIELD} w-14`}
                  />
                  <input
                    type="color"
                    aria-label={t("core.textstyles.outlineColor")}
                    value={text.outline.color}
                    onChange={(event) => {
                      change({
                        outline: {
                          width: text.outline?.width ?? 3,
                          color: event.target.value.toUpperCase(),
                        },
                      });
                    }}
                    className="h-6 w-10 rounded-md border border-line-2 bg-bg"
                  />
                </span>
              )}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={text.shadow !== undefined}
                onChange={(event) => {
                  toggle("shadow", event.target.checked, { offset: 4, blur: 6, color: "#000000" });
                }}
              />
              {t("core.textstyles.shadow")}
              {text.shadow !== undefined && (
                <span className="ml-auto flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={30}
                    aria-label={t("core.textstyles.shadowOffset")}
                    value={text.shadow.offset}
                    onChange={(event) => {
                      change({
                        shadow: {
                          blur: text.shadow?.blur ?? 6,
                          color: text.shadow?.color ?? "#000000",
                          offset: Math.min(30, Math.max(0, num(event.target.value, 4))),
                        },
                      });
                    }}
                    className={`${FIELD} w-14`}
                  />
                  <input
                    type="number"
                    min={0}
                    max={30}
                    aria-label={t("core.textstyles.shadowBlur")}
                    value={text.shadow.blur}
                    onChange={(event) => {
                      change({
                        shadow: {
                          offset: text.shadow?.offset ?? 4,
                          color: text.shadow?.color ?? "#000000",
                          blur: Math.min(30, Math.max(0, num(event.target.value, 6))),
                        },
                      });
                    }}
                    className={`${FIELD} w-14`}
                  />
                  <input
                    type="color"
                    aria-label={t("core.textstyles.shadowColor")}
                    value={text.shadow.color}
                    onChange={(event) => {
                      change({
                        shadow: {
                          offset: text.shadow?.offset ?? 4,
                          blur: text.shadow?.blur ?? 6,
                          color: event.target.value.toUpperCase(),
                        },
                      });
                    }}
                    className="h-6 w-10 rounded-md border border-line-2 bg-bg"
                  />
                </span>
              )}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={text.fit !== undefined}
                onChange={(event) => {
                  toggle("fit", event.target.checked, { min: 0.6 });
                }}
              />
              {t("core.textstyles.fit")}
              {text.fit !== undefined && (
                <span className="ml-auto flex items-center gap-1">
                  {t("core.textstyles.fitMin")}
                  <input
                    type="number"
                    min={30}
                    max={100}
                    value={Math.round(text.fit.min * 100)}
                    onChange={(event) => {
                      change({
                        fit: {
                          min: Math.min(100, Math.max(30, num(event.target.value, 60))) / 100,
                        },
                      });
                    }}
                    className={`${FIELD} w-14`}
                  />
                  %
                </span>
              )}
            </label>
          </Section>
        </div>

        <div className="order-1 flex flex-col gap-1.5 sm:sticky sm:top-0 sm:order-2 sm:self-start">
          <div
            role="img"
            aria-label={t("core.editor.style.preview")}
            data-testid="style-preview"
            className="relative aspect-video w-full overflow-hidden rounded-md border border-line bg-screen"
            style={{ containerType: "size" }}
          >
            <SlideText text={sample} style={{ ...baseStyle, text }} />
          </div>
          <p className="text-xs text-faint">
            {fromSlide
              ? t("core.textstyles.previewFromSlide")
              : t("core.textstyles.previewFromSample")}
          </p>
        </div>
      </div>
      {note !== undefined && (
        <p role="alert" className="text-xs text-live-soft">
          {note}
        </p>
      )}
      <div className="flex justify-between">
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md border border-line-2 px-3 py-1 text-xs text-live-soft hover:border-live"
        >
          {armed ? t("core.textstyles.deleteConfirm") : t("core.textstyles.delete")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-line-2 px-3 py-1 text-xs text-fg hover:border-muted"
        >
          {t("core.action.close")}
        </button>
      </div>
    </div>
  );
}
