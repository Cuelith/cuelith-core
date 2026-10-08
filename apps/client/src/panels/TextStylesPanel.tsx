import { effectiveTextStyle, type FullscreenStyle, type TextStyle } from "@cuelith-core/core-looks";
import { slideSequence } from "@cuelith/protocol";
import { useEffect, useRef, useState } from "react";
import { useEngine, useT } from "../engine/react.js";
import { roomLook } from "../station/backgrounds.js";
import { itemOfEntry } from "../station/show.js";
import { useRun, useStation } from "../station/station.js";
import { judgeStyle, loadFonts, useTextStyles, type SavedStyle } from "../station/textStyles.js";
import { ModalDialog } from "../ui/Dialogs.js";
import { HScroll } from "../ui/HScroll.js";
import { Panel } from "../ui/Panel.js";
import { SlideText } from "../ui/SlideText.js";

const FIELD =
  "rounded-md border border-line-2 bg-bg px-1.5 py-0.5 text-xs text-fg disabled:opacity-50";

/**
 * Stili globali del testo (decisione 0015), sotto gli sfondi. Sono tuoi: li crei da quello che
 * c'e' adesso e li scegli con un clic, in anteprima e in diretta. Lo stile scelto sostituisce le
 * modifiche fatte nell'editor di un testo (tolto, tornano). Uno stile in cui il testo non
 * entrerebbe nelle uscite non si puo' scegliere, per ogni elemento in onda, in anteprima o
 * selezionato.
 */
