import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useEngine, useT } from "../engine/react.js";
import type { ShowFiles } from "../station/files.js";
import { useRun } from "../station/station.js";
import { Button } from "../ui/Button.js";

interface MenuItem {
  readonly label: string;
  readonly shortcut?: string;
  readonly disabled?: boolean;
  readonly action: () => void;
}

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

/** Nome dello show nella barra in alto, con il pallino "non salvato" e il menu File. */
export function ShowMenu({ files }: { files: ShowFiles }) {
  const t = useT();
  const { state } = useEngine();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  if (state === undefined) return null;
  const { name } = state.show;
  const { dirty } = state.live;

  const items: MenuItem[] = [
    { label: t("core.file.new"), shortcut: `${MOD}N`, action: () => void files.newShow() },
    {
      label: t("core.file.open"),
      shortcut: `${MOD}O`,
      disabled: !files.canChooseFiles,
      action: () => void files.open(),
    },
    { label: t("core.file.save"), shortcut: `${MOD}S`, action: () => void files.save() },
    {
      label: t("core.file.saveAs"),
      shortcut: `${MOD}⇧S`,
      disabled: !files.canChooseFiles,
      action: () => void files.saveAs(),
    },
    {
      label: t("core.file.rename"),
      action: () => {
        setRenaming(true);
      },
    },
  ];

  const onMenuKey = (event: KeyboardEvent) => {
    const buttons = [
      ...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
    ];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      buttons[(index + step + buttons.length) % buttons.length]?.focus();
    }
  };

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={dirty ? t("core.show.unsaved") : state.live.showPath}
        onClick={() => {
          setOpen(!open);
        }}
        className="flex max-w-64 items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-bg-3"
      >
        <span className="truncate font-medium">{name}</span>
        {dirty && (
          <span
            data-testid="unsaved"
            aria-label={t("core.show.unsaved")}
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-stage"
          />
        )}
        <span aria-hidden="true" className="text-faint">
          ▾
        </span>
      </button>
      {open && (
        <ul
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={t("core.file.menu")}
          onKeyDown={onMenuKey}
          className="absolute top-full left-0 z-30 mt-1 flex w-60 flex-col rounded-lg border border-line-2 bg-bg-2 p-1 shadow-xl"
        >
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.action();
                }}
                className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-[13px] hover:bg-bg-3 focus:bg-bg-3 disabled:opacity-40"
              >
                <span>{item.label}</span>
                {item.shortcut !== undefined && (
                  <span className="font-mono text-[11px] text-faint">{item.shortcut}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {renaming && (
        <RenameDialog
          current={name}
          onClose={() => {
            setRenaming(false);
          }}
        />
      )}
    </div>
  );
}

function RenameDialog({ current, onClose }: { current: string; onClose: () => void }) {
  const t = useT();
  const run = useRun();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [name, setName] = useState(current);

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      onClose={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-labelledby={titleId}
      className="m-auto w-[min(420px,calc(100vw-32px))] rounded-xl border border-line-2 bg-bg-2 p-0 text-fg backdrop:bg-black/60"
    >
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (trimmed === "") return;
          void run("show.rename", { name: trimmed }).then((result) => {
            if (result !== undefined) dialog.current?.close();
          });
        }}
      >
        <h2 id={titleId} className="text-base font-semibold">
          {t("core.file.renameTitle")}
        </h2>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            {t("core.outputs.name")}
          </span>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            className="rounded-md border border-line-2 bg-bg px-3 py-2 text-sm"
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button
            onClick={() => {
              dialog.current?.close();
            }}
          >
            {t("core.action.cancel")}
          </Button>
          <Button type="submit" tone="primary" disabled={name.trim() === ""}>
            {t("core.action.save")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
