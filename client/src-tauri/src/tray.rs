use tauri::{
    AppHandle, Manager,
    menu::{Menu, MenuItemBuilder},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
};

pub fn init_tray(app: &AppHandle) -> tauri::Result<()> {
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let hide = MenuItemBuilder::with_id("hide", "Hide").build(app)?;
    let show = MenuItemBuilder::with_id("show", "Show").build(app)?;

    let menu = Menu::with_items(app, &[&quit, &hide, &show])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().expect("default window icon not set"))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            match event.id() {
                id if id == "quit" => app.exit(0),
                id if id == "hide" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
                id if id == "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, .. }) {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    #[cfg(target_os = "macos")]
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                        return;
                    }

                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
