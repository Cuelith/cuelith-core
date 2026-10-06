import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, relative, sep } from "node:path";
import {
  extractPackage,
  loadModule,
  ModuleLoadError,
  PACKAGE_LIMITS,
} from "@cuelith-core/engine/conformance";
import { PLUGIN_MANIFEST_FILE, type PluginManifest } from "@cuelith/protocol";
import { Collector, type CheckOptions } from "./types.js";

/** File di testo in cui cercare segreti e riferimenti esterni; i binari si saltano. */
const TEXT_EXT = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".html",
  ".css",
  ".txt",
  ".md",
  ".svg",
  ".yml",
  ".yaml",
  ".env",
]);

const SECRET_PATTERNS: readonly [string, RegExp][] = [
  ["a private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["an AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["a live payment key", /\b[sr]k_live_[A-Za-z0-9]{16,}\b/],
  ["an API token (JWT)", /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/],
];

/** File e cartelle che non devono finire in un pacchetto: [schema, descrizione, bloccante]. */
const JUNK: readonly [RegExp, string, boolean][] = [
  [/(^|\/)node_modules\//, "a node_modules folder (bundle the code instead)", true],
  [/(^|\/)\.git(\/|$)/, "the .git folder", true],
  [/(^|\/)\.env(\..*)?$/, "an .env file", true],
  [/\.(pem|key|p12|pfx)$/i, "a key or certificate file", true],
  [/(^|\/)(id_rsa|id_ed25519)$/, "an SSH key", true],
  [/\.(exe|dll|bat|cmd|ps1|sh|msi|scr)$/i, "an executable or script file", false],
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const posix = (root: string, file: string): string => relative(root, file).split(sep).join("/");

/**
 * Controlli sul contenuto di un plugin gia' estratto in `dir`. Non avviano nulla:
 * leggono solo i file. Restituisce il manifest se si e' potuto leggere.
 */
export async function checkFolder(
  dir: string,
  options: CheckOptions,
  out: Collector,
): Promise<PluginManifest | undefined> {
  const files = walk(dir);
  const names = files.map((file) => posix(dir, file));

  // --- manifest, intervalli di versione, cataloghi: le stesse regole del motore ---
  out.ran("manifest");
  out.ran("compat-range");
  let manifest: PluginManifest;
  try {
    manifest = (await loadModule(dir, options.coreVersion, false)).manifest;
  } catch (error) {
    if (error instanceof ModuleLoadError) {
      const detail = error.cause instanceof Error ? error.cause.message.slice(0, 600) : "";
      const incompatible =
        error.key === "core.module.engineIncompatible" ||
        error.key === "core.module.protocolIncompatible";
      out.add({
        id: incompatible ? "compat-range" : "manifest",
        level: "error",
        message: `The engine refuses to load this plugin (${error.key} ${JSON.stringify(error.params)}).${detail === "" ? "" : ` ${detail}`}`,
        fix: incompatible
          ? `Widen "engines" in ${PLUGIN_MANIFEST_FILE} so it includes Cuelith ${options.coreVersion}.`
          : `Fix ${PLUGIN_MANIFEST_FILE} (or the translation files) so they match the schema.`,
        file: PLUGIN_MANIFEST_FILE,
      });
    } else {
      out.add({
        id: "manifest",
        level: "error",
        message: `${PLUGIN_MANIFEST_FILE} cannot be read.`,
        file: PLUGIN_MANIFEST_FILE,
      });
    }
    return undefined;
  }

  // --- file dichiarati che devono esistere ---
  out.ran("declared-files");
  const declared: [string, string][] = [];
  if (manifest.runtime.type === "node") declared.push(["runtime.entry", manifest.runtime.entry]);
  if (manifest.runtime.type === "native") {
    for (const [platform, bin] of Object.entries(manifest.runtime.bin)) {
      declared.push([`runtime.bin.${platform}`, bin]);
    }
  }
  if (manifest.ui !== undefined) declared.push(["ui.entry", manifest.ui.entry]);
  if (manifest.icon !== undefined) declared.push(["icon", manifest.icon]);
  for (const extension of manifest.contributes.extensionPoints ?? []) {
    declared.push(["extensionPoints.schema", extension.schema]);
  }
  for (const [what, path] of declared) {
    if (!existsSync(join(dir, path))) {
      out.add({
        id: "declared-files",
        level: "error",
        message: `${what} points to "${path}", which is not in the package.`,
        fix: "Build before packaging, and include the file in the package.",
        file: path,
      });
    }
  }
  if (manifest.runtime.type === "node" && /\.tsx?$/.test(manifest.runtime.entry)) {
    out.add({
      id: "declared-files",
      level: "error",
      message: "runtime.entry is TypeScript: the engine runs plain JavaScript.",
      fix: "Compile to .js or .mjs and point to that.",
      file: manifest.runtime.entry,
    });
  }

  // --- coerenza di runtime e permessi ---
  out.ran("runtime-permissions");
  const permissions = manifest.permissions;
  if (manifest.runtime.type === "native" && !permissions.includes("native")) {
    out.add({
      id: "runtime-permissions",
      level: "error",
      message: 'A native runtime must declare the "native" permission.',
      fix: 'Add "native" to permissions.',
    });
  }
  if (manifest.runtime.type === "none" && permissions.length > 0) {
    out.add({
      id: "runtime-permissions",
      level: "warning",
      message: `A data-only plugin (runtime "none") declares permissions (${permissions.join(", ")}) that can never be used.`,
      fix: "Remove them.",
    });
  }
  const addons = names.filter((name) => name.endsWith(".node"));
  if (addons.length > 0 && !permissions.includes("addons")) {
    out.add({
      id: "runtime-permissions",
      level: "error",
      message: `The package contains native addons (${addons.join(", ")}) but does not declare "addons".`,
      fix: 'Declare "addons", or remove the addons.',
    });
  }

  // --- limiti del pacchetto ---
  out.ran("package-limits");
  const total = files.reduce((sum, file) => sum + statSync(file).size, 0);
  if (names.length > PACKAGE_LIMITS.maxFiles || total > PACKAGE_LIMITS.maxExtractedBytes) {
    out.add({
      id: "package-limits",
      level: "error",
      message: "The package is larger than the engine accepts.",
      fix: "Bundle the code and leave out what is not needed.",
    });
  } else if (total > 50 * 1024 ** 2) {
    out.add({
      id: "package-limits",
      level: "warning",
      message: `The package is ${String(Math.round(total / 1024 ** 2))} MB extracted: installing will be slow.`,
      fix: "Leave out unused files.",
    });
  }

  // --- file che non devono esserci e segreti ---
  out.ran("junk-files");
  out.ran("secrets");
  for (const [index, file] of files.entries()) {
    const name = names[index] ?? "";
    for (const [pattern, what, blocking] of JUNK) {
      if (pattern.test(name)) {
        out.add({
          id: "junk-files",
          level: blocking ? "error" : "warning",
          message: `The package contains ${what}.`,
          fix: "Leave it out of the package.",
          file: name,
        });
        break;
      }
    }
    if (!TEXT_EXT.has(extname(file).toLowerCase()) || statSync(file).size > 8 * 1024 ** 2) continue;
    const text = readFileSync(file, "utf8");
    for (const [what, pattern] of SECRET_PATTERNS) {
      if (pattern.test(text)) {
        out.add({
          id: "secrets",
          level: "error",
          message: `The file looks like it contains ${what}. Anyone who downloads the plugin can read it.`,
          fix: "Remove it from the package and replace (rotate) the secret.",
          file: name,
        });
      }
    }
  }

  // --- pannelli: la politica di sicurezza blocca tutto cio' che e' esterno ---
  out.ran("panel-assets");
  for (const [index, file] of files.entries()) {
    const name = names[index] ?? "";
    if (!/\.(html?|css)$/i.test(name)) continue;
    const text = readFileSync(file, "utf8");
    const external = [
      ...text.matchAll(/(?:src|href|url\(|@import)\s*[=(]?\s*["']?(?:https?:)?\/\/([^"'\s)>]+)/gi),
    ].filter((match) => !(match[1] ?? "").startsWith("www.w3.org/"));
    if (external.length > 0) {
      out.add({
        id: "panel-assets",
        level: "error",
        message: `The page loads "//${external[0]?.[1] ?? ""}" from the internet: panels run with a strict policy (only files from the package are allowed), so it will be blocked.`,
        fix: "Put the file (script, font, image, stylesheet) inside the package and use a relative path.",
        file: name,
      });
    }
    if (/\.html?$/i.test(name)) {
      if (/<script(?![^>]*\bsrc=)[^>]*>\s*\S[\s\S]*?<\/script>/i.test(text)) {
        out.add({
          id: "panel-assets",
          level: "error",
          message:
            "The page has an inline <script>: the policy only allows scripts loaded from files in the package.",
          fix: 'Move the code to a .js file and use <script src="...">.',
          file: name,
        });
      }
      if (/\son[a-z]+\s*=\s*["']/i.test(text)) {
        out.add({
          id: "panel-assets",
          level: "error",
          message: "The page uses inline event handlers (onclick=...): the policy blocks them.",
          fix: "Attach events from your .js file with addEventListener.",
          file: name,
        });
      }
    }
  }

  // --- euristiche sul codice del processo: avvisi, la prova vera e' a runtime ---
  out.ran("code-permissions");
  out.ran("stdout-protocol");
  if (manifest.runtime.type === "node") {
    const entry = join(dir, manifest.runtime.entry);
    if (existsSync(entry) && statSync(entry).size < 8 * 1024 ** 2) {
      const code = readFileSync(entry, "utf8");
      const has = (permission: string): boolean =>
        permissions.some((p) => p === permission || p.startsWith(`${permission}:`));
      const wants: [RegExp, string, string][] = [
        [
          /(?:require\(\s*|from\s*|import\(\s*)["'](?:node:)?child_process["']/,
          "process",
          "starts other programs",
        ],
        [
          /(?:require\(\s*|from\s*|import\(\s*)["'](?:node:)?(?:https?|net|tls|dgram|http2)["']|\bfetch\(\s*["'`]https?:/,
          "network",
          "uses the network",
        ],
        [/(?:require\(\s*|from\s*|import\(\s*)["']serialport["']/, "serial", "uses serial ports"],
      ];
      for (const [pattern, permission, what] of wants) {
        if (pattern.test(code) && !has(permission)) {
          out.add({
            id: "code-permissions",
            level: "warning",
            message: `The process code seems to need "${permission}" (it ${what}) but the manifest does not declare it. The engine will block it at run time.`,
            fix: `Declare "${permission}" if it is really needed, otherwise remove that code.`,
            file: manifest.runtime.entry,
          });
        }
      }
      if (/\bconsole\.log\s*\(/.test(code)) {
        out.add({
          id: "stdout-protocol",
          level: "warning",
          message:
            "The code uses console.log. Stdout carries the protocol between plugin and engine: stray lines are ignored, but a half line can corrupt a message.",
          fix: "Log with console.error (stderr) instead.",
          file: manifest.runtime.entry,
        });
      }
    }
  }
  return manifest;
}

/** Un pacchetto .cpkg: lo estrae in una cartella temporanea e poi controlla la cartella. */
export async function checkPackageFile(
  file: string,
  options: CheckOptions,
  out: Collector,
): Promise<{ dir: string; manifest: PluginManifest | undefined }> {
  const dir = mkdtempSync(join(tmpdir(), "cuelith-conformance-"));
  out.ran("package-readable");
  try {
    await extractPackage(new Uint8Array(readFileSync(file)), dir);
  } catch (error) {
    const data =
      error instanceof Error && "data" in error
        ? JSON.stringify((error as { data?: unknown }).data)
        : "";
    out.add({
      id: "package-readable",
      level: "error",
      message: `The package cannot be opened (${error instanceof Error ? error.message : "unreadable"} ${data}). It must be a zip with ${PLUGIN_MANIFEST_FILE} at the root, safe paths and a sane size.`,
      fix: "Rebuild the package from the plugin folder: files must sit at the root of the zip, not inside a subfolder.",
    });
    return { dir, manifest: undefined };
  }
  const manifest = await checkFolder(dir, options, out);
  if (manifest !== undefined) {
    out.ran("package-name");
    const expected = `${manifest.id}-${manifest.version}.cpkg`;
    if (basename(file) !== expected) {
      out.add({
        id: "package-name",
        level: "warning",
        message: `The file is called "${basename(file)}"; the convention is "${expected}".`,
        fix: "Rename it, so users and the catalogue recognise it.",
      });
    }
  }
  return { dir, manifest };
}
