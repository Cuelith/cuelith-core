import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseInstallLang, readInstallLang } from "../src/installLang.js";

describe("lingua scelta nell'installatore", () => {
  it("accetta due lettere, con spazi e a capo, e scarta il resto", () => {
    expect(parseInstallLang("it")).toBe("it");
    expect(parseInstallLang(" EN\r\n")).toBe("en");
    expect(parseInstallLang("")).toBeUndefined();
    expect(parseInstallLang("italiano")).toBeUndefined();
    expect(parseInstallLang("../x")).toBeUndefined();
  });

  it("legge il file se c'e', altrimenti niente", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cuelith-lang-"));
    expect(readInstallLang(dir)).toBeUndefined();
    writeFileSync(path.join(dir, "install-lang.txt"), "en\n");
    expect(readInstallLang(dir)).toBe("en");
  });
});
