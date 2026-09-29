use std::sync::Mutex;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use super::show::{AppState, Cue, LivePayload, Show, Theme};

/// Uno show e il suo tema sono salvati e riaperti insieme: e' il payload di
/// trasferimento restituito al frontend dopo un'apertura/creazione, cosi'
/// puo' idratare il proprio stato in un solo giro invece di due chiamate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShowFile {
    pub show: Show,
    pub theme: Theme,
}

type Shared<'a> = State<'a, Mutex<AppState>>;

#[tauri::command]
pub fn save_show(state: Shared, path: String) -> Result<(), String> {
    let (show, theme) = {
        let mut app_state = state.lock().unwrap();
        app_state.current_path = Some(path.clone());
        (app_state.show.clone(), app_state.theme.clone())
    };
    write_file(&path, &show, &theme).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_show(app: AppHandle, state: Shared, path: String) -> Result<ShowFile, String> {
    let (show, theme) = read_file(&path).map_err(|e| e.to_string())?;
    {
        let mut app_state = state.lock().unwrap();
        app_state.show = show.clone();
        app_state.theme = theme.clone();
        app_state.live.live_index = None;
        app_state.live.preview_index = None;
        app_state.current_path = Some(path);
    }
    // Uno show appena aperto non deve ereditare cio' che era in diretta
    // prima: l'output torna vuoto finche' l'operatore non manda live un
    // nuovo cue.
    let _ = app.emit(
        "live-changed",
        LivePayload {
            cue: None,
            theme: theme.clone(),
        },
    );
    Ok(ShowFile { show, theme })
}

#[tauri::command]
pub fn new_show(app: AppHandle, state: Shared) -> ShowFile {
    let show = Show::default();
    let theme = Theme::default();
    {
        let mut app_state = state.lock().unwrap();
        app_state.show = show.clone();
        app_state.theme = theme.clone();
        app_state.live.live_index = None;
        app_state.live.preview_index = None;
        app_state.current_path = None;
    }
    let _ = app.emit(
        "live-changed",
        LivePayload {
            cue: None,
            theme: theme.clone(),
        },
    );
    ShowFile { show, theme }
}

fn write_file(path: &str, show: &Show, theme: &Theme) -> rusqlite::Result<()> {
    let mut conn = Connection::open(path)?;

    conn.execute_batch(
        "DROP TABLE IF EXISTS show_meta;
         DROP TABLE IF EXISTS cues;
         DROP TABLE IF EXISTS theme;
         CREATE TABLE show_meta (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL
         );
         CREATE TABLE cues (
            id TEXT PRIMARY KEY,
            position INTEGER NOT NULL,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            payload TEXT NOT NULL
         );
         CREATE TABLE theme (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            background_color TEXT NOT NULL,
            background_image TEXT,
            font_family TEXT NOT NULL,
            font_size INTEGER NOT NULL,
            font_color TEXT NOT NULL,
            text_align TEXT NOT NULL
         );",
    )?;

    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO show_meta (id, title) VALUES (?1, ?2)",
        rusqlite::params![show.id, show.title],
    )?;

    for (position, cue) in show.cues.iter().enumerate() {
        tx.execute(
            "INSERT INTO cues (id, position, kind, title, payload) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                cue.id,
                position as i64,
                cue.kind,
                cue.title,
                cue.payload.to_string()
            ],
        )?;
    }

    tx.execute(
        "INSERT INTO theme (id, background_color, background_image, font_family, font_size, font_color, text_align)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            theme.background_color,
            theme.background_image,
            theme.font_family,
            theme.font_size,
            theme.font_color,
            theme.text_align
        ],
    )?;
    tx.commit()?;

    Ok(())
}

fn read_file(path: &str) -> rusqlite::Result<(Show, Theme)> {
    let conn = Connection::open(path)?;

    let (id, title): (String, String) = conn.query_row(
        "SELECT id, title FROM show_meta LIMIT 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    let mut stmt =
        conn.prepare("SELECT id, kind, title, payload FROM cues ORDER BY position ASC")?;
    let cues = stmt
        .query_map([], |row| {
            let payload_text: String = row.get(3)?;
            Ok(Cue {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                payload: serde_json::from_str(&payload_text).unwrap_or(serde_json::Value::Null),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let theme = conn.query_row(
        "SELECT background_color, background_image, font_family, font_size, font_color, text_align
         FROM theme WHERE id = 1",
        [],
        |row| {
            Ok(Theme {
                background_color: row.get(0)?,
                background_image: row.get(1)?,
                font_family: row.get(2)?,
                font_size: row.get(3)?,
                font_color: row.get(4)?,
                text_align: row.get(5)?,
            })
        },
    )?;

    Ok((Show { id, title, cues }, theme))
}
