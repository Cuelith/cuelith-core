import { LookSchema } from "@cuelith/protocol";
import { describe, expect, it } from "vitest";
import { CORE_LOOK_TEMPLATES, createDefaultLooks, isCoreLookTemplate } from "../src/index.js";

describe("look del nucleo", () => {
  const looks = createDefaultLooks({ room: "Sala", stage: "Palco" });

  it("sono look validi per il protocollo", () => {
    expect(LookSchema.safeParse(looks.room).success).toBe(true);
    expect(LookSchema.safeParse(looks.stage).success).toBe(true);
  });

  it("hanno uno stile valido per il loro template", () => {
    for (const look of [looks.room, looks.stage]) {
      expect(isCoreLookTemplate(look.template)).toBe(true);
      if (!isCoreLookTemplate(look.template)) continue;
      expect(CORE_LOOK_TEMPLATES[look.template].safeParse(look.style).success).toBe(true);
    }
  });

  it("il palco non mostra lo sfondo della sala", () => {
    expect(looks.stage.layers).not.toContain("background");
  });
});
