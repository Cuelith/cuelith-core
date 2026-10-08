import type { InstalledPlugin } from "@cuelith/protocol";
import { useEffect, useRef, useState } from "react";
import { useConnection, useT } from "../../engine/react.js";
import { Button } from "../../ui/Button.js";
import { ModalDialog } from "../../ui/Dialogs.js";

type Value = string | number | boolean;
type Def = NonNullable<InstalledPlugin["manifest"]["contributes"]["settings"]>[number];

const FIELD = "rounded-md border border-line-2 bg-bg px-2 py-1 text-sm text-fg";

/** Quanto aspettare dopo l'ultimo tasto prima di salvare un testo o un numero. */
const SAVE_DELAY_MS = 350;

/**
 * Impostazioni di un plugin, disegnate dal nucleo da quello che il manifest dichiara (decisione
 * 0017): stesso aspetto e stesse regole per tutti, nella lingua dell'interfaccia. Ogni modifica si
 * salva da sola; «Ripristina» torna al valore predefinito. Il plugin in funzione riceve l'evento
 * `core.plugin.settingsChanged` e decide cosa farne.
 */
export function PluginSettingsDialog({
  plugin,
  onClose,
}: {
  plugin: InstalledPlugin;
  onClose: () => void;
}) {
  const t = useT();
  const { manifest } = plugin;
  const defs = manifest.contributes.settings ?? [];
  return (
    <ModalDialog
      title={t("core.pluginSettings.title", { name: manifest.name })}
      onClose={onClose}
      wide
    >
      {(close) => (
        <div className="flex max-h-[75vh] flex-col gap-4 px-5 py-4">
          {defs.length === 0 ? (
            <p className="text-sm text-muted">{t("core.pluginSettings.none")}</p>
          ) : (
            <SettingsForm pluginId={manifest.id} defs={defs} />
          )}
          <div className="flex justify-end">
            <Button onClick={close}>{t("core.action.close")}</Button>
          </div>
        </div>
      )}
    </ModalDialog>
  );
}

