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
