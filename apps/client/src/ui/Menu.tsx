import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface MenuItem {
  readonly label: string;
  readonly action: () => void;
  readonly shortcut?: string;
  readonly disabled?: boolean;
  /** Azione che distrugge qualcosa: in rosso. */
  readonly danger?: boolean;
}

/**
 * Pulsante con menu a tendina: frecce su/giu' per muoversi, Esc per chiudere,
 * clic fuori per chiudere. Le voci sono comandi (role menuitem).
 */
export function MenuButton({
  label,
  items,
  children,
  className = "",
  align = "left",
}: {
  /** Nome accessibile del pulsante e del menu. */
  label: string;
  items: readonly MenuItem[];
  children: ReactNode;
  className?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
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

  const onMenuKey = (event: KeyboardEvent) => {
    const buttons = [
      ...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
    ];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
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
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open);
        }}
        className={className}
      >
        {children}
      </button>
      {open && (
        <ul
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className={`absolute top-full z-30 mt-1 flex min-w-56 flex-col rounded-lg border border-line-2 bg-bg-2 p-1 shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen(false);
                  item.action();
                }}
                className={`flex w-full items-center justify-between gap-4 rounded-md px-3 py-1.5 text-left text-[13px] hover:bg-bg-3 focus:bg-bg-3 disabled:opacity-40 ${
                  item.danger === true ? "text-live-soft" : ""
                }`}
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
    </div>
  );
}
