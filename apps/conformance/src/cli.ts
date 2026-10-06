#!/usr/bin/env node
import { checkPlugin, formatReport } from "./index.js";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const target = args.find(
  (a, i) =>
    !a.startsWith("--") &&
    !(
      i > 0 &&
      args[i - 1]?.startsWith("--") &&
      ["--core", "--seconds"].includes(args[i - 1] ?? "")
    ),
);
if (target === undefined || args.includes("--help")) {
  console.error(
    "Usage: cuelith-conformance <plugin.cpkg | folder> [--core 0.3.1] [--static] [--seconds 3] [--json]",
  );
  process.exit(target === undefined ? 2 : 0);
}
const report = await checkPlugin(target, {
  coreVersion: flag("--core") ?? "0.3.1",
  staticOnly: args.includes("--static"),
  stableSeconds: Number(flag("--seconds") ?? 3),
});
console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : formatReport(report));
process.exit(report.ok ? 0 : 1);
