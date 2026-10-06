import type { Report } from "./types.js";

/** Testo leggibile per il terminale e per i log della CI. */
export function formatReport(report: Report): string {
  const lines = [
    `Plugin: ${report.pluginId ?? "(unknown)"} ${report.version ?? ""}`.trimEnd(),
    `Target: ${report.target}`,
    "",
  ];
  for (const check of report.checks) {
    const found = report.findings.filter((f) => f.id === check);
    const mark = found.some((f) => f.level === "error")
      ? "FAIL"
      : found.length > 0
        ? "WARN"
        : "ok  ";
    lines.push(`  ${mark}  ${check}`);
  }
  for (const f of report.findings) {
    lines.push(
      "",
      `${f.level.toUpperCase()} [${f.id}]${f.file === undefined ? "" : ` ${f.file}`}`,
      `  ${f.message}`,
    );
    if (f.fix !== undefined) lines.push(`  How to fix: ${f.fix}`);
  }
  const errors = report.findings.filter((f) => f.level === "error").length;
  const warnings = report.findings.length - errors;
  lines.push(
    "",
    report.ok
      ? `PASSED (${String(warnings)} warning(s))`
      : `FAILED (${String(errors)} error(s), ${String(warnings)} warning(s))`,
  );
  lines.push("Passing these checks is a technical test, not a guarantee of safety or quality.");
  return lines.join("\n");
}
