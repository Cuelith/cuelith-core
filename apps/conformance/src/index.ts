import { statSync } from "node:fs";
import { resolve } from "node:path";
import { checkRuntime } from "./runtime.js";
import { checkFolder, checkPackageFile } from "./static.js";
import { Collector, type CheckOptions, type Report } from "./types.js";

export type { CheckOptions, Finding, Level, Report } from "./types.js";
export { formatReport } from "./format.js";

/** Controlla un plugin: un pacchetto .cpkg o la cartella gia' pronta. */
export async function checkPlugin(target: string, options: CheckOptions): Promise<Report> {
  const path = resolve(target);
  const out = new Collector();
  let dir = path;
  let manifest;
  if (statSync(path).isDirectory()) {
    manifest = await checkFolder(path, options, out);
  } else {
    ({ dir, manifest } = await checkPackageFile(path, options, out));
  }
  if (
    manifest !== undefined &&
    options.staticOnly !== true &&
    !out.findings.some((f) => f.level === "error")
  ) {
    await checkRuntime(dir, manifest, options, out);
  }
  return out.report(path, manifest?.id, manifest?.version);
}
