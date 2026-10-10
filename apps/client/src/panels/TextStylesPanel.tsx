import { effectiveTextStyle, type TextStyle } from "@cuelith-core/core-looks";
import { useEffect, useState } from "react";
import { useEngine, useT } from "../engine/react.js";
import { roomLook } from "../station/backgrounds.js";
import { itemOfEntry, previewSlide, slideText } from "../station/show.js";
import { useRun, useStation } from "../station/station.js";
import {
  judgeStyle,
  loadFonts,
  useFontsVersion,
  useTextStyles,
  type SavedStyle,
} from "../station/textStyles.js";
import { ModalDialog } from "../ui/Dialogs.js";
import { HScroll } from "../ui/HScroll.js";
import { Panel } from "../ui/Panel.js";
import { StyleEditor } from "./StyleEditor.js";

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
  useFontsVersion();
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
  // L'esempio nell'editor: il testo della slide in anteprima; se non ce n'e' una, un testo di prova nella lingua in uso.
  const shownText = previewSlide(state)?.slide;
  const shownValue = shownText === undefined ? "" : slideText(shownText);
  const fromSlide = shownValue.trim() !== "";
  const sample = fromSlide ? shownValue : t("core.textstyles.sample");

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
          huge
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
              sample={sample}
              fromSlide={fromSlide}
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
