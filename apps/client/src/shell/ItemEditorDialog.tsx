import { checkStyle, creditsReserve, effectiveTextStyle } from "@cuelith-core/core-looks";
import {
  ATTACHMENT_ROLES,
  AUTHOR_ROLES,
  newId,
  type Attachment,
  type Item,
  type Slide,
  type TextOverride,
} from "@cuelith/protocol";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useConnection, useEngine, useT } from "../engine/react.js";
import {
  creditsProblems,
  creditsToForm,
  formToCredits,
  type CreditsForm,
} from "../station/credits.js";
import { useLibraryTags } from "../station/library.js";
import { joinSlides, roomStyle, splitSlides } from "../station/show.js";
import { measure, roomOutputs } from "../station/textStyles.js";
import { useRun, useStation, type EditorRequest } from "../station/station.js";
import { Button } from "../ui/Button.js";
import { FieldLabel, INPUT } from "../ui/Dialogs.js";
import { SlideText } from "../ui/SlideText.js";

const textField = (value: string) => ({ kind: "text" as const, value });
type Tab = "text" | "style" | "credits" | "extra";

interface Draft {
  readonly title: string;
  readonly text: string;
  readonly credits: CreditsForm;
  /** Stile del testo di questo elemento (decisione 0015): solo cio' che l'utente ha toccato. */
  readonly textStyle: TextOverride | undefined;
  readonly tags: readonly string[];
  readonly attachments: readonly Attachment[];
}

function draftOf(item: Item | undefined): Draft {
  return {
    title: item?.title ?? "",
    text: item === undefined ? "" : joinSlides(item.slides),
    credits: creditsToForm(item?.credits),
    textStyle: item?.textStyle,
    tags: item?.tags ?? [],
    attachments: item?.attachments ?? [],
  };
}

/**
 * Slide del testo scritto, riusando id e altri campi (accordi, note) delle
 * slide esistenti nella stessa posizione.
 */
function slidesFrom(texts: readonly string[], existing: readonly Slide[]): Slide[] {
  return texts.map((value, index) => {
    const current = existing[index];
    return current === undefined
      ? { id: newId(), fields: { text: textField(value) } }
      : { ...current, fields: { ...current.fields, text: textField(value) } };
  });
}

/**
 * Editor di un elemento, nello show o nell'archivio: testo (una riga vuota
 * separa le slide), crediti e copyright, tag e file allegati (basi musicali).
 */
