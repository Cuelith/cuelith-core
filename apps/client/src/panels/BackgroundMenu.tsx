import type { Item, MediaRef, Slide } from "@cuelith/protocol";
import { useEngine, useT } from "../engine/react.js";
import { roomLook, useChooseBackground } from "../station/backgrounds.js";
import { useRun } from "../station/station.js";
import { MenuButton, type MenuItem } from "../ui/Menu.js";

/** Velo scuro sopra gli sfondi: nessuno, leggero, medio, forte. */
const DIMS = [
  ["none", 0],
  ["light", 0.25],
  ["medium", 0.45],
  ["strong", 0.65],
] as const;

/**
 * Sfondi dei testi (decisione 0003): per la slide scelta, per tutto
 * l'elemento, e quello predefinito del look Sala con il velo che tiene
 * leggibile il testo. Le immagini si scelgono dal computer del motore e
 * finiscono nell'archivio media.
 */
export function BackgroundMenu({
  item,
  slide,
  slideNumber,
}: {
  item: Item;
  /** La slide scelta di questo elemento (in anteprima, o in onda), se c'e'. */
  slide: Slide | undefined;
  slideNumber: number | undefined;
}) {
  const t = useT();
  const run = useRun();
  const { state } = useEngine();
  const choose = useChooseBackground();
  const room = state === undefined ? undefined : roomLook(state);

  const pick = (apply: (background: MediaRef) => unknown) => () => {
    void choose?.().then((background) => {
      if (background !== undefined) void apply(background);
    });
  };
  const setLook = (background: { image?: string | undefined; dim?: number }) => {
    if (room === undefined) return;
    const { image, ...rest } = { ...room.style.background, ...background };
    void run("look.update", {
      id: room.look.id,
      style: { ...room.style, background: image === undefined ? rest : { ...rest, image } },
    });
  };
  const number = String(slideNumber ?? "");
  const currentDim = room?.style.background.dim ?? 0;

  const items: MenuItem[] = [];
  if (slide !== undefined) {
    if (choose !== undefined) {
      items.push({
        label: t("core.background.slide", { n: number }),
        action: pick((background) =>
          run("slide.update", { itemId: item.id, slideId: slide.id, background }),
        ),
      });
    }
    if (slide.background !== undefined) {
      items.push({
        label: t("core.background.slideRemove", { n: number }),
        action: () => {
          void run("slide.update", { itemId: item.id, slideId: slide.id, background: null });
        },
      });
    }
  }
  if (choose !== undefined) {
    items.push({
      label: t("core.background.item"),
      action: pick((background) => run("item.update", { id: item.id, background })),
    });
  }
  if (item.background !== undefined) {
    items.push({
      label: t("core.background.itemRemove"),
      action: () => {
        void run("item.update", { id: item.id, background: null });
      },
    });
  }
  if (room !== undefined) {
    if (choose !== undefined) {
      items.push({
        label: t("core.background.look", { look: room.look.name }),
        action: pick((background) => {
          setLook({ image: background.uri });
        }),
      });
    }
    if (room.style.background.image !== undefined) {
      items.push({
        label: t("core.background.lookRemove", { look: room.look.name }),
        action: () => {
          setLook({ image: undefined });
        },
      });
    }
    for (const [name, dim] of DIMS) {
      items.push({
        label: `${t(`core.background.dim.${name}`)}${currentDim === dim ? " ✓" : ""}`,
        action: () => {
          setLook({ dim });
        },
      });
    }
  }
  if (items.length === 0) return null;
  return (
    <MenuButton
      label={t("core.background.menu")}
      items={items}
      align="right"
      className="whitespace-nowrap rounded-md border border-line-2 px-2 py-0.5 text-xs text-muted hover:border-faint hover:text-fg"
    >
      {t("core.background.button")}
    </MenuButton>
  );
}
