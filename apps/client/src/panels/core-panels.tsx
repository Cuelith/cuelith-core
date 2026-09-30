import type { ComponentType } from "react";
import { LibraryPanel } from "./LibraryPanel.js";
import { PlaylistPanel } from "./PlaylistPanel.js";
import { PreviewPanel, ProgramPanel } from "./ScreenPanels.js";
import { SlidesPanel } from "./SlidesPanel.js";

/** Pannelli del nucleo, per id qualificato. */
export const CORE_PANEL_COMPONENTS: Readonly<Record<string, ComponentType>> = {
  "core.playlist": PlaylistPanel,
  "core.library": LibraryPanel,
  "core.slides": SlidesPanel,
  "core.program": ProgramPanel,
  "core.preview": PreviewPanel,
};