export function TextStylesPanel() {
  const t = useT();
  const run = useRun();
  const { state } = useEngine();
  const { selectedEntryId } = useStation();
  const styles = useTextStyles();
  const [editing, setEditing] = useState<string | undefined>();
  const [note, setNote] = useState<string | undefined>();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    void loadFonts();
  }, []);

  if (state === undefined) return null;
  const room = roomLook(state);
  if (room === undefined) return null;
  const selected = itemOfEntry(state, selectedEntryId);
  const activeId = room.style.globalText?.id;
  const edited = styles.find((style) => style.id === editing);

  const setActive = (style: SavedStyle | undefined) => {
    const { globalText: _removed, ...rest } = room.style;
    void run("look.update", {
      id: room.look.id,
      style:
        style === undefined
          ? rest
          : { ...rest, globalText: { id: style.id, name: style.name, text: style.style } },
    });
  };

  const toggle = (style: SavedStyle) => {
    setNote(undefined);
    if (activeId === style.id) {
      setActive(undefined);
      return;
    }
    const verdict = judgeStyle(state, style.style, selected);
    if (!verdict.allowed) return;
    setActive(style);
  };

  const create = async () => {
    // Si parte dallo stile in uso adesso (quello dell'elemento selezionato, se ne ha uno).
    const base: TextStyle = effectiveTextStyle(
      room.style.text,
      room.style.globalText?.text,
      selected?.textStyle,
    );
    const name = t("core.textstyles.newName", { n: String(styles.length + 1) });
    const created = await run("textstyle.create", { name, style: { ...base, fit: { min: 0.6 } } });
    if (created !== undefined) setEditing(created.id);
  };

  /** Salva una modifica; se lo stile e' quello in uso, deve ancora entrare: altrimenti non si applica. */
  const save = (style: SavedStyle, patch: { name?: string; text?: TextStyle }) => {
    const next = patch.text ?? style.style;
    if (activeId === style.id && patch.text !== undefined) {
      const verdict = judgeStyle(state, next, selected);
      if (!verdict.allowed && verdict.blocked !== undefined) {
        setNote(
          t("core.textstyles.blocked", {
            item: verdict.blocked.item,
            slide: String(verdict.blocked.slide),
            output: verdict.blocked.output,
          }),
        );
        return;
      }
    }
    setNote(undefined);
    void run("textstyle.update", {
      id: style.id,
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.text === undefined ? {} : { style: patch.text }),
    });
    if (activeId === style.id) {
      void run("look.update", {
        id: room.look.id,
        style: {
          ...room.style,
          globalText: { id: style.id, name: patch.name ?? style.name, text: next },
        },
      });
    }
  };

  const remove = (style: SavedStyle) => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    if (activeId === style.id) setActive(undefined);
    setEditing(undefined);
    void run("textstyle.delete", { id: style.id });
  };

  const chip = "flex-none rounded-md border px-2 py-0.5 text-xs";
  const verdicts = new Map(
    styles.map((style) => [style.id, judgeStyle(state, style.style, selected)]),
  );

  return (
    <Panel label={t("core.panel.textstyles")} tight>
      <HScroll role="group" label={t("core.textstyles.list")}>
        <button
          type="button"
          aria-pressed={activeId === undefined}
          onClick={() => {
            setActive(undefined);
          }}
          className={`${chip} ${
            activeId === undefined
              ? "border-cue bg-cue-bg text-fg"
              : "border-line-2 text-muted hover:text-fg"
          }`}
        >
          {t("core.textstyles.none")}
        </button>
        {styles.map((style) => {
          const verdict = verdicts.get(style.id);
          const active = activeId === style.id;
          const blocked = !active && verdict?.allowed === false;
          const reason =
            blocked && verdict.blocked !== undefined
              ? t("core.textstyles.blocked", {
                  item: verdict.blocked.item,
                  slide: String(verdict.blocked.slide),
                  output: verdict.blocked.output,
                })
              : undefined;
          return (
            <span key={style.id} className="inline-flex flex-none">
              <button
                type="button"
                aria-pressed={active}
                disabled={blocked}
                title={reason ?? style.name}
                onClick={() => {
                  toggle(style);
                }}
                className={`${chip} rounded-r-none disabled:opacity-40 ${
                  active ? "border-cue bg-cue-bg text-fg" : "border-line-2 text-muted hover:text-fg"
                }`}
              >
                {style.name}
                {(verdict?.warnings.length ?? 0) > 0 && !blocked && (
                  <span aria-hidden="true" className="ml-1 text-live-soft">
                    ⚠
                  </span>
                )}
              </button>
              <button
                type="button"
                aria-label={t("core.textstyles.edit", { name: style.name })}
                aria-pressed={editing === style.id}
                onClick={() => {
                  setArmed(false);
                  setNote(undefined);
                  setEditing(editing === style.id ? undefined : style.id);
                }}
                className={`${chip} rounded-l-none border-l-0 ${
                  editing === style.id
                    ? "border-cue text-fg"
                    : "border-line-2 text-faint hover:text-fg"
                }`}
              >
                ✎
              </button>
            </span>
          );
        })}
        <button
          type="button"
          aria-label={t("core.textstyles.add")}
          title={t("core.textstyles.add")}
          onClick={() => void create()}
          className={`${chip} border-dashed border-faint text-muted hover:border-muted hover:text-fg`}
        >
          +
        </button>
      </HScroll>

      {styles.length === 0 && <p className="text-xs text-faint">{t("core.textstyles.empty")}</p>}
      {note !== undefined && edited === undefined && (
        <p role="alert" className="text-xs text-live-soft">
          {note}
        </p>
      )}
      {activeId !== undefined && (verdicts.get(activeId)?.warnings.length ?? 0) > 0 && (
        <p role="status" className="text-xs text-live-soft">
          ⚠{" "}
          {t("core.textstyles.warn", { items: verdicts.get(activeId)?.warnings.join(", ") ?? "" })}
        </p>
      )}
      {room.style.globalText !== undefined && (
        <p className="text-xs text-faint">
          {t("core.textstyles.activeNote", { name: room.style.globalText.name })}
        </p>
      )}

      {edited !== undefined && (
        <ModalDialog
          title={t("core.textstyles.editing", { name: edited.name })}
          onClose={() => {
            setEditing(undefined);
            setArmed(false);
            setNote(undefined);
          }}
        >
          {(close) => (
            <StyleEditor
              key={edited.id}
              style={edited}
              armed={armed}
              note={note}
              sample={
                selected === undefined
                  ? ""
                  : (slideSequence(selected)[0]?.fields["text"]?.value ?? "")
              }
              baseStyle={room.style}
              onSave={(patch) => {
                save(edited, patch);
              }}
              onDelete={() => {
                remove(edited);
                if (armed) close();
              }}
              onClose={close}
            />
          )}
        </ModalDialog>
      )}
    </Panel>
  );
}

