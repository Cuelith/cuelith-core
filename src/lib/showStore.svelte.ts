import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Cue, Show, Theme } from "./types";
import { DEFAULT_THEME } from "./types";

type ShowFile = { show: Show; theme: Theme };

const FILE_FILTERS = [{ name: "Show Cuelith", extensions: ["cuelith"] }];

function createShowStore() {
  let show = $state<Show>({ id: "", title: "", cues: [] });
  let theme = $state<Theme>(DEFAULT_THEME);
  let previewId = $state<string | null>(null);
  let liveId = $state<string | null>(null);
  let currentPath = $state<string | null>(null);

  function hydrate(file: ShowFile) {
    show = file.show;
    theme = file.theme;
    previewId = null;
    liveId = null;
  }

  async function refresh() {
    show = await invoke<Show>("get_show");
    theme = await invoke<Theme>("get_theme");
  }

  async function addSlide(text: string) {
    const cue = await invoke<Cue>("add_slide_cue", { text });
    show = { ...show, cues: [...show.cues, cue] };
  }

  async function addImage(path: string) {
    const cue = await invoke<Cue>("add_image_cue", { path });
    show = { ...show, cues: [...show.cues, cue] };
  }

  async function removeCue(id: string) {
    await invoke("remove_cue", { id });
    show = { ...show, cues: show.cues.filter((c) => c.id !== id) };
    if (previewId === id) previewId = null;
    if (liveId === id) liveId = null;
  }

  function applyOrder(ids: string[]) {
    const byId = new Map(show.cues.map((c) => [c.id, c]));
    show = { ...show, cues: ids.map((id) => byId.get(id)!).filter(Boolean) };
  }

  async function reorder(ids: string[]) {
    applyOrder(ids);
    await invoke("reorder_cues", { ids });
    previewId = null;
    liveId = null;
  }

  async function selectPreview(id: string | null) {
    previewId = id;
    await invoke("set_preview", { cueId: id });
  }

  async function goLive() {
    const cue = await invoke<Cue | null>("go_live");
    liveId = cue?.id ?? null;
  }

  async function clearLive() {
    await invoke("clear_live");
    liveId = null;
  }

  /**
   * Usato dalla modalita' "Lista di regia": manda in diretta il cue in
   * preview e arma automaticamente quello successivo nell'ordine, cosi'
   * l'operatore deve solo premere GO in sequenza.
   */
  async function commitAndAdvance() {
    await goLive();
    const idx = show.cues.findIndex((c) => c.id === liveId);
    const next = idx >= 0 ? show.cues[idx + 1] : undefined;
    await selectPreview(next?.id ?? null);
  }

  /**
   * Sposta la preview di una posizione avanti (1) o indietro (-1) nell'ordine
   * dello show, senza mandare nulla in diretta. Usato dalle frecce.
   */
  function previewStep(direction: 1 | -1) {
    const cues = show.cues;
    if (cues.length === 0) return;
    const idx = cues.findIndex((c) => c.id === previewId);
    const nextIdx = idx === -1 ? (direction > 0 ? 0 : cues.length - 1) : Math.min(Math.max(idx + direction, 0), cues.length - 1);
    selectPreview(cues[nextIdx].id);
  }

  /**
   * Usato dalla barra spaziatrice: se non c'e' ancora nulla in preview, arma
   * il primo cue; altrimenti manda in diretta quello armato e arma il
   * successivo (come commitAndAdvance).
   */
  async function advanceOrArm() {
    if (!previewId) {
      if (show.cues.length > 0) await selectPreview(show.cues[0].id);
      return;
    }
    await commitAndAdvance();
  }

  async function updateTheme(next: Theme) {
    theme = next;
    await invoke("set_theme", { theme: next });
  }

  async function saveAs() {
    const path = await save({
      filters: FILE_FILTERS,
      defaultPath: `${show.title || "show"}.cuelith`,
    });
    if (!path) return;
    await invoke("save_show", { path });
    currentPath = path;
  }

  async function saveCurrent() {
    if (!currentPath) {
      await saveAs();
      return;
    }
    await invoke("save_show", { path: currentPath });
  }

  async function openFile() {
    const path = await open({ multiple: false, filters: FILE_FILTERS });
    if (typeof path !== "string") return;
    const file = await invoke<ShowFile>("load_show", { path });
    hydrate(file);
    currentPath = path;
  }

  async function newShow() {
    const file = await invoke<ShowFile>("new_show");
    hydrate(file);
    currentPath = null;
  }

  return {
    get show() {
      return show;
    },
    get theme() {
      return theme;
    },
    get previewId() {
      return previewId;
    },
    get liveId() {
      return liveId;
    },
    get currentPath() {
      return currentPath;
    },
    refresh,
    addSlide,
    addImage,
    removeCue,
    reorder,
    selectPreview,
    goLive,
    clearLive,
    commitAndAdvance,
    previewStep,
    advanceOrArm,
    updateTheme,
    saveAs,
    save: saveCurrent,
    openFile,
    newShow,
  };
}

export const showStore = createShowStore();
