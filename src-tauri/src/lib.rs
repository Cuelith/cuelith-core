mod core;

use std::sync::Mutex;

use core::display::{close_output_window, list_monitors, open_output_window};
use core::show::{
    add_image_cue, add_slide_cue, clear_live, get_show, get_theme, go_live, remove_cue,
    reorder_cues, set_preview, set_theme, update_cue, AppState,
};
use core::plugins::{
    install_plugin, list_plugins, plugin_invoke, set_plugin_enabled, uninstall_plugin,
};
use core::storage::{load_show, new_show, save_show};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(AppState::default()))
        .invoke_handler(tauri::generate_handler![
            list_monitors,
            open_output_window,
            close_output_window,
            get_show,
            add_slide_cue,
            add_image_cue,
            update_cue,
            remove_cue,
            reorder_cues,
            set_preview,
            go_live,
            clear_live,
            get_theme,
            set_theme,
            save_show,
            load_show,
            new_show,
            list_plugins,
            install_plugin,
            uninstall_plugin,
            set_plugin_enabled,
            plugin_invoke,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
