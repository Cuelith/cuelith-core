use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const OUTPUT_WINDOW_LABEL: &str = "output";

#[derive(Debug, Serialize)]
pub struct MonitorInfo {
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Elenca i monitor disponibili, cosi' l'operatore puo' scegliere su quale
/// proiettare l'output (tipicamente il secondo schermo/proiettore).
#[tauri::command]
pub fn list_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let list = app.available_monitors().map_err(|e| e.to_string())?;

    Ok(list
        .iter()
        .enumerate()
        .map(|(i, m)| MonitorInfo {
            name: m
                .name()
                .cloned()
                .unwrap_or_else(|| format!("Schermo {}", i + 1)),
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
        })
        .collect())
}

/// Apre (o riusa se gia' aperta) la finestra di output: senza bordi, a
/// schermo intero, posizionata sul monitor scelto. E' la finestra che il
/// pubblico vede attraverso il proiettore.
#[tauri::command]
pub fn open_output_window(app: AppHandle, monitor_index: usize) -> Result<(), String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let monitor = monitors
        .get(monitor_index)
        .ok_or_else(|| format!("Monitor {monitor_index} non trovato"))?;

    if let Some(existing) = app.get_webview_window(OUTPUT_WINDOW_LABEL) {
        existing.set_position(*monitor.position()).map_err(|e| e.to_string())?;
        existing.set_fullscreen(true).map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let position = *monitor.position();
    let size = *monitor.size();

    // Stessa pagina della finestra principale: e' il componente Svelte a
    // decidere cosa mostrare in base all'etichetta della finestra corrente
    // (vedi src/routes/+page.svelte), evitando di dipendere dal fallback SPA
    // per un percorso dedicato.
    WebviewWindowBuilder::new(&app, OUTPUT_WINDOW_LABEL, WebviewUrl::App("/".into()))
        .title("Cuelith - Output")
        .decorations(false)
        .position(position.x as f64, position.y as f64)
        .inner_size(size.width as f64, size.height as f64)
        .fullscreen(true)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn close_output_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(OUTPUT_WINDOW_LABEL) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}