function SettingsForm({ pluginId, defs }: { pluginId: string; defs: readonly Def[] }) {
  const t = useT();
  const connection = useConnection();
  const [values, setValues] = useState<Record<string, Value> | undefined>();
  // Cio' che si sta scrivendo, finche' non si salva (un numero a meta' non e' un valore).
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<"saved" | "error" | undefined>();
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    let alive = true;
    connection.call("pluginsettings.get", { pluginId }).then(
      (result) => {
        if (alive) setValues(result.values);
      },
      () => {
        if (alive) setSaved("error");
      },
    );
    const pending = timers.current;
    return () => {
      alive = false;
      for (const timer of pending.values()) clearTimeout(timer);
    };
  }, [connection, pluginId]);

  /** Rilegge i valori in uso: dopo un salvataggio (anche rifiutato) la finestra mostra la verita'. */
  const refresh = () =>
    connection.call("pluginsettings.get", { pluginId }).then(
      (result) => {
        setValues(result.values);
      },
      () => undefined,
    );
  const save = (key: string, value: Value | null) => {
    // Subito sullo schermo; il motore conferma (o corregge) subito dopo.
    if (value !== null)
      setValues((current) => (current === undefined ? current : { ...current, [key]: value }));
    connection
      .call("pluginsettings.set", { pluginId, values: { [key]: value } })
      .then(
        () => {
          setSaved("saved");
        },
        () => {
          setSaved("error");
        },
      )
      .then(refresh, refresh);
  };
  const saveLater = (key: string, value: Value | null) => {
    const timer = timers.current.get(key);
    if (timer !== undefined) clearTimeout(timer);
    timers.current.set(
      key,
      setTimeout(() => {
        timers.current.delete(key);
        save(key, value);
      }, SAVE_DELAY_MS),
    );
  };

  if (values === undefined) {
    return (
      <p role={saved === "error" ? "alert" : "status"} className="text-sm text-muted">
        {saved === "error" ? t("core.pluginSettings.error") : t("core.pluginSettings.loading")}
      </p>
    );
  }

  return (
    <>
      <ul className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        {defs.map((def) => {
          const value = values[def.key];
          const changed = def.default === undefined ? value !== undefined : value !== def.default;
          const id = `setting-${pluginId}-${def.key}`;
          const text = draft[def.key];
          return (
            <li key={def.key} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor={id} className="text-sm font-semibold">
                  {t(def.title)}
                </label>
                {changed && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(({ [def.key]: _gone, ...rest }) => rest);
                      save(def.key, null);
                    }}
                    className="text-xs text-muted underline hover:text-fg"
                  >
                    {t("core.pluginSettings.reset")}
                  </button>
                )}
              </div>
              {def.type === "boolean" ? (
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input
                    id={id}
                    type="checkbox"
                    role="switch"
                    checked={value === true}
                    onChange={(event) => {
                      save(def.key, event.target.checked);
                    }}
                    className="h-4 w-4 accent-[var(--cl-cue)]"
                  />
                  {value === true ? t("core.modules.on") : t("core.modules.off")}
                </label>
              ) : def.choices !== undefined ? (
                <select
                  id={id}
                  value={String(value ?? "")}
                  onChange={(event) => {
                    const choice = def.choices?.find((c) => String(c.value) === event.target.value);
                    if (choice !== undefined) save(def.key, choice.value);
                  }}
                  className={FIELD}
                >
                  {value === undefined && <option value="" disabled />}
                  {def.choices.map((choice) => (
                    <option key={String(choice.value)} value={String(choice.value)}>
                      {t(choice.title)}
                    </option>
                  ))}
                </select>
              ) : def.type === "number" ? (
                <div className="flex items-center gap-3">
                  {def.min !== undefined && def.max !== undefined && (
                    <input
                      type="range"
                      aria-hidden="true"
                      tabIndex={-1}
                      min={def.min}
                      max={def.max}
                      step={def.max - def.min > 20 ? 1 : 0.1}
                      value={typeof value === "number" ? value : def.min}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        setDraft(({ [def.key]: _gone, ...rest }) => rest);
                        setValues({ ...values, [def.key]: next });
                        saveLater(def.key, next);
                      }}
                      className="min-w-0 flex-1 accent-[var(--cl-cue)]"
                    />
                  )}
                  <input
                    id={id}
                    type="number"
                    {...(def.min === undefined ? {} : { min: def.min })}
                    {...(def.max === undefined ? {} : { max: def.max })}
                    value={text ?? String(value ?? "")}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setDraft({ ...draft, [def.key]: raw });
                      const next = Number(raw);
                      if (raw.trim() !== "" && Number.isFinite(next)) saveLater(def.key, next);
                    }}
                    onBlur={() => {
                      setDraft(({ [def.key]: _gone, ...rest }) => rest);
                    }}
                    className={`${FIELD} w-24`}
                  />
                </div>
              ) : (
                <input
                  id={id}
                  type="text"
                  maxLength={2000}
                  value={text ?? String(value ?? "")}
                  onChange={(event) => {
                    setDraft({ ...draft, [def.key]: event.target.value });
                    saveLater(def.key, event.target.value);
                  }}
                  onBlur={() => {
                    setDraft(({ [def.key]: _gone, ...rest }) => rest);
                  }}
                  className={FIELD}
                />
              )}
              {def.description !== undefined && (
                <p className="text-xs text-faint">{t(def.description)}</p>
              )}
            </li>
          );
        })}
      </ul>
      <p
        role={saved === "error" ? "alert" : "status"}
        className={`min-h-4 text-xs ${saved === "error" ? "text-live-soft" : "text-faint"}`}
      >
        {saved === "saved"
          ? t("core.pluginSettings.saved")
          : saved === "error"
            ? t("core.pluginSettings.error")
            : ""}
      </p>
    </>
  );
}
