mod files;
mod ops;
mod tour;

use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // must be first: a second launch focuses the running window instead
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        // the front end shows the window after its first paint, so don't restore visibility
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            files::data_read,
            files::data_write,
            files::data_rename,
            files::read_legacy,
            files::save_text,
            files::save_bytes,
            files::read_file,
            files::list_files,
            files::list_dir,
            files::apply_plan,
            files::undo_batch,
            files::cancel_apply,
            files::recover_all,
            files::forget_batch,
            files::stage_write,
            files::stage_clear,
            files::folders_exist,
            tour::tour_prepare,
            tour::tour_cleanup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vellova");
}
