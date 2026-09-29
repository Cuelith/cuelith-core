use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use super::show::{new_id, AppState, Cue};

/// Descrive cosa un plugin contribuisce alla shell. Rispecchia
/// `docs/plugin-manifest-spec.md`: campi non ancora usati dal codice (es.
/// `logic`, `settings`, `docs`) sono comunque letti e conservati, cosi' il
/// formato non deve cambiare quando verranno implementati.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    pub min_host_version: String,
    #[serde(default)]
    pub max_host_version: Option<String>,
    /// "service" (gira in background, nessun pannello) o "panel" (contribuisce
    /// un pulsante + pannello alla barra contenuti).
    pub kind: String,
    #[serde(default)]
    pub category: Vec<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub ui: Option<UiEntry>,
    #[serde(default)]
    pub composer_button: Option<ComposerButton>,
    #[serde(default)]
    pub settings: Option<UiEntry>,
    #[serde(default)]
    pub onboarding: Vec<OnboardingStep>,
    #[serde(default)]
    pub docs: Option<UiEntry>,
    #[serde(default)]
    pub logic: Option<LogicEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiEntry {
    pub entry: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComposerButton {
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnboardingStep {
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogicEntry {
    pub wasm: String,
}

/// Cio' che il frontend riceve per ogni plugin installato: il manifest, se e'
/// abilitato, e la cartella assoluta dove vive (il frontend costruisce da
/// solo l'URL per l'iframe con `convertFileSrc`, stesso pattern delle
/// immagini nei cue).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    #[serde(flatten)]
    pub manifest: PluginManifest,
    pub enabled: bool,
    pub dir: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct PluginsState {
    #[serde(default)]
    enabled: HashMap<String, bool>,
}

fn plugins_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugins");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    Ok(base.join("plugins-state.json"))
}

fn load_state(app: &AppHandle) -> Result<PluginsState, String> {
    let path = state_path(app)?;
    if !path.exists() {
        return Ok(PluginsState::default());
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

fn save_state(app: &AppHandle, state: &PluginsState) -> Result<(), String> {
    let path = state_path(app)?;
    let text = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())
}

fn read_manifest(plugin_dir: &Path) -> Result<PluginManifest, String> {
    let text = fs::read_to_string(plugin_dir.join("manifest.json"))
        .map_err(|e| format!("manifest.json non leggibile: {e}"))?;
    let manifest: PluginManifest =
        serde_json::from_str(&text).map_err(|e| format!("manifest.json non valido: {e}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

fn validate_manifest(manifest: &PluginManifest) -> Result<(), String> {
    if manifest.ui.is_none() && manifest.logic.is_none() {
        return Err("il manifest deve avere almeno uno tra \"ui\" e \"logic\"".into());
    }
    check_host_compatible(manifest)
}

fn check_host_compatible(manifest: &PluginManifest) -> Result<(), String> {
    let host = semver::Version::parse(env!("CARGO_PKG_VERSION")).map_err(|e| e.to_string())?;
    let min = semver::Version::parse(&manifest.min_host_version)
        .map_err(|_| format!("min_host_version \"{}\" non valida", manifest.min_host_version))?;
    if host < min {
        return Err(format!(
            "richiede Cuelith {} o superiore (qui: {})",
            manifest.min_host_version, host
        ));
    }
    Ok(())
}

fn set_asset_scope(app: &AppHandle, plugin_dir: &Path, allow: bool) -> Result<(), String> {
    let scope = app.asset_protocol_scope();
    if allow {
        scope.allow_directory(plugin_dir, true).map_err(|e| e.to_string())
    } else {
        scope.forbid_directory(plugin_dir, true).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn list_plugins(app: AppHandle) -> Result<Vec<PluginInfo>, String> {
    let dir = plugins_dir(&app)?;
    let state = load_state(&app)?;
    let mut result = Vec::new();

    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.path().is_dir() {
            continue;
        }
        // Una cartella con un manifest.json mancante/corrotto viene ignorata
        // silenziosamente invece di far fallire l'intero elenco.
        let Ok(manifest) = read_manifest(&entry.path()) else {
            continue;
        };
        let enabled = state.enabled.get(&manifest.id).copied().unwrap_or(true);
        result.push(PluginInfo {
            dir: entry.path().to_string_lossy().to_string(),
            enabled,
            manifest,
        });
    }

    Ok(result)
}

#[tauri::command]
pub fn install_plugin(app: AppHandle, path: String) -> Result<PluginInfo, String> {
    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    let manifest = {
        let mut manifest_file = archive
            .by_name("manifest.json")
            .map_err(|_| "lo zip non contiene un manifest.json nella radice".to_string())?;
        let mut text = String::new();
        manifest_file
            .read_to_string(&mut text)
            .map_err(|e| e.to_string())?;
        let manifest: PluginManifest =
            serde_json::from_str(&text).map_err(|e| format!("manifest.json non valido: {e}"))?;
        manifest
    };
    validate_manifest(&manifest)?;

    let target_dir = plugins_dir(&app)?.join(&manifest.id);
    if target_dir.exists() {
        fs::remove_dir_all(&target_dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    archive.extract(&target_dir).map_err(|e| e.to_string())?;

    let mut state = load_state(&app)?;
    state.enabled.insert(manifest.id.clone(), true);
    save_state(&app, &state)?;

    if manifest.ui.is_some() {
        set_asset_scope(&app, &target_dir, true)?;
    }

    Ok(PluginInfo {
        dir: target_dir.to_string_lossy().to_string(),
        enabled: true,
        manifest,
    })
}

#[tauri::command]
pub fn uninstall_plugin(app: AppHandle, id: String) -> Result<(), String> {
    let target_dir = plugins_dir(&app)?.join(&id);
    if target_dir.exists() {
        let _ = set_asset_scope(&app, &target_dir, false);
        fs::remove_dir_all(&target_dir).map_err(|e| e.to_string())?;
    }
    let mut state = load_state(&app)?;
    state.enabled.remove(&id);
    save_state(&app, &state)?;
    Ok(())
}

#[tauri::command]
pub fn set_plugin_enabled(app: AppHandle, id: String, enabled: bool) -> Result<(), String> {
    let mut state = load_state(&app)?;
    state.enabled.insert(id.clone(), enabled);
    save_state(&app, &state)?;

    let target_dir = plugins_dir(&app)?.join(&id);
    if let Ok(manifest) = read_manifest(&target_dir) {
        if manifest.ui.is_some() {
            set_asset_scope(&app, &target_dir, enabled)?;
        }
    }
    Ok(())
}

/// Unico varco che un plugin ha verso il core: ogni azione e' controllata
/// contro i permessi dichiarati nel SUO manifest (letto da disco, non da cio'
/// che il pannello sostiene di essere) prima di essere eseguita. Il bridge
/// JS (`plugin-bridge.ts`) parla solo questo protocollo, mai i comandi
/// interni dell'app 1:1.
#[tauri::command]
pub fn plugin_invoke(
    app: AppHandle,
    state: State<Mutex<AppState>>,
    plugin_id: String,
    action: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let plugin_dir = plugins_dir(&app)?.join(&plugin_id);
    let manifest =
        read_manifest(&plugin_dir).map_err(|_| "plugin non installato o non valido".to_string())?;

    let required_permission = match action.as_str() {
        "add-cue" => "show.write",
        "get-show" => "show.read",
        "get-theme" => "show.read",
        other => return Err(format!("azione sconosciuta: {other}")),
    };
    if !manifest
        .permissions
        .iter()
        .any(|p| p == required_permission)
    {
        return Err(format!(
            "il plugin \"{}\" non ha dichiarato il permesso \"{}\"",
            manifest.name, required_permission
        ));
    }

    match action.as_str() {
        "add-cue" => {
            #[derive(Deserialize)]
            struct AddCuePayload {
                kind: String,
                title: String,
                payload: serde_json::Value,
            }
            let p: AddCuePayload = serde_json::from_value(payload).map_err(|e| e.to_string())?;
            let cue = Cue {
                id: new_id("cue"),
                kind: p.kind,
                title: p.title,
                payload: p.payload,
            };
            let mut app_state = state.lock().unwrap();
            app_state.show.cues.push(cue.clone());
            serde_json::to_value(cue).map_err(|e| e.to_string())
        }
        "get-show" => {
            let app_state = state.lock().unwrap();
            serde_json::to_value(&app_state.show).map_err(|e| e.to_string())
        }
        "get-theme" => {
            let app_state = state.lock().unwrap();
            serde_json::to_value(&app_state.theme).map_err(|e| e.to_string())
        }
        _ => unreachable!(),
    }
}