/** Form di un solo stile: i cambiamenti si applicano subito (con un attimo di pausa mentre si scrive). */
function StyleEditor({
  style,
  armed,
  note,
  sample,
  baseStyle,
  onSave,
  onDelete,
  onClose,
}: {
  style: SavedStyle;
  armed: boolean;
  note: string | undefined;
  sample: string;
  baseStyle: FullscreenStyle;
  onSave: (patch: { name?: string; text?: TextStyle }) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const t = useT();
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
  const change = (patch: Partial<TextStyle>) => {
    const next = { ...text, ...patch };
    setText(next);
    later({ text: next });
  };
  const num = (value: string, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && value.trim() !== "" ? parsed : fallback;
  };

  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-muted">
        <label className="col-span-2 flex flex-col gap-1">
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
        <label className="flex flex-col gap-1">
          {t("core.textstyles.font")}
          <select
            value={text.font}
            onChange={(event) => {
              change({ font: event.target.value as TextStyle["font"] });
            }}
            className={FIELD}
          >
            {(["display", "body", "mono"] as const).map((font) => (
              <option key={font} value={font}>
                {t(`core.textstyles.font.${font}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {t("core.textstyles.size")}
          <input
            type="number"
            min={8}
            max={400}
            value={text.size}
            onChange={(event) => {
              change({ size: Math.min(400, Math.max(8, num(event.target.value, text.size))) });
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
          {t("core.textstyles.align")}
          <select
            value={text.align}
            onChange={(event) => {
              change({ align: event.target.value as TextStyle["align"] });
            }}
            className={FIELD}
          >
            {(["left", "center", "right"] as const).map((align) => (
              <option key={align} value={align}>
                {t(`core.textstyles.align.${align}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {t("core.textstyles.color")}
          <input
            type="color"
            value={text.color}
            onChange={(event) => {
              change({ color: event.target.value.toUpperCase() });
            }}
            className="h-6 w-full rounded-md border border-line-2 bg-bg"
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
                margin: Math.min(40, Math.max(0, num(event.target.value, text.margin * 100))) / 100,
              });
            }}
            className={FIELD}
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={text.weight === "bold"}
            onChange={(event) => {
              change({ weight: event.target.checked ? "bold" : "normal" });
            }}
          />
          {t("core.textstyles.bold")}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={text.uppercase === true}
            onChange={(event) => {
              change({ uppercase: event.target.checked });
            }}
          />
          {t("core.textstyles.uppercase")}
        </label>
        <label className="col-span-2 flex items-center gap-2">
          <input
            type="checkbox"
            checked={text.outline !== undefined}
            onChange={(event) => {
              const { outline: _removed, ...rest } = text;
              const next: TextStyle = event.target.checked
                ? { ...rest, outline: { width: 3, color: "#000000" } }
                : rest;
              setText(next);
              later({ text: next });
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
        <label className="col-span-2 flex items-center gap-2">
          <input
            type="checkbox"
            checked={text.shadow !== undefined}
            onChange={(event) => {
              const { shadow: _removed, ...rest } = text;
              const next: TextStyle = event.target.checked
                ? { ...rest, shadow: { offset: 4, blur: 6, color: "#000000" } }
                : rest;
              setText(next);
              later({ text: next });
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
        <label className="col-span-2 flex items-center gap-2">
          <input
            type="checkbox"
            checked={text.fit !== undefined}
            onChange={(event) => {
              const { fit: _removed, ...rest } = text;
              const next: TextStyle = event.target.checked ? { ...rest, fit: { min: 0.6 } } : rest;
              setText(next);
              later({ text: next });
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
                    fit: { min: Math.min(100, Math.max(30, num(event.target.value, 60))) / 100 },
                  });
                }}
                className={`${FIELD} w-14`}
              />
              %
            </span>
          )}
        </label>
      </div>
      {note !== undefined && (
        <p role="alert" className="text-xs text-live-soft">
          {note}
        </p>
      )}
      <div
        role="img"
        aria-label={t("core.editor.style.preview")}
        className="relative aspect-video w-full max-w-sm overflow-hidden rounded-md border border-line bg-screen"
        style={{ containerType: "size" }}
      >
        <SlideText text={sample === "" ? "Aa" : sample} style={{ ...baseStyle, text }} />
      </div>
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
