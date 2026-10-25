mod cos;
mod drawing;
mod recognition;
mod sync;
mod vault;
use cos::{CosClient, CosConfig};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

struct AppState {
    root: Mutex<Option<PathBuf>>,
    selection: Arc<Mutex<Option<PathBuf>>>,
    config_dir: PathBuf,
    watcher: Mutex<Option<RecommendedWatcher>>,
    sync_gate: Arc<Mutex<()>>,
    device: String,
    frontend_ready: AtomicBool,
    exit_allowed: AtomicBool,
}
fn root(state: &AppState) -> Result<PathBuf, String> {
    state
        .root
        .lock()
        .map_err(vault::err)?
        .clone()
        .ok_or("请先选择本地笔记库".into())
}
fn config_path(state: &AppState) -> Result<PathBuf, String> {
    let path = root(state)?;
    Ok(state.config_dir.join("connections").join(format!(
        "{}.json",
        vault::hash(path.to_string_lossy().as_bytes())
    )))
}
fn config(state: &AppState) -> Result<Option<CosConfig>, String> {
    if state.root.lock().map_err(vault::err)?.is_none() {
        return Ok(None);
    }
    let p = config_path(state)?;
    if !p.exists() {
        return Ok(None);
    }
    serde_json::from_slice(&fs::read(p).map_err(vault::err)?)
        .map(Some)
        .map_err(vault::err)
}
fn watch(app: &tauri::AppHandle, state: &AppState, path: &std::path::Path) -> Result<(), String> {
    let handle = app.clone();
    let watched = path.to_path_buf();
    let mut watcher =
        notify::recommended_watcher(move |result: notify::Result<notify::Event>| match result {
            Ok(event) => {
                if event.kind.is_access() {
                    return;
                }
                if event.paths.iter().any(|p| {
                    p.strip_prefix(&watched).ok().is_some_and(|r| {
                        !r.components()
                            .any(|c| c.as_os_str().to_string_lossy().starts_with('.'))
                    })
                }) {
                    let _ = handle.emit("vault-changed", ());
                }
            }
            Err(_) => {
                let _ = handle.emit("vault-watch-error", "文件监视暂不可用，可手动刷新笔记库");
            }
        })
        .map_err(vault::err)?;
    watcher
        .watch(path, RecursiveMode::Recursive)
        .map_err(vault::err)?;
    *state.watcher.lock().map_err(vault::err)? = Some(watcher);
    Ok(())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Bootstrap {
    vault_path: Option<String>,
    entries: Vec<vault::Entry>,
    connection: Option<CosConfig>,
    secret_stored: bool,
    device: String,
}
#[tauri::command]
fn bootstrap(state: State<'_, AppState>) -> Result<Bootstrap, String> {
    let path = state.root.lock().map_err(vault::err)?.clone();
    let cfg = config(&state)?;
    let secret_stored = cfg.as_ref().is_some_and(|c| c.get_secret().is_ok());
    Ok(Bootstrap {
        vault_path: path.as_ref().map(|p| p.to_string_lossy().to_string()),
        entries: path
            .as_ref()
            .map(|p| vault::entries(p))
            .transpose()?
            .unwrap_or_default(),
        connection: cfg,
        secret_stored,
        device: state.device.clone(),
    })
}
#[tauri::command]
async fn choose_vault(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let selection = state.selection.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let picked = app
            .dialog()
            .file()
            .set_title("选择本地笔记库文件夹")
            .blocking_pick_folder();
        let Some(picked) = picked else {
            return Ok(None);
        };
        let path = picked
            .into_path()
            .map_err(vault::err)?
            .canonicalize()
            .map_err(vault::err)?;
        *selection.lock().map_err(vault::err)? = Some(path.clone());
        Ok(Some(path.to_string_lossy().to_string()))
    })
    .await
    .map_err(vault::err)?
}
#[tauri::command]
fn open_vault(
    path: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<vault::Entry>, String> {
    let _guard = state
        .sync_gate
        .try_lock()
        .map_err(|_| "同步期间不能切换笔记库")?;
    let p = PathBuf::from(path).canonicalize().map_err(vault::err)?;
    if state.selection.lock().map_err(vault::err)?.take().as_ref() != Some(&p) {
        return Err("请通过系统文件夹选择器打开笔记库".into());
    }
    if !p.is_dir() {
        return Err("请选择文件夹".into());
    }
    let entries = vault::entries(&p)?;
    fs::create_dir_all(vault::metadata(&p, "")?).map_err(vault::err)?;
    watch(&app, &state, &p)?;
    vault::atomic_write(
        &state.config_dir.join("vault.json"),
        &serde_json::to_vec(&p.to_string_lossy()).map_err(vault::err)?,
    )?;
    *state.root.lock().map_err(vault::err)? = Some(p);
    Ok(entries)
}
#[tauri::command]
fn close_vault(state: State<'_, AppState>) -> Result<(), String> {
    let _guard = state
        .sync_gate
        .try_lock()
        .map_err(|_| "同步期间不能关闭笔记库")?;
    *state.watcher.lock().map_err(vault::err)? = None;
    *state.root.lock().map_err(vault::err)? = None;
    *state.selection.lock().map_err(vault::err)? = None;
    let p = state.config_dir.join("vault.json");
    if p.exists() {
        fs::remove_file(p).map_err(vault::err)?;
    }
    Ok(())
}
#[tauri::command]
async fn list_entries(
    query: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<vault::Entry>, String> {
    let p = root(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut entries = vault::entries(&p)?;
        if let Some(q) = query.filter(|s| !s.trim().is_empty()) {
            let q = q.to_lowercase();
            entries.retain(|e| {
                e.name.to_lowercase().contains(&q)
                    || (e.kind != "folder"
                        && vault::read(&p, &e.path)
                            .is_ok_and(|n| n.content.to_lowercase().contains(&q)))
            });
        }
        Ok(entries)
    })
    .await
    .map_err(vault::err)?
}
#[tauri::command]
async fn read_note(path: String, state: State<'_, AppState>) -> Result<vault::NoteRecord, String> {
    let p = root(&state)?;
    tauri::async_runtime::spawn_blocking(move || vault::read(&p, &path))
        .await
        .map_err(vault::err)?
}
#[tauri::command]
async fn write_note(
    path: String,
    content: String,
    expected_hash: String,
    state: State<'_, AppState>,
) -> Result<vault::NoteRecord, String> {
    let p = root(&state)?;
    tauri::async_runtime::spawn_blocking(move || vault::write(&p, &path, &content, &expected_hash))
        .await
        .map_err(vault::err)?
}
#[tauri::command]
fn create_entry(
    dir: String,
    name: String,
    format: String,
    content: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    vault::create(&root(&state)?, &dir, &name, &format, content.as_deref())
}
#[tauri::command]
fn relocate_entry(
    path: String,
    destination: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    vault::relocate(&root(&state)?, &path, &destination)
}
#[tauri::command]
fn trash_entry(path: String, state: State<'_, AppState>) -> Result<(), String> {
    vault::trash(&root(&state)?, &path)
}
#[tauri::command]
fn list_trash(state: State<'_, AppState>) -> Result<Vec<vault::TrashEntry>, String> {
    vault::list_trash(&root(&state)?)
}
#[tauri::command]
fn restore_trash(id: String, state: State<'_, AppState>) -> Result<(), String> {
    vault::restore(&root(&state)?, &id)
}
#[tauri::command]
fn save_connection(
    connection: CosConfig,
    secret: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = config_path(&state)?;
    connection.validate()?;
    if let Some(s) = secret.filter(|s| !s.is_empty()) {
        connection.set_secret(&s)?;
    } else {
        connection.get_secret()?;
    }
    vault::atomic_write(&path, &serde_json::to_vec(&connection).map_err(vault::err)?)
}
#[tauri::command]
fn forget_connection(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(c) = config(&state)? {
        c.forget_secret()?;
    }
    let p = config_path(&state)?;
    if p.exists() {
        fs::remove_file(p).map_err(vault::err)?;
    }
    Ok(())
}
#[tauri::command]
async fn test_connection(state: State<'_, AppState>) -> Result<usize, String> {
    let cfg = config(&state)?.ok_or("请先保存同步设置")?;
    tauri::async_runtime::spawn_blocking(move || CosClient::new(cfg)?.list().map(|v| v.len()))
        .await
        .map_err(vault::err)?
}
#[tauri::command]
async fn sync_vault(state: State<'_, AppState>) -> Result<sync::SyncReport, String> {
    let p = root(&state)?;
    let cfg = config(&state)?.ok_or("请先配置 COS 同步")?;
    let gate = state.sync_gate.clone();
    let device = state.device.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate.try_lock().map_err(|_| "同步正在进行")?;
        let client = CosClient::new(cfg.clone())?;
        sync::run(&p, &client, &cfg.profile(), &device)
    })
    .await
    .map_err(vault::err)?
}
#[tauri::command]
fn reveal_vault(state: State<'_, AppState>) -> Result<(), String> {
    let p = root(&state)?;
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(p).spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer").arg(p).spawn();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let result = std::process::Command::new("xdg-open").arg(p).spawn();
    result.map(|_| ()).map_err(vault::err)
}
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(vault::err)?;
    if !["https", "http"].contains(&parsed.scheme()) {
        return Err("仅可打开 http/https 链接".into());
    }
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open")
        .arg("--")
        .arg(parsed.as_str())
        .spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32")
        .arg("url.dll,FileProtocolHandler")
        .arg(parsed.as_str())
        .spawn();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let result = std::process::Command::new("xdg-open")
        .arg(parsed.as_str())
        .spawn();
    result.map(|_| ()).map_err(vault::err)
}
#[tauri::command]
fn frontend_ready(state: State<'_, AppState>) {
    state.frontend_ready.store(true, Ordering::SeqCst);
}
#[tauri::command]
fn confirm_exit(app: tauri::AppHandle, state: State<'_, AppState>) {
    if app.get_webview_window("drawing").is_some() {
        let _ = app.emit_to("drawing", "drawing-close-request", true);
        if let Some(w) = app.get_webview_window("drawing") {
            let _ = w.set_focus();
        }
        return;
    }
    state.exit_allowed.store(true, Ordering::SeqCst);
    app.exit(0);
}
fn desktop_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem as Native, Submenu};
    let quit = MenuItem::with_id(
        app,
        "save-and-quit",
        if drawing_standalone(app) {
            "退出 Mathdraw"
        } else {
            "退出 Mindgrove"
        },
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    let close = MenuItem::with_id(app, "save-and-close", "关闭窗口", true, Some("CmdOrCtrl+W"))?;
    let standalone=drawing_standalone(app);
    let new_drawing=MenuItem::with_id(app,"drawing-new","新建绘图",true,if standalone {Some("CmdOrCtrl+N")}else{None})?;
    let open_drawing=MenuItem::with_id(app,"drawing-open","打开绘图…",true,if standalone {Some("CmdOrCtrl+O")}else{None})?;
    let save_drawing=MenuItem::with_id(app,"drawing-save","保存绘图",true,if standalone {Some("CmdOrCtrl+S")}else{None})?;
    let save_as=MenuItem::with_id(app,"drawing-save-as","绘图另存为…",true,if standalone {Some("CmdOrCtrl+Shift+S")}else{None})?;
    if drawing_standalone(app) {
        return Menu::with_items(
            app,
            &[
                #[cfg(target_os = "macos")]
                &Submenu::with_items(
                    app,
                    "Mathdraw",
                    true,
                    &[
                        &Native::about(app, None, None)?,
                        &Native::separator(app)?,
                        &Native::services(app, None)?,
                        &Native::hide(app, None)?,
                        &Native::hide_others(app, None)?,
                        &Native::separator(app)?,
                        &quit,
                    ],
                )?,
                &Submenu::with_items(
                    app,
                    "文件",
                    true,
                    &[
                        &new_drawing,&open_drawing,&save_drawing,&save_as,&Native::separator(app)?,
                        &MenuItem::with_id(app,"drawing-check-update","检查更新…",true,None::<&str>)?,
                        &close,
                        #[cfg(not(target_os = "macos"))]
                        &quit,
                    ],
                )?,
                &Submenu::with_items(
                    app,
                    "编辑",
                    true,
                    &[
                        &Native::undo(app, None)?,
                        &Native::redo(app, None)?,
                        &Native::separator(app)?,
                        &Native::cut(app, None)?,
                        &Native::copy(app, None)?,
                        &Native::paste(app, None)?,
                        &Native::select_all(app, None)?,
                    ],
                )?,
            ],
        );
    }
    Menu::with_items(
        app,
        &[
            #[cfg(target_os = "macos")]
            &Submenu::with_items(
                app,
                "Mindgrove",
                true,
                &[
                    &Native::about(app, None, None)?,
                    &Native::separator(app)?,
                    &Native::services(app, None)?,
                    &Native::hide(app, None)?,
                    &Native::hide_others(app, None)?,
                    &Native::separator(app)?,
                    &quit,
                ],
            )?,
            &Submenu::with_items(
                app,
                "文件",
                true,
                &[
                    &new_drawing,&open_drawing,&save_drawing,&save_as,&Native::separator(app)?,
                    &close,
                    #[cfg(not(target_os = "macos"))]
                    &quit,
                ],
            )?,
            &Submenu::with_items(
                app,
                "编辑",
                true,
                &[
                    &Native::undo(app, None)?,
                    &Native::redo(app, None)?,
                    &Native::separator(app)?,
                    &Native::cut(app, None)?,
                    &Native::copy(app, None)?,
                    &Native::paste(app, None)?,
                    &Native::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "视图",
                true,
                &[
                    &MenuItem::with_id(
                        app,
                        "toggle-sidebar",
                        "显示/隐藏目录侧栏",
                        true,
                        None::<&str>,
                    )?,
                    &MenuItem::with_id(
                        app,
                        "toggle-list",
                        "显示/隐藏笔记列表",
                        true,
                        None::<&str>,
                    )?,
                    &Native::separator(app)?,
                    &MenuItem::with_id(
                        app,
                        "restore-layout",
                        "恢复默认布局",
                        true,
                        Some("CmdOrCtrl+Shift+0"),
                    )?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "工具",
                true,
                &[&MenuItem::with_id(
                    app,
                    "math-drawing",
                    "数学绘图",
                    true,
                    Some("CmdOrCtrl+Shift+D"),
                )?],
            )?,
        ],
    )
}
fn drawing_standalone(app: &tauri::AppHandle) -> bool {
    app.config().identifier == "lab.chuan.mathdraw"
}
#[tauri::command]
async fn drawing_check_update(webview:tauri::Webview,source:String)->Result<Option<serde_json::Value>,String>{
    use tauri_plugin_updater::UpdaterExt;
    if webview.label()!="drawing" {return Err("仅绘图窗口可检查更新".into());}
    // Each source gets its own timeout. No arbitrary endpoints or credentials
    // from the frontend; package signatures remain enforced by the updater.
    let (endpoint,seconds)=match source.as_str(){
        "gitee"=>("https://gitee.com/liu_chuanning/mathdraw/raw/master/latest.json",4),
        "github"=>("https://github.com/DrChuan/Mathdraw/releases/latest/download/latest.json",8),
        _=>return Err("更新来源无效".into()),
    };
    let updater=webview.updater_builder().endpoints(vec![endpoint.parse().map_err(|e|format!("{e}"))?])
        .map_err(|e|e.to_string())?.timeout(std::time::Duration::from_secs(seconds)).build().map_err(|e|e.to_string())?;
    let update=updater.check().await.map_err(|e|e.to_string())?;
    Ok(update.map(|update|{
        let metadata=serde_json::json!({"currentVersion":update.current_version,"version":update.version,"body":update.body,"rawJson":update.raw_json});
        let rid=webview.resources_table().add(update);
        let mut metadata=metadata;metadata["rid"]=rid.into();metadata
    }))
}
#[tauri::command]
fn drawing_update_restart(app:tauri::AppHandle,window:tauri::WebviewWindow)->Result<(),String>{
    if window.label()!="drawing" || !drawing_standalone(&app){return Err("仅独立绘图程序可更新重启".into());}
    app.state::<AppState>().exit_allowed.store(true,Ordering::SeqCst);
    app.restart();
}
pub fn run() {
    let updater = tauri_plugin_updater::Builder::new();
    #[cfg(target_os = "windows")]
    let updater = {
        let executable = std::env::current_exe().expect("无法定位当前程序，不能确定更新目录");
        let directory = executable.parent().expect("当前程序没有有效的所在目录");
        // NSIS /D= consumes the remainder of its command line: keep it last
        // and unquoted, including directories containing spaces or Chinese.
        let mut destination = std::ffi::OsString::from("/D=");
        destination.push(directory);
        updater.installer_arg(destination)
    };
    tauri::Builder::default()
        .plugin(updater.build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(drawing::DrawingState::default())
        .manage(recognition::RecognitionState::default())
        .on_menu_event(|app, event| {
            if event.id().as_ref()=="drawing-check-update" {let _=app.emit_to("drawing","mathdraw-check-update",());return;}
            let action=match event.id().as_ref(){"drawing-new"=>Some("new"),"drawing-open"=>Some("open"),"drawing-save"=>Some("save"),"drawing-save-as"=>Some("saveAs"),_=>None};
            if let Some(action)=action {
                if let Err(e)=drawing::request_action(app,action){let _=app.emit("drawing-open-error",e);}
                return;
            }
            if event.id().as_ref() == "math-drawing" {
                if let Err(e) = drawing::show(app) {
                    let _ = app.emit("drawing-open-error", e);
                }
                return;
            }
            if event.id().as_ref() == "save-and-close"
                && app
                    .get_webview_window("drawing")
                    .is_some_and(|w| w.is_focused().unwrap_or(false))
            {
                let _ = app.emit_to("drawing", "drawing-close-request", false);
                return;
            }
            if matches!(
                event.id().as_ref(),
                "toggle-sidebar" | "toggle-list" | "restore-layout"
            ) {
                let _ = app.emit("workspace-action", event.id().as_ref());
            }
            if matches!(event.id().as_ref(), "save-and-quit" | "save-and-close") {
                if drawing_standalone(app) {
                    let _ = app.emit_to("drawing", "drawing-close-request", true);
                    return;
                }
                let state = app.state::<AppState>();
                if state.frontend_ready.load(Ordering::SeqCst) {
                    let _ = app.emit("app-exit-requested", ());
                } else {
                    app.exit(0);
                }
            }
        })
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            fs::create_dir_all(&dir)?;
            let remembered = if drawing_standalone(app.handle()) {
                None
            } else {
                fs::read(dir.join("vault.json"))
                    .ok()
                    .and_then(|b| serde_json::from_slice::<String>(&b).ok())
                    .and_then(|s| PathBuf::from(s).canonicalize().ok())
                    .filter(|p| p.is_dir())
            };
            let device_path = dir.join("device-id");
            let device = fs::read_to_string(&device_path)
                .unwrap_or_else(|_| uuid::Uuid::new_v4().to_string());
            vault::atomic_write(&device_path, device.as_bytes())?;
            let state = AppState {
                root: Mutex::new(remembered.clone()),
                selection: Arc::new(Mutex::new(None)),
                config_dir: dir,
                watcher: Mutex::new(None),
                sync_gate: Arc::new(Mutex::new(())),
                device,
                frontend_ready: AtomicBool::new(false),
                exit_allowed: AtomicBool::new(false),
            };
            if let Some(p) = remembered {
                let _ = watch(app.handle(), &state, &p);
            }
            app.manage(state);
            app.set_menu(desktop_menu(app.handle())?)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            frontend_ready,
            confirm_exit,
            choose_vault,
            open_vault,
            close_vault,
            list_entries,
            read_note,
            write_note,
            create_entry,
            relocate_entry,
            trash_entry,
            list_trash,
            restore_trash,
            save_connection,
            forget_connection,
            test_connection,
            sync_vault,
            reveal_vault,
            open_external,
            drawing::drawing_recover,
            drawing::drawing_menu_ready,
            drawing::drawing_recover_save,
            drawing::drawing_open,
            drawing::drawing_save,
            drawing::drawing_fonts,
            drawing::drawing_choose_fonts,
            drawing::drawing_export,
            drawing::drawing_finish_close,
            drawing::drawing_check_text,
            drawing::drawing_conditions_open,
            drawing::drawing_conditions_save,
            drawing_update_restart,
            drawing_check_update,
            recognition::recognition_settings,
            recognition::recognition_choose_image,
            recognition::recognition_paste_image,
            recognition::recognition_save_settings,
            recognition::recognition_call,
            recognition::recognition_cancel
        ])
        .build(tauri::generate_context!())
        .expect("无法启动 Mindgrove")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let state = app.state::<AppState>();
                if drawing_standalone(app)
                    && !state.exit_allowed.load(Ordering::SeqCst)
                    && app.get_webview_window("drawing").is_some()
                {
                    api.prevent_exit();
                    let _ = app.emit_to("drawing", "drawing-close-request", true);
                    return;
                }
                if state.frontend_ready.load(Ordering::SeqCst)
                    && !state.exit_allowed.load(Ordering::SeqCst)
                    && app.get_webview_window("main").is_some()
                {
                    api.prevent_exit();
                    let _ = app.emit("app-exit-requested", ());
                }
            }
        });
}
