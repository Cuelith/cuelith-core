use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

use serde::{Deserialize, Serialize};

/// Un singolo elemento dentro uno Show. Il contenuto vero e proprio (testo,
/// immagine, versetto biblico, ecc.) e' opaco al core: viene prodotto e
/// interpretato dal plugin identificato da `kind`. Il core sa solo ordinarlo,
/// mostrarlo in preview/live e applicargli un tema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cue {
    pub id: String,
    /// Identifica il plugin che ha prodotto questo cue (es. "core.slide", "core.image").
    pub kind: String,
    pub title: String,
    /// Contenuto specifico del plugin, non interpretato dal core.
    pub payload: serde_json::Value,
}

/// Un contenitore ordinato di Cue: l'equivalente generico del "service" di
/// OpenLP, ma senza alcuna assunzione sul tipo di evento.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Show {
    pub id: String,
    pub title: String,
    pub cues: Vec<Cue>,
}

impl Show {
    pub fn new(title: impl Into<String>) -> Self {
        Self {
            id: new_id("show"),
            title: title.into(),
            cues: Vec::new(),
        }
    }
}

impl Default for Show {
    fn default() -> Self {
        Self::new("Nuovo show")
    }
}

/// Stato di cosa e' attualmente proiettato (live) e cosa si sta preparando
/// (preview), come indici dentro `Show::cues`.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct LiveState {
    pub live_index: Option<usize>,
    pub preview_index: Option<usize>,
}

/// Stile visivo applicato ai cue sulla finestra di output. Un solo Theme per
/// l'intero Show in questa fase; l'override per singolo cue arrivera' quando
/// servira' davvero.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Theme {
    pub background_color: String,
    pub background_image: Option<String>,
    pub font_family: String,
    pub font_size: u32,
    pub font_color: String,
    pub text_align: String,
}

impl Default for Theme {
    fn default() -> Self {
        Self {
            background_color: "#000000".into(),
            background_image: None,
            font_family: "Inter, Avenir, Helvetica, Arial, sans-serif".into(),
            font_size: 64,
            font_color: "#ffffff".into(),
            text_align: "center".into(),
        }
    }
}

/// Stato posseduto dal core (non duplicato tra le finestre): lo Show
/// corrente, il tema corrente, lo stato live/preview.
#[derive(Debug, Default)]
pub struct AppState {
    pub show: Show,
    pub theme: Theme,
    pub live: LiveState,
    /// Percorso del file .cuelith corrente, se lo show e' gia' stato
    /// salvato/aperto da disco in questa sessione.
    pub current_path: Option<String>,
}

/// Payload dell'evento `live-changed`, ricevuto dalla finestra di output (e
/// da chiunque altro sia interessato, es. un futuro stage display).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LivePayload {
    pub cue: Option<Cue>,
    pub theme: Theme,
}

type Shared<'a> = State<'a, Mutex<AppState>>;

#[tauri::command]
pub fn get_show(state: Shared) -> Show {
    state.lock().unwrap().show.clone()
}

#[tauri::command]
pub fn add_slide_cue(state: Shared, text: String) -> Cue {
    let cue = Cue {
        id: new_id("cue"),
        kind: "core.slide".into(),
        title: slide_title(&text),
        payload: serde_json::json!({ "text": text }),
    };
    let mut app_state = state.lock().unwrap();
    app_state.show.cues.push(cue.clone());
    cue
}

#[tauri::command]
pub fn add_image_cue(app: AppHandle, state: Shared, path: String) -> Result<Cue, String> {
    // Autorizza il protocollo asset a servire solo questo file, non l'intera
    // cartella: l'utente ha scelto esplicitamente questa immagine.
    use tauri::Manager;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())?;

    let file_name = std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Immagine")
        .to_string();

    let cue = Cue {
        id: new_id("cue"),
        kind: "core.image".into(),
        title: file_name,
        payload: serde_json::json!({ "path": path }),
    };
    let mut app_state = state.lock().unwrap();
    app_state.show.cues.push(cue.clone());
    Ok(cue)
}

#[tauri::command]
pub fn update_cue(state: Shared, id: String, payload: serde_json::Value) -> Result<Cue, String> {
    let mut app_state = state.lock().unwrap();
    let cue = app_state
        .show
        .cues
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("Cue {id} non trovato"))?;
    cue.payload = payload;
    Ok(cue.clone())
}

#[tauri::command]
pub fn remove_cue(state: Shared, id: String) {
    let mut app_state = state.lock().unwrap();
    app_state.show.cues.retain(|c| c.id != id);
    // Se il cue rimosso era in preview/live, lo stato viene invalidato per
    // evitare indici penzolanti.
    app_state.live.preview_index = None;
    app_state.live.live_index = None;
}

#[tauri::command]
pub fn reorder_cues(state: Shared, ids: Vec<String>) {
    let mut app_state = state.lock().unwrap();
    let mut reordered = Vec::with_capacity(ids.len());
    for id in &ids {
        if let Some(pos) = app_state.show.cues.iter().position(|c| &c.id == id) {
            reordered.push(app_state.show.cues.remove(pos));
        }
    }
    // Eventuali cue non elencati (non dovrebbe succedere) restano in coda.
    reordered.extend(app_state.show.cues.drain(..));
    app_state.show.cues = reordered;
    app_state.live.preview_index = None;
    app_state.live.live_index = None;
}

#[tauri::command]
pub fn set_preview(state: Shared, cue_id: Option<String>) {
    let mut app_state = state.lock().unwrap();
    app_state.live.preview_index = cue_id.and_then(|id| {
        app_state.show.cues.iter().position(|c| c.id == id)
    });
}

#[tauri::command]
pub fn go_live(app: AppHandle, state: Shared) -> Option<Cue> {
    let mut app_state = state.lock().unwrap();
    app_state.live.live_index = app_state.live.preview_index;
    let cue = app_state
        .live
        .live_index
        .and_then(|i| app_state.show.cues.get(i))
        .cloned();
    let theme = app_state.theme.clone();
    drop(app_state);

    let _ = app.emit(
        "live-changed",
        LivePayload {
            cue: cue.clone(),
            theme,
        },
    );
    cue
}

#[tauri::command]
pub fn clear_live(app: AppHandle, state: Shared) {
    let mut app_state = state.lock().unwrap();
    app_state.live.live_index = None;
    let theme = app_state.theme.clone();
    drop(app_state);

    let _ = app.emit("live-changed", LivePayload { cue: None, theme });
}

#[tauri::command]
pub fn get_theme(state: Shared) -> Theme {
    state.lock().unwrap().theme.clone()
}

#[tauri::command]
pub fn set_theme(app: AppHandle, state: Shared, theme: Theme) {
    let mut app_state = state.lock().unwrap();
    app_state.theme = theme.clone();
    let live_cue = app_state
        .live
        .live_index
        .and_then(|i| app_state.show.cues.get(i))
        .cloned();
    drop(app_state);

    // Se un cue e' gia' in diretta, ri-emette per applicargli subito il nuovo tema.
    let _ = app.emit("live-changed", LivePayload { cue: live_cue, theme });
}

fn new_id(prefix: &str) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{prefix}-{nanos:x}")
}

fn slide_title(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return "Slide vuota".into();
    }
    let first_line = trimmed.lines().next().unwrap_or(trimmed);
    if first_line.chars().count() > 40 {
        format!("{}…", first_line.chars().take(40).collect::<String>())
    } else {
        first_line.to_string()
    }
}
