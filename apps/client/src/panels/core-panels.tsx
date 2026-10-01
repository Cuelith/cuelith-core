import type { ComponentType } from "react";
import { BackgroundsPanel } from "./BackgroundsPanel.js";
import { LibraryPanel } from "./LibraryPanel.js";
import { NotesPanel, OrderPanel, SectionsPanel, TransitionsPanel } from "./LivePanels.js";
import { PlaylistPanel } from "./PlaylistPanel.js";
import { PreviewPanel, ProgramPanel } from "./ScreenPanels.js";
import { SlidesPanel } from "./SlidesPanel.js";
import { StagePanel, TimerPanel } from "./StagePanels.js";

/** Pannelli del nucleo, per id qualificato. */
export const CORE_PANEL_COMPONENTS: Readonly<Record<string, ComponentType>> = {
  "core.playlist": PlaylistPanel,
  "core.library": LibraryPanel,
  "core.slides": SlidesPanel,
  "core.program": ProgramPanel,
  "core.preview": PreviewPanel,
  "core.sections": SectionsPanel,
  "core.order": OrderPanel,
  "core.timer": TimerPanel,
  "core.stage": StagePanel,
  "core.notes": NotesPanel,
  "core.transitions": TransitionsPanel,
  "core.backgrounds": BackgroundsPanel,
};
