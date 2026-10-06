// Parti del motore usate dalla suite di conformita' dei plugin (apps/conformance):
// cosi' i controlli usano le stesse regole del motore, non una loro copia.
export { extractPackage, PACKAGE_LIMITS, safeEntryPath } from "./modules/package.js";
export { loadModule, ModuleLoadError, type LoadedModule } from "./modules/load.js";
