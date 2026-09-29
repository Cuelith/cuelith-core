export type Cue = {
  id: string;
  kind: string;
  title: string;
  payload: Record<string, unknown>;
};

export type Show = {
  id: string;
  title: string;
  cues: Cue[];
};

export type Theme = {
  background_color: string;
  background_image: string | null;
  font_family: string;
  font_size: number;
  font_color: string;
  text_align: "left" | "center" | "right";
};

export const DEFAULT_THEME: Theme = {
  background_color: "#000000",
  background_image: null,
  font_family: "Inter, Avenir, Helvetica, Arial, sans-serif",
  font_size: 64,
  font_color: "#ffffff",
  text_align: "center",
};

export type LivePayload = {
  cue: Cue | null;
  theme: Theme;
};

export type MonitorInfo = {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string | null;
  license: string | null;
  min_host_version: string;
  max_host_version: string | null;
  kind: "service" | "panel";
  category: string[];
  permissions: string[];
  ui: { entry: string } | null;
  composer_button: { label: string } | null;
  settings: { entry: string } | null;
  onboarding: { title: string; body: string }[];
  docs: { entry: string } | null;
  logic: { wasm: string } | null;
};

export type PluginInfo = PluginManifest & {
  enabled: boolean;
  dir: string;
};
