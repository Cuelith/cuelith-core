import type { ComponentType } from "react";
import { PlaylistPanel } from "./PlaylistPanel.js";
import { PreviewPanel, ProgramPanel } from "./ScreenPanels.js";
import { SlidesPanel } from "./SlidesPanel.js";

/** Pannelli del nucleo, per id qualificato. */
export const CORE_PANEL_COMPONENTS: Readonly<Record<string, ComponentType>> = {
  "core.playlist": PlaylistPanel,
  "core.slides": SlidesPanel,
  "core.program": ProgramPanel,
  "core.preview": PreviewPanel,
};
