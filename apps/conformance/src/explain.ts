/** I codici di errore dello schema in parole per chi scrive il plugin. */
const MEANINGS: Readonly<Record<string, string>> = {
  "protocol.pluginId.invalid":
    'the id must be a reverse-domain name in lowercase letters and digits, like "yourname.something"',
  "protocol.localId.invalid":
    "ids must be lowercase letters and digits (hyphens inside are allowed)",
  "protocol.messageKey.invalid":
    "a translation key is the plugin id plus dot-separated lowercase words, with no hyphens",
  "protocol.manifest.keyOutsideNamespace":
    "a translation key must start with the plugin id (for example acme.countdown.panel)",
  "protocol.manifest.versionInvalid": "the version must be SemVer, like 1.2.3",
  "protocol.semverRange.invalid": 'the range is not valid (for example ">=0.3.0 <1.0.0")',
  "protocol.manifest.permissionInvalid": "unknown permission, see the list in the Author guide",
  "protocol.manifest.duplicatePermission": "the same permission is listed twice",
  "protocol.manifest.pathOutside": "paths must be relative and stay inside the package",
  "protocol.manifest.iconSvg": "the icon must be an .svg file",
  "protocol.manifest.panelsNeedUi": 'panels need a "ui" entry in the manifest',
  "protocol.manifest.commandsNeedRuntime": 'commands need a runtime ("node" or "native")',
  "protocol.manifest.eventsNeedRuntime": 'events need a runtime ("node" or "native")',
  "protocol.manifest.localeNeedsLocales":
    'a language plugin must list its files in "contributes.locales"',
  "protocol.manifest.localeNeedsNoRuntime": 'a language plugin has "runtime": {"type": "none"}',
  "protocol.manifest.nativeNoBinary": "a native runtime needs at least one binary for a platform",
  "protocol.manifest.nativePermission": 'a native runtime must declare the "native" permission',
  "protocol.manifest.duplicateId": "two items have the same id",
  "protocol.manifest.selfDependency": "a plugin cannot depend on itself",
  "protocol.manifest.resourcesOrder": "in resources, the peak must be at least the idle value",
  "protocol.manifest.pointInvalid": 'an extension point looks like "plugin.id/name"',
  "protocol.manifest.serviceInvalid": 'a service looks like "service:name"',
  "protocol.manifest.panelNotDeclared": "the mode uses a panel that the plugin does not declare",
  "protocol.manifest.panelNotAvailable": "the mode uses a panel that is not available",
};

/** "campo: codice" diventa "campo: codice (spiegazione)" quando il codice e' noto. */
export function explain(code: string): string {
  const meaning = MEANINGS[code];
  return meaning === undefined ? code : `${code} (${meaning})`;
}
