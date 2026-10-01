import type { Library } from "@cuelith/protocol";
import { useId, useState } from "react";
import { useT } from "../../engine/react.js";
import { useRun } from "../../station/station.js";
import { Button } from "../../ui/Button.js";
import { FieldLabel, INPUT, ModalDialog } from "../../ui/Dialogs.js";

/** Colori proposti per le librerie: quelli del linguaggio visivo (cap. 17). */
const SWATCHES = ["#37D1BF", "#FF8A6E", "#F2B441", "#C9BFFF", "#8FB8FF", "#E8A0C8", "#A9ADB4"];

const CODE = /^[A-Z0-9]{1,8}$/;

/**
 * Scheda di una libreria: nome, categoria (per raggrupparle), sigla (per
 * cercare "INN 245"), colore e descrizione. Serve per crearla e modificarla.
 */
export function LibraryDialog({
  library,
  categories,
  onClose,
  onCreated,
}: {
  /** Assente = nuova libreria. */
  library: Library | undefined;
  categories: readonly string[];
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const t = useT();
  const run = useRun();
  const listId = useId();
  const [name, setName] = useState(library?.name ?? "");
  const [category, setCategory] = useState(library?.category ?? "");
  const [code, setCode] = useState(library?.code ?? "");
  const [color, setColor] = useState<string | undefined>(library?.color);
  const [description, setDescription] = useState(library?.description ?? "");
  const codeInvalid = code !== "" && !CODE.test(code);
  const canSave = name.trim() !== "" && !codeInvalid;

  const save = async (): Promise<boolean> => {
    const fields = {
      name: name.trim(),
      category: category.trim(),
      code,
      description: description.trim(),
    };
    if (library === undefined) {
      const created = await run("library.create", {
        name: fields.name,
        ...(fields.category === "" ? {} : { category: fields.category }),
        ...(fields.code === "" ? {} : { code: fields.code }),
        ...(color === undefined ? {} : { color }),
        ...(fields.description === "" ? {} : { description: fields.description }),
      });
      if (created !== undefined) onCreated?.(created.id);
      return created !== undefined;
    }
    const updated = await run("library.update", {
      id: library.id,
      name: fields.name,
      category: fields.category === "" ? null : fields.category,
      code: fields.code === "" ? null : fields.code,
      color: color ?? null,
      description: fields.description === "" ? null : fields.description,
    });
    return updated !== undefined;
  };

  return (
    <ModalDialog
      title={
        library === undefined
          ? t("core.library.new")
          : t("core.library.editTitle", { name: library.name })
      }
      onClose={onClose}
    >
      {(close) => (
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSave) return;
            void save().then((ok) => {
              if (ok) close();
            });
          }}
        >
          <label className="flex flex-col gap-1.5">
            <FieldLabel>{t("core.outputs.name")}</FieldLabel>
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              className={INPUT}
            />
          </label>
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            <label className="flex flex-col gap-1.5">
              <FieldLabel>{t("core.library.category")}</FieldLabel>
              <input
                list={listId}
                value={category}
                placeholder={t("core.library.categoryHint")}
                onChange={(event) => {
                  setCategory(event.target.value);
                }}
                className={INPUT}
              />
              <datalist id={listId}>
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1.5">
              <FieldLabel>{t("core.library.code")}</FieldLabel>
              <input
                value={code}
                maxLength={8}
                aria-invalid={codeInvalid}
                placeholder={t("core.library.codePlaceholder")}
                onChange={(event) => {
                  setCode(event.target.value.toUpperCase().replace(/\s/g, ""));
                }}
                className={`${INPUT} font-mono ${codeInvalid ? "border-live" : ""}`}
              />
            </label>
          </div>
          <p className={`-mt-2 text-xs ${codeInvalid ? "text-live-soft" : "text-faint"}`}>
            {t(codeInvalid ? "core.library.codeInvalid" : "core.library.codeHint", {
              code: code || "INN",
            })}
          </p>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5">
              <FieldLabel>{t("core.library.color")}</FieldLabel>
            </legend>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={color === undefined}
                aria-label={t("core.library.noColor")}
                onClick={() => {
                  setColor(undefined);
                }}
                className={`h-7 w-7 rounded-full border border-line-2 ${color === undefined ? "outline-2 outline-offset-2 outline-fg" : ""}`}
              />
              {SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  aria-pressed={color === swatch}
                  aria-label={swatch}
                  onClick={() => {
                    setColor(swatch);
                  }}
                  className={`h-7 w-7 rounded-full ${color === swatch ? "outline-2 outline-offset-2 outline-fg" : ""}`}
                  style={{ background: swatch }}
                />
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1.5">
            <FieldLabel>{t("core.library.description")}</FieldLabel>
            <textarea
              rows={2}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
              className={`${INPUT} resize-y`}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={close}>{t("core.action.cancel")}</Button>
            <Button type="submit" tone="primary" disabled={!canSave}>
              {library === undefined ? t("core.action.create") : t("core.action.save")}
            </Button>
          </div>
        </form>
      )}
    </ModalDialog>
  );
}