export function ItemEditorDialog({ request }: { request: EditorRequest }) {
  const t = useT();
  const { state } = useEngine();
  const connection = useConnection();
  const run = useRun();
  const { closeEditor, select, notify } = useStation();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const inLibrary = request.mode === "libraryCreate" || request.mode === "libraryEdit";

  const showItem = request.mode === "edit" ? state?.show.items[request.itemId] : undefined;
  const [libraryItem, setLibraryItem] = useState<Item | undefined>();
  const [loadError, setLoadError] = useState(false);
  const loading = request.mode === "libraryEdit" && libraryItem === undefined && !loadError;
  const existing = request.mode === "libraryEdit" ? libraryItem : showItem;

  const [draft, setDraft] = useState<Draft>(() => draftOf(showItem));
  const [tab, setTab] = useState<Tab>("text");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
  }, []);

  useEffect(() => {
    if (request.mode !== "libraryEdit") return;
    let cancelled = false;
    connection
      .call("library.getItem", { id: request.itemId })
      .then(({ item }) => {
        if (cancelled) return;
        setLibraryItem(item);
        setDraft(draftOf(item));
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, request]);

  const slides = splitSlides(draft.text);
  // Con uno stile globale attivo il testo scritto deve ancora entrare nelle uscite: lo si dice mentre si scrive.
  const room = state === undefined ? undefined : roomStyle(state);
  const fitProblem = (() => {
    const active = room?.globalText;
    if (state === undefined || active === undefined || slides.length === 0) return undefined;
    const boxes = roomOutputs(state);
    const credits = draft.credits.show !== "none";
    const reserve = Math.max(...boxes.map((box) => creditsReserve(box.height, credits)));
    const result = checkStyle(slides, active.text, boxes, measure(), reserve);
    const first = result.failures[0];
    return result.ok || first === undefined
      ? undefined
      : { name: active.name, slide: first.slide + 1, output: first.output };
  })();
  const problems = creditsProblems(draft.credits);
  const titleMissing = inLibrary && draft.title.trim() === "";
  const canSave =
    !saving &&
    !loading &&
    !loadError &&
    slides.length > 0 &&
    problems.length === 0 &&
    !titleMissing;
  const set = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
  };

  const save = async () => {
    setSaving(true);
    const title = draft.title.trim();
    const credits = formToCredits(draft.credits);
    const tags = [...draft.tags];
    const attachments = [...draft.attachments];
    let ok = false;

    if (request.mode === "create") {
      const created = await run("item.create", {
        type: "core.text",
        title,
        slides: slides.map((value) => ({ fields: { text: textField(value) } })),
        ...(credits === undefined ? {} : { credits }),
        ...(tags.length === 0 ? {} : { tags }),
        ...(attachments.length === 0 ? {} : { attachments }),
      });
      if (created !== undefined && draft.textStyle !== undefined) {
        await run("item.update", { id: created.id, textStyle: draft.textStyle });
      }
      const entry = created && (await run("playlist.add", { itemId: created.id }));
      if (entry !== undefined) {
        // La prima slide va in anteprima: Invio la manda in onda.
        select(entry.id);
        await run("preview.set", { entryId: entry.id, slideIndex: 0 });
        ok = true;
      }
    } else if (request.mode === "edit" && showItem !== undefined) {
      ok = await saveShowItem(showItem, {
        title,
        credits,
        tags,
        attachments,
        textStyle: draft.textStyle ?? null,
      });
    } else if (inLibrary) {
      const base = existing;
      const item: Item = {
        id: base?.id ?? newId(),
        type: base?.type ?? "core.text",
        title,
        slides: slidesFrom(slides, base?.slides ?? []),
        meta: base?.meta ?? {},
        ...(credits === undefined ? {} : { credits }),
        ...(draft.textStyle === undefined ? {} : { textStyle: draft.textStyle }),
        ...(tags.length === 0 ? {} : { tags }),
        ...(attachments.length === 0 ? {} : { attachments }),
        ...(base?.derivedFrom === undefined ? {} : { derivedFrom: base.derivedFrom }),
      };
      const libraryId = request.mode === "libraryCreate" ? request.libraryId : undefined;
      ok =
        (await run("library.saveItem", {
          item,
          ...(libraryId === undefined ? {} : { libraryId }),
        })) !== undefined;
    }
    setSaving(false);
    if (ok) dialog.current?.close();
  };

  /** Un elemento dello show: campi dell'elemento, poi le slide una per una. */
  const saveShowItem = async (
    item: Item,
    patch: {
      title: string;
      credits: Item["credits"];
      tags: string[];
      attachments: Attachment[];
      textStyle: TextOverride | null;
    },
  ): Promise<boolean> => {
    const itemId = item.id;
    let ok =
      (await run("item.update", {
        id: itemId,
        title: patch.title,
        credits: patch.credits ?? null,
        textStyle: patch.textStyle,
        tags: patch.tags,
        attachments: patch.attachments,
      })) !== undefined;
    for (let i = 0; ok && i < slides.length; i++) {
      const value = slides[i] ?? "";
      const current = item.slides[i];
      if (current === undefined) {
        ok =
          (await run("slide.insert", { itemId, slide: { fields: { text: textField(value) } } })) !==
          undefined;
      } else if (current.fields["text"]?.value !== value) {
        const fields = { ...current.fields, text: textField(value) };
        ok = (await run("slide.update", { itemId, slideId: current.id, fields })) !== undefined;
      }
    }
    for (const surplus of item.slides.slice(slides.length).reverse()) {
      if (!ok) break;
      ok = (await run("slide.delete", { itemId, slideId: surplus.id })) !== undefined;
    }
    return ok;
  };

  const heading =
    request.mode === "create"
      ? "core.editor.newTitle"
      : request.mode === "edit"
        ? "core.editor.editTitle"
        : request.mode === "libraryCreate"
          ? "core.editor.newLibraryTitle"
          : "core.editor.editLibraryTitle";

  return (
    <dialog
      ref={dialog}
      onClose={(event) => {
        if (event.target !== event.currentTarget) return;
        closeEditor();
        // Il fuoco tornerebbe al pulsante che ha aperto l'editor: Invio e Spazio
        // devono tornare subito ai comandi della regia.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }}
      aria-labelledby={titleId}
      className="m-auto w-[min(720px,calc(100vw-32px))] rounded-xl border border-line-2 bg-bg-2 p-0 text-fg backdrop:bg-black/60"
    >
      <form
        method="dialog"
        className="flex flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) void save();
        }}
      >
        <h2 id={titleId} className="border-b border-line px-5 py-4 text-base font-semibold">
          {t(heading)}
        </h2>
        <div role="tablist" className="flex gap-4 border-b border-line px-5">
          {(["text", "style", "credits", "extra"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => {
                setTab(id);
              }}
              className={`-mb-px border-b-2 py-2.5 text-[13px] ${
                tab === id
                  ? "border-fg font-semibold text-fg"
                  : "border-transparent text-muted hover:text-fg"
              }`}
            >
              {t(`core.editor.tab.${id}`)}
              {id === "credits" && problems.length > 0 && (
                <span className="ml-1 text-live-soft">•</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex min-h-80 flex-col gap-4 px-5 py-4">
          {loading && <p className="text-sm text-faint">{t("core.modules.loading")}</p>}
          {loadError && (
            <p className="text-sm text-live-soft">{t("core.error.libraryItemNotFound")}</p>
          )}
          {!loading && !loadError && (
            <>
              <label className={`flex flex-col gap-1.5 ${tab === "text" ? "" : "hidden"}`}>
                <FieldLabel>{t("core.editor.titleLabel")}</FieldLabel>
                <input
                  value={draft.title}
                  onChange={(event) => {
                    set({ title: event.target.value });
                  }}
                  placeholder={t("core.editor.untitled")}
                  aria-invalid={titleMissing}
                  className={INPUT}
                />
              </label>
              {tab === "text" && (
                <label className="flex flex-col gap-1.5">
                  <FieldLabel>{t("core.editor.textLabel")}</FieldLabel>
                  <textarea
                    value={draft.text}
                    onChange={(event) => {
                      set({ text: event.target.value });
                    }}
                    rows={12}
                    className={`${INPUT} resize-y font-display text-base leading-snug`}
                  />
                  {fitProblem !== undefined && (
                    <span role="alert" className="text-xs text-live-soft">
                      {t("core.editor.fitWarning", {
                        name: fitProblem.name,
                        slide: String(fitProblem.slide),
                        output: fitProblem.output,
                      })}
                    </span>
                  )}
                  <span className="flex justify-between gap-3 text-xs text-faint">
                    <span>{t("core.editor.textHint")}</span>
                    <span className="shrink-0 font-mono" data-testid="slide-count">
                      {t("core.editor.slideCount", { count: slides.length })}
                    </span>
                  </span>
                </label>
              )}
              {tab === "style" && (
                <TextStyleEditor
                  value={draft.textStyle}
                  sample={slides[0] ?? ""}
                  onChange={(textStyle) => {
                    set({ textStyle });
                  }}
                />
              )}
              {tab === "credits" && (
                <CreditsEditor
                  form={draft.credits}
                  problems={problems}
                  onChange={(credits) => {
                    set({ credits });
                  }}
                />
              )}
              {tab === "extra" && (
                <ExtrasEditor
                  tags={draft.tags}
                  attachments={draft.attachments}
                  onTags={(tags) => {
                    set({ tags });
                  }}
                  onAttachments={(attachments) => {
                    set({ attachments });
                  }}
                  onImportError={(key) => {
                    notify(key);
                  }}
                />
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          {titleMissing && (
            <span className="mr-auto text-xs text-live-soft">{t("core.error.titleRequired")}</span>
          )}
          <Button
            onClick={() => {
              dialog.current?.close();
            }}
          >
            {t("core.action.cancel")}
          </Button>
          <Button type="submit" tone="primary" disabled={!canSave}>
            {t("core.action.save")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${wide ? "col-span-2" : ""}`}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </label>
  );
}

/** Scheda Crediti: autori con ruolo, copyright, CCLI e dove mostrarli sulle uscite. */
function CreditsEditor({
  form,
  problems,
  onChange,
}: {
  form: CreditsForm;
  problems: readonly string[];
  onChange: (form: CreditsForm) => void;
}) {
  const t = useT();
  const set = (patch: Partial<CreditsForm>) => {
    onChange({ ...form, ...patch });
  };
  const input = (key: "copyright" | "publisher" | "year" | "ccli" | "license", invalid = false) => (
    <input
      value={form[key]}
      aria-invalid={invalid}
      onChange={(event) => {
        set({ [key]: event.target.value });
      }}
      className={`${INPUT} ${invalid ? "border-live" : ""}`}
    />
  );

  return (
    <div className="grid grid-cols-2 gap-3">
      <fieldset className="col-span-2 flex flex-col gap-2">
        <legend className="mb-1.5">
          <FieldLabel>{t("core.credits.authors")}</FieldLabel>
        </legend>
        {form.authors.map((author, index) => (
          <div key={index} className="flex gap-2">
            <input
              aria-label={t("core.credits.authorName", { n: index + 1 })}
              value={author.name}
              onChange={(event) => {
                set({
                  authors: form.authors.map((a, i) =>
                    i === index ? { ...a, name: event.target.value } : a,
                  ),
                });
              }}
              className={`${INPUT} min-w-0 flex-1`}
            />
            <select
              aria-label={t("core.credits.authorRole", { n: index + 1 })}
              value={author.role}
              onChange={(event) => {
                const role = event.target.value as (typeof AUTHOR_ROLES)[number];
                set({ authors: form.authors.map((a, i) => (i === index ? { ...a, role } : a)) });
              }}
              className={INPUT}
            >
              {AUTHOR_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`core.credits.role.${role}`)}
                </option>
              ))}
            </select>
            <Button
              aria-label={t("core.credits.removeAuthor", { n: index + 1 })}
              onClick={() => {
                set({ authors: form.authors.filter((_a, i) => i !== index) });
              }}
            >
              ×
            </Button>
          </div>
        ))}
        <div>
          <Button
            size="sm"
            onClick={() => {
              set({
                authors: [
                  ...form.authors,
                  { name: "", role: form.authors.length === 0 ? "artist" : "words" },
                ],
              });
            }}
          >
            + {t("core.credits.addAuthor")}
          </Button>
        </div>
      </fieldset>
      <Field label={t("core.credits.copyright")} wide>
        {input("copyright")}
      </Field>
      <Field label={t("core.credits.publisher")}>{input("publisher")}</Field>
      <Field label={t("core.credits.year")}>{input("year", problems.includes("year"))}</Field>
      <Field label={t("core.credits.ccli")}>{input("ccli", problems.includes("ccli"))}</Field>
      <Field label={t("core.credits.license")}>{input("license")}</Field>
      <Field label={t("core.credits.altTitles")} wide>
        <textarea
          rows={2}
          value={form.altTitles}
          onChange={(event) => {
            set({ altTitles: event.target.value });
          }}
          className={`${INPUT} resize-y`}
        />
      </Field>
      <Field label={t("core.credits.show")} wide>
        <select
          value={form.show}
          onChange={(event) => {
            set({ show: event.target.value as CreditsForm["show"] });
          }}
          className={INPUT}
        >
          {(["none", "first", "last"] as const).map((option) => (
            <option key={option} value={option}>
              {t(`core.credits.showOption.${option}`)}
            </option>
          ))}
        </select>
      </Field>
      {problems.length > 0 && (
        <p className="col-span-2 text-xs text-live-soft">
          {problems.map((p) => t(`core.credits.problem.${p}`)).join(" ")}
        </p>
      )}
    </div>
  );
}

/** Scheda Tag e file: etichette libere e allegati dall'archivio media (basi musicali). */
function ExtrasEditor({
  tags,
  attachments,
  onTags,
  onAttachments,
  onImportError,
}: {
  tags: readonly string[];
  attachments: readonly Attachment[];
  onTags: (tags: readonly string[]) => void;
  onAttachments: (attachments: readonly Attachment[]) => void;
  onImportError: (key: string) => void;
}) {
  const t = useT();
  const run = useRun();
  const known = useLibraryTags();
  const listId = useId();
  const [tag, setTag] = useState("");
  const [importing, setImporting] = useState(false);
  const desktop = window.cuelithDesktop;

  const addTag = () => {
    const value = tag.trim().slice(0, 40);
    setTag("");
    if (value === "" || tags.some((existing) => existing.toLowerCase() === value.toLowerCase()))
      return;
    onTags([...tags, value]);
  };

  const onTagKey = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag();
    } else if (event.key === "Backspace" && tag === "" && tags.length > 0) {
      onTags(tags.slice(0, -1));
    }
  };

  const importFiles = async () => {
    if (desktop === undefined) return;
    const paths = await desktop.chooseMediaFiles("audio");
    if (paths.length === 0) return;
    setImporting(true);
    const added: Attachment[] = [];
    for (const path of paths) {
      const result = await run("media.import", { path });
      if (result === undefined) continue;
      const { media } = result;
      if (
        attachments.some((a) => a.mediaId === media.id) ||
        added.some((a) => a.mediaId === media.id)
      ) {
        onImportError("core.attachments.duplicate");
        continue;
      }
      added.push({
        mediaId: media.id,
        name: media.name,
        kind: media.kind,
        role: media.kind === "audio" ? "backing" : "other",
      });
    }
    setImporting(false);
    if (added.length > 0) onAttachments([...attachments, ...added]);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{t("core.tags.label")}</FieldLabel>
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-line-2 bg-bg px-2 py-1.5">
          {tags.map((value) => (
            <span
              key={value}
              className="flex items-center gap-1 rounded-full bg-mod-chip px-2 py-0.5 text-xs text-mod"
            >
              {value}
              <button
                type="button"
                aria-label={t("core.tags.remove", { tag: value })}
                onClick={() => {
                  onTags(tags.filter((existing) => existing !== value));
                }}
                className="text-mod hover:text-fg"
              >
                ×
              </button>
            </span>
          ))}
          <input
            aria-label={t("core.tags.add")}
            list={listId}
            value={tag}
            onChange={(event) => {
              setTag(event.target.value);
            }}
            onKeyDown={onTagKey}
            onBlur={addTag}
            placeholder={t("core.tags.placeholder")}
            className="min-w-32 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none"
          />
          <datalist id={listId}>
            {known.map((entry) => (
              <option key={entry.tag} value={entry.tag} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <FieldLabel>{t("core.attachments.label")}</FieldLabel>
        {attachments.length === 0 && (
          <p className="text-sm text-faint">{t("core.attachments.empty")}</p>
        )}
        <ul className="flex flex-col gap-2" aria-label={t("core.attachments.label")}>
          {attachments.map((attachment) => (
            <li
              key={attachment.mediaId}
              className="flex flex-wrap items-center gap-2 rounded-lg bg-bg-3 px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{attachment.name}</span>
              <select
                aria-label={t("core.attachments.role", { name: attachment.name })}
                value={attachment.role}
                onChange={(event) => {
                  const role = event.target.value as Attachment["role"];
                  onAttachments(
                    attachments.map((a) => (a.mediaId === attachment.mediaId ? { ...a, role } : a)),
                  );
                }}
                className={`${INPUT} py-1`}
              >
                {ATTACHMENT_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {t(`core.attachments.roleOption.${role}`)}
                  </option>
                ))}
              </select>
              {attachment.kind === "audio" && (
                <audio
                  controls
                  preload="none"
                  src={`/media/${attachment.mediaId}`}
                  aria-label={t("core.attachments.listen", { name: attachment.name })}
                  className="h-8 max-w-60"
                />
              )}
              <Button
                size="sm"
                aria-label={t("core.attachments.remove", { name: attachment.name })}
                onClick={() => {
                  onAttachments(attachments.filter((a) => a.mediaId !== attachment.mediaId));
                }}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={desktop === undefined || importing}
            onClick={() => void importFiles()}
          >
            + {t("core.attachments.add")}
          </Button>
          <span className="text-xs text-faint">
            {t(desktop === undefined ? "core.attachments.localOnly" : "core.attachments.hint")}
          </span>
        </div>
      </div>
    </div>
  );
}

const SELECT = "rounded-md border border-line-2 bg-bg px-2 py-1 text-sm text-fg";

/** Un valore facoltativo: "" = come la sala, altrimenti il valore scelto. */
function optional(value: string): string | undefined {
  return value === "" ? undefined : value;
}

/**
 * Stile del testo di questo elemento, come in un editor di testi: si tocca solo cio' che serve e
 * il resto resta come la sala. Se la regia ha scelto uno stile globale, queste modifiche restano
 * salvate ma sospese (decisione 0015).
 */
function TextStyleEditor({
  value,
  sample,
  onChange,
}: {
  value: TextOverride | undefined;
  sample: string;
  onChange: (value: TextOverride | undefined) => void;
}) {
  const t = useT();
  const { state } = useEngine();
  const base = state === undefined ? undefined : roomStyle(state);
  const override = value ?? {};
  const update = (patch: Partial<Record<keyof TextOverride, unknown>>) => {
    const merged = Object.fromEntries(
      Object.entries({ ...override, ...patch }).filter(([, entry]) => entry !== undefined),
    ) as TextOverride;
    onChange(Object.keys(merged).length === 0 ? undefined : merged);
  };
  const suspended = base?.globalText;
  const previewStyle =
    base === undefined
      ? undefined
      : { ...base, text: effectiveTextStyle(base.text, undefined, value) };
  const number = (raw: string): number | undefined => {
    const parsed = Number(raw);
    return raw.trim() === "" || !Number.isFinite(parsed) ? undefined : parsed;
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-faint">{t("core.editor.style.intro")}</p>
      {suspended !== undefined && (
        <p role="status" className="text-xs text-live-soft">
          {t("core.editor.style.suspended", { name: suspended.name })}
        </p>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("core.editor.style.scale")}>
          <input
            type="number"
            min={50}
            max={200}
            step={5}
            placeholder="100"
            value={override.scale === undefined ? "" : Math.round(override.scale * 100)}
            onChange={(event) => {
              const percent = number(event.target.value);
              update({
                scale:
                  percent === undefined ? undefined : Math.min(200, Math.max(50, percent)) / 100,
              });
            }}
            className={INPUT}
          />
        </Field>
        <Field label={t("core.textstyles.font")}>
          <select
            value={override.font ?? ""}
            onChange={(event) => {
              update({ font: optional(event.target.value) });
            }}
            className={SELECT}
          >
            <option value="">{t("core.editor.style.default")}</option>
            {(["display", "body", "mono"] as const).map((font) => (
              <option key={font} value={font}>
                {t(`core.textstyles.font.${font}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("core.textstyles.align")}>
          <select
            value={override.align ?? ""}
            onChange={(event) => {
              update({ align: optional(event.target.value) });
            }}
            className={SELECT}
          >
            <option value="">{t("core.editor.style.default")}</option>
            {(["left", "center", "right"] as const).map((align) => (
              <option key={align} value={align}>
                {t(`core.textstyles.align.${align}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("core.textstyles.lineHeight")}>
          <input
            type="number"
            min={0.8}
            max={2.5}
            step={0.05}
            placeholder="1.25"
            value={override.lineHeight ?? ""}
            onChange={(event) => {
              const n = number(event.target.value);
              update({ lineHeight: n === undefined ? undefined : Math.min(2.5, Math.max(0.8, n)) });
            }}
            className={INPUT}
          />
        </Field>
        <Field label={t("core.textstyles.bold")}>
          <select
            value={override.weight ?? ""}
            onChange={(event) => {
              update({ weight: optional(event.target.value) });
            }}
            className={SELECT}
          >
            <option value="">{t("core.editor.style.default")}</option>
            <option value="bold">{t("core.textstyles.bold")}</option>
            <option value="normal">—</option>
          </select>
        </Field>
        <Field label={t("core.textstyles.uppercase")}>
          <select
            value={override.uppercase === undefined ? "" : String(override.uppercase)}
            onChange={(event) => {
              update({
                uppercase: event.target.value === "" ? undefined : event.target.value === "true",
              });
            }}
            className={SELECT}
          >
            <option value="">{t("core.editor.style.default")}</option>
            <option value="true">{t("core.textstyles.uppercase")}</option>
            <option value="false">—</option>
          </select>
        </Field>
        <Field label={t("core.textstyles.color")}>
          <span className="flex items-center gap-2">
            <input
              type="color"
              value={override.color ?? base?.text.color ?? "#FFFFFF"}
              onChange={(event) => {
                update({ color: event.target.value.toUpperCase() });
              }}
              className="h-8 w-14 rounded-md border border-line-2 bg-bg"
            />
            {override.color !== undefined && (
              <button
                type="button"
                onClick={() => {
                  update({ color: undefined });
                }}
                className="text-xs text-muted hover:text-fg"
              >
                {t("core.editor.style.default")}
              </button>
            )}
          </span>
        </Field>
      </div>
      <div className="flex items-start gap-3">
        <div className="flex w-56 flex-col gap-1.5">
          <FieldLabel>{t("core.editor.style.preview")}</FieldLabel>
          <div
            className="relative aspect-video overflow-hidden rounded-md border border-line bg-screen"
            style={{ containerType: "size" }}
          >
            <SlideText text={sample === "" ? "Aa" : sample} style={previewStyle} />
          </div>
        </div>
        <Button
          disabled={value === undefined}
          onClick={() => {
            onChange(undefined);
          }}
        >
          {t("core.editor.style.reset")}
        </Button>
      </div>
    </div>
  );
}
