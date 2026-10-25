use crate::vault;
use resvg::{tiny_skia, usvg};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct DrawingState {
    allowed: Mutex<HashSet<PathBuf>>,
    fonts: Mutex<Option<Arc<usvg::fontdb::Database>>>,
    menu: Mutex<(bool, Option<String>)>,
}
pub fn request_action(app: &tauri::AppHandle, action: &str) -> Result<(), String> {
    let state=app.state::<DrawingState>();
    let mut menu=state.menu.lock().map_err(vault::err)?;
    let deliver=menu.0 && app.get_webview_window("drawing").is_some();
    if !deliver { menu.1=Some(action.into()); }
    drop(menu);
    show(app)?;
    if deliver { app.emit_to("drawing","drawing-file-action",action).map_err(vault::err)?; }
    Ok(())
}
#[tauri::command]
pub fn drawing_menu_ready(window:tauri::WebviewWindow,state:State<'_,DrawingState>) -> Result<Option<String>,String> {
    drawing_only(&window)?;
    let mut menu=state.menu.lock().map_err(vault::err)?;
    menu.0=true;
    Ok(menu.1.take())
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawingFile {
    content: String,
    path: Option<String>,
    hash: Option<String>,
    #[serde(default)]
    saved_content: Option<String>,
    #[serde(default)]
    ui_draft: Option<std::collections::HashMap<String, String>>,
    #[serde(default)]
    source_version: Option<u8>,
}
const LIMIT: u64 = 8 * 1024 * 1024;
fn dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let p = app
        .path()
        .app_config_dir()
        .map_err(vault::err)?
        .join("drawing");
    fs::create_dir_all(&p).map_err(vault::err)?;
    Ok(p)
}
fn archive_name(content: &str) -> Result<String, String> {
    let value: serde_json::Value = serde_json::from_str(content).map_err(vault::err)?;
    let identity = value["id"].as_str().unwrap_or(content);
    Ok(format!("draft-{}.json", vault::hash(identity.as_bytes())))
}
fn validate_drafts(
    drafts: &Option<std::collections::HashMap<String, String>>,
) -> Result<(), String> {
    if let Some(drafts) = drafts {
        if drafts.len() > 2001
            || drafts.iter().any(|(k, v)| k.len() > 160 || v.len() > 16384)
            || drafts.values().map(|s| s.len()).sum::<usize>() > 1024 * 1024
        {
            return Err("表达式草稿过大".into());
        }
    }
    Ok(())
}
fn check_json(content: &str) -> Result<(), String> {
    if content.len() as u64 > LIMIT {
        return Err("绘图文件不能超过 8 MB".into());
    }
    let v: serde_json::Value = serde_json::from_str(content).map_err(|_| "绘图 JSON 无效")?;
    if (v["schemaVersion"] != 1 && v["schemaVersion"] != 2 && v["schemaVersion"] != 3 && v["schemaVersion"] != 4)
        || v["type"] != "mindgrove-mathdraw"
        || !v["objects"].is_array()
    {
        return Err("不是支持的数学绘图文件".into());
    }
    Ok(())
}
fn validate_recovery(file: &DrawingFile) -> Result<(), String> {
    check_json(&file.content)?;
    validate_drafts(&file.ui_draft)?;
    if file.source_version.is_some_and(|v| v != 1 && v != 2 && v != 3 && v != 4) {
        return Err("恢复草稿的源格式版本无效".into());
    }
    Ok(())
}
fn write_source(
    destination: &std::path::Path,
    content: &str,
    expected: Option<&str>,
    replace_confirmed: bool,
) -> Result<(), String> {
    check_json(content)?;
    if fs::symlink_metadata(destination).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("请直接选择普通文件，不能保存到符号链接".into());
    }
    if !replace_confirmed {
        let current = fs::read(destination).map_err(|_| "文件已被移动或删除，请另存为")?;
        if Some(vault::hash(&current).as_str()) != expected {
            return Err("文件已被其他程序修改，请另存为以保留双方内容".into());
        }
    }
    vault::atomic_write(destination, content.as_bytes())
}
fn drawing_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "drawing" {
        return Err("此操作仅用于数学绘图窗口".into());
    }
    Ok(())
}
pub fn show(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("drawing") {
        w.show().map_err(vault::err)?;
        w.unminimize().map_err(vault::err)?;
        return w.set_focus().map_err(vault::err);
    }
    tauri::WebviewWindowBuilder::new(
        app,
        "drawing",
        tauri::WebviewUrl::App("index.html?drawing=1".into()),
    )
    .title("数学绘图 · Mindgrove")
    .inner_size(1280., 860.)
    .min_inner_size(960., 640.)
    .resizable(true)
    .build()
    .map_err(vault::err)?;
    Ok(())
}
#[tauri::command]
pub fn drawing_recover(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, DrawingState>,
) -> Result<Option<DrawingFile>, String> {
    drawing_only(&window)?;
    let p = dir(&app)?.join("recovery.json");
    if !p.exists() {
        return Ok(None);
    }
    if p.metadata().map_err(vault::err)?.len() > LIMIT * 3 {
        return Err("恢复草稿过大".into());
    }
    let mut file: DrawingFile =
        serde_json::from_slice(&fs::read(p).map_err(vault::err)?).map_err(vault::err)?;
    validate_recovery(&file)?;
    if let Some(path) = &file.path {
        let p = PathBuf::from(path);
        if p.is_absolute()
            && p.to_string_lossy()
                .to_lowercase()
                .ends_with(".mathdraw.json")
        {
            state.allowed.lock().map_err(vault::err)?.insert(p);
        } else {
            file.path = None;
            file.hash = None;
        }
    }
    Ok(Some(file))
}
#[tauri::command]
pub fn drawing_recover_save(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    file: DrawingFile,
    state: State<'_, DrawingState>,
) -> Result<(), String> {
    drawing_only(&window)?;
    validate_recovery(&file)?;
    if let Some(saved) = &file.saved_content {
        if !saved.is_empty() {
            check_json(saved)?;
        }
    }
    if let Some(path) = &file.path {
        if !state
            .allowed
            .lock()
            .map_err(vault::err)?
            .contains(&PathBuf::from(path))
        {
            return Err("请通过保存对话框选择文件".into());
        }
    }
    let bytes = serde_json::to_vec(&file).map_err(vault::err)?;
    vault::atomic_write(&dir(&app)?.join(archive_name(&file.content)?), &bytes)?;
    vault::atomic_write(&dir(&app)?.join("recovery.json"), &bytes)
}
#[tauri::command]
pub async fn drawing_open(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Option<DrawingFile>, String> {
    drawing_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(p) = app
            .dialog()
            .file()
            .set_title("打开数学绘图")
            .add_filter("数学绘图", &["mathdraw.json"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = p
            .into_path()
            .map_err(vault::err)?
            .canonicalize()
            .map_err(vault::err)?;
        if path.metadata().map_err(vault::err)?.len() > LIMIT {
            return Err("绘图文件不能超过 8 MB".into());
        }
        let content = fs::read_to_string(&path).map_err(vault::err)?;
        check_json(&content)?;
        let archive = dir(&app)?.join(archive_name(&content)?);
        let drafts =
            if archive.exists() && archive.metadata().map_err(vault::err)?.len() <= LIMIT * 3 {
                serde_json::from_slice::<DrawingFile>(&fs::read(archive).map_err(vault::err)?)
                    .ok()
                    .and_then(|f| f.ui_draft)
            } else {
                None
            };
        validate_drafts(&drafts)?;
        app.state::<DrawingState>()
            .allowed
            .lock()
            .map_err(vault::err)?
            .insert(path.clone());
        Ok(Some(DrawingFile {
            hash: Some(vault::hash(content.as_bytes())),
            saved_content: Some(content.clone()),
            ui_draft: drafts,
            source_version: None,
            content,
            path: Some(path.to_string_lossy().into_owned()),
        }))
    })
    .await
    .map_err(vault::err)?
}
#[tauri::command]
pub async fn drawing_save(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    content: String,
    path: Option<String>,
    hash: Option<String>,
    save_as: bool,
) -> Result<Option<DrawingFile>, String> {
    drawing_only(&window)?;
    check_json(&content)?;
    tauri::async_runtime::spawn_blocking(move || {
        let picked = save_as || path.is_none();
        let destination = if picked {
            let Some(p) = app
                .dialog()
                .file()
                .set_title("保存数学绘图")
                .set_file_name("数学绘图.mathdraw.json")
                .add_filter("数学绘图", &["mathdraw.json"])
                .blocking_save_file()
            else {
                return Ok(None);
            };
            let mut p = p.into_path().map_err(vault::err)?;
            if !p
                .to_string_lossy()
                .to_lowercase()
                .ends_with(".mathdraw.json")
            {
                p.set_file_name(format!(
                    "{}.mathdraw.json",
                    p.file_name().unwrap_or_default().to_string_lossy()
                ));
            }
            p
        } else {
            PathBuf::from(path.unwrap())
        };
        let state = app.state::<DrawingState>();
        let mut allowed = state.allowed.lock().map_err(vault::err)?;
        if !picked && !allowed.contains(&destination) {
            return Err("文件未通过对话框授权".into());
        }
        write_source(&destination, &content, hash.as_deref(), picked)?;
        allowed.insert(destination.clone());
        Ok(Some(DrawingFile {
            hash: Some(vault::hash(content.as_bytes())),
            saved_content: Some(content.clone()),
            ui_draft: None,
            source_version: None,
            content,
            path: Some(destination.to_string_lossy().into_owned()),
        }))
    })
    .await
    .map_err(vault::err)?
}
fn fonts(app: &tauri::AppHandle) -> Result<Arc<usvg::fontdb::Database>, String> {
    let state = app.state::<DrawingState>();
    let mut cache = state.fonts.lock().map_err(vault::err)?;
    if let Some(db) = &*cache {
        return Ok(db.clone());
    }
    let mut db = usvg::fontdb::Database::new();
    db.load_system_fonts();
    db.load_fonts_dir(dir(app)?.join("fonts"));
    let remove: Vec<_> = db
        .faces()
        .filter(|f| {
            !f.families
                .iter()
                .any(|(name, _)| name.eq_ignore_ascii_case("Times New Roman"))
        })
        .map(|f| f.id)
        .collect();
    for id in remove {
        db.remove_face(id);
    }
    db.set_serif_family("Times New Roman");
    let db = Arc::new(db);
    *cache = Some(db.clone());
    Ok(db)
}
fn font_id(db: &usvg::fontdb::Database, italic: bool) -> Result<usvg::fontdb::ID, String> {
    use usvg::fontdb::*;
    db.faces()
        .find(|f| {
            f.families
                .iter()
                .any(|(name, _)| name.eq_ignore_ascii_case("Times New Roman"))
                && f.style == if italic { Style::Italic } else { Style::Normal }
                && f.weight == Weight::NORMAL
        })
        .map(|f| f.id)
        .ok_or_else(|| {
            format!(
                "缺少 Times New Roman {}字体，请选择字体文件",
                if italic { "Italic " } else { "Regular " }
            )
        })
}
#[tauri::command]
pub fn drawing_check_text(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    text: String,
) -> Result<String, String> {
    drawing_only(&window)?;
    if text.len() > 200_000 {
        return Err("图中文字过多".into());
    }
    let db = fonts(&app)?;
    for italic in [false, true] {
        let id = font_id(&db, italic)?;
        let missing = db
            .with_face_data(id, |data, index| {
                let face = ttf_parser::Face::parse(data, index).map_err(vault::err)?;
                Ok::<_, String>(
                    text.chars()
                        .filter(|c| !c.is_whitespace() && face.glyph_index(*c).is_none())
                        .collect::<HashSet<_>>(),
                )
            })
            .ok_or("字体读取失败")??;
        if !missing.is_empty() {
            return Ok(format!(
                "Times New Roman 不支持字符“{}”，请修改图中文字",
                missing.into_iter().collect::<String>()
            ));
        }
    }
    Ok(String::new())
}
#[derive(Serialize)]
pub struct FontFace {
    italic: bool,
    data: Vec<u8>,
}
#[tauri::command]
pub fn drawing_fonts(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Vec<FontFace>, String> {
    drawing_only(&window)?;
    let db = fonts(&app)?;
    [false, true]
        .into_iter()
        .map(|italic| {
            let id = font_id(&db, italic)?;
            let data = db
                .with_face_data(id, |data, _| data.to_vec())
                .ok_or("字体读取失败")?;
            Ok(FontFace { italic, data })
        })
        .collect()
}
#[tauri::command]
pub async fn drawing_choose_fonts(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<bool, String> {
    drawing_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(files) = app
            .dialog()
            .file()
            .set_title("选择 Times New Roman 常规与斜体字体（可多选）")
            .add_filter("字体", &["ttf", "otf", "ttc"])
            .blocking_pick_files()
        else {
            return Ok(false);
        };
        let directory = dir(&app)?.join("fonts");
        fs::create_dir_all(&directory).map_err(vault::err)?;
        for file in files {
            let p = file.into_path().map_err(vault::err)?;
            if p.metadata().map_err(vault::err)?.len() > 20 * 1024 * 1024 {
                return Err("字体文件过大".into());
            }
            let bytes = fs::read(&p).map_err(vault::err)?;
            let mut db = usvg::fontdb::Database::new();
            db.load_font_data(bytes.clone());
            if !db.faces().any(|f| {
                f.families
                    .iter()
                    .any(|(n, _)| n.eq_ignore_ascii_case("Times New Roman"))
            }) {
                return Err("请选择真实的 Times New Roman 字体文件".into());
            }
            vault::atomic_write(
                &directory.join(format!("{}.ttf", uuid::Uuid::new_v4())),
                &bytes,
            )?;
        }
        *app.state::<DrawingState>()
            .fonts
            .lock()
            .map_err(vault::err)? = None;
        Ok(true)
    })
    .await
    .map_err(vault::err)?
}
fn validate_svg(svg: &str, db: &usvg::fontdb::Database) -> Result<(), String> {
    if svg.len() as u64 > LIMIT {
        return Err("导出图形过大，请减少曲线或缩小范围".into());
    }
    let mut reader = quick_xml::Reader::from_str(svg);
    let allowed = [
        "svg", "g", "path", "line", "polyline", "polygon", "circle", "ellipse", "text", "tspan",
        "rect",
    ];
    loop {
        match reader.read_event().map_err(vault::err)? {
            quick_xml::events::Event::Start(e) | quick_xml::events::Event::Empty(e) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                if !allowed.contains(&name.as_str()) {
                    return Err("导出包含不支持的 SVG 元素".into());
                }
                for a in e.attributes() {
                    let a = a.map_err(vault::err)?;
                    let key = String::from_utf8_lossy(a.key.as_ref());
                    let value = a.unescape_value().map_err(vault::err)?;
                    if key.contains("href")
                        || key.starts_with("on")
                        || key == "style"
                        || value.contains("url(")
                    {
                        return Err("导出图形不能包含外部资源或脚本".into());
                    }
                }
            }
            quick_xml::events::Event::Text(t) => {
                let text = t.xml_content().map_err(vault::err)?;
                for italic in [false, true] {
                    let id = font_id(db, italic)?;
                    let unsupported = db
                        .with_face_data(id, |data, index| {
                            let face = ttf_parser::Face::parse(data, index).map_err(vault::err)?;
                            Ok::<_, String>(
                                text.chars()
                                    .filter(|c| {
                                        !c.is_whitespace() && face.glyph_index(*c).is_none()
                                    })
                                    .collect::<String>(),
                            )
                        })
                        .ok_or("字体读取失败")??;
                    if !unsupported.is_empty() {
                        return Err(format!(
                            "Times New Roman 不支持字符“{unsupported}”，请修改图中文字"
                        ));
                    }
                }
            }
            quick_xml::events::Event::Eof => break,
            quick_xml::events::Event::DocType(_) | quick_xml::events::Event::CData(_) => {
                return Err("导出 SVG 格式不受支持".into())
            }
            quick_xml::events::Event::GeneralRef(r) => {
                let raw = format!("&{};", r.decode().map_err(vault::err)?);
                quick_xml::escape::unescape(&raw).map_err(vault::err)?;
            }
            _ => {}
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn drawing_export(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    svg: String,
    format: String,
    width: u32,
) -> Result<Option<String>, String> {
    drawing_only(&window)?;
    if !["svg", "png", "clipboard"].contains(&format.as_str()) || !(100..=8000).contains(&width) {
        return Err("导出参数无效".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let db = fonts(&app)?;
        validate_svg(&svg, &db)?;
        let options = usvg::Options {
            fontdb: db,
            font_family: "Times New Roman".into(),
            ..Default::default()
        };
        let tree = usvg::Tree::from_str(&svg, &options).map_err(vault::err)?;
        let output = if format == "svg" {
            tree.to_string(&usvg::WriteOptions::default()).into_bytes()
        } else {
            let height = (width as f32 * tree.size().height() / tree.size().width()).ceil() as u32;
            if height == 0 || height > 16000 || width as u64 * height as u64 > 40_000_000 {
                return Err("导出图像过高或像素过多，请调整导出范围".into());
            }
            let mut pixmap = tiny_skia::Pixmap::new(width, height).ok_or("图像内存不足")?;
            let scale = width as f32 / tree.size().width();
            resvg::render(
                &tree,
                tiny_skia::Transform::from_scale(scale, scale),
                &mut pixmap.as_mut(),
            );
            if format == "clipboard" {
                let rgba = pixmap
                    .pixels()
                    .iter()
                    .flat_map(|p| {
                        let q = p.demultiply();
                        [q.red(), q.green(), q.blue(), q.alpha()]
                    })
                    .collect::<Vec<_>>();
                app.clipboard()
                    .write_image(&tauri::image::Image::new_owned(rgba, width, height))
                    .map_err(vault::err)?;
                return Ok(Some("已复制图片".into()));
            }
            pixmap.encode_png().map_err(vault::err)?
        };
        let filename = format!("数学绘图.{format}");
        let Some(p) = app
            .dialog()
            .file()
            .set_title("导出数学绘图")
            .set_file_name(&filename)
            .add_filter(format.to_uppercase(), &[format.as_str()])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let mut path = p.into_path().map_err(vault::err)?;
        if path
            .extension()
            .is_none_or(|e| e.to_string_lossy().to_lowercase() != format)
        {
            path.set_extension(&format);
        }
        if fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("导出目标不能是符号链接".into());
        }
        vault::atomic_write(&path, &output)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(vault::err)?
}
#[tauri::command]
pub fn drawing_finish_close(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    exit: bool,
    approved: bool,
) -> Result<(), String> {
    drawing_only(&window)?;
    if !approved {
        if app.get_webview_window("main").is_some() {
            app.emit_to("main", "app-exit-cancelled", ())
                .map_err(vault::err)?;
        }
        return Ok(());
    }
    if exit {
        app.state::<crate::AppState>()
            .exit_allowed
            .store(true, std::sync::atomic::Ordering::SeqCst);
        app.exit(0);
    } else {
        *app.state::<DrawingState>().menu.lock().map_err(vault::err)?=(false,None);
        window.destroy().map_err(vault::err)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source(title: &str) -> String {
        serde_json::json!({"schemaVersion":1,"type":"mindgrove-mathdraw","objects":[],"title":title}).to_string()
    }
    #[test]
    fn validates_source_envelope_and_size() {
        assert!(check_json(&source("test")).is_ok());
        assert!(check_json("{}").is_err());
        assert!(check_json("{bad").is_err());
        assert!(check_json(&"x".repeat(LIMIT as usize + 1)).is_err());
    }
    #[test]
    fn accepts_v2_v3_v4_and_rejects_unknown_versions() {
        let mut value: serde_json::Value = serde_json::from_str(&source("v2")).unwrap();
        value["schemaVersion"] = 2.into();
        assert!(check_json(&value.to_string()).is_ok());
        value["schemaVersion"] = 3.into();
        assert!(check_json(&value.to_string()).is_ok());
        value["schemaVersion"] = 4.into();
        assert!(check_json(&value.to_string()).is_ok());
        value["schemaVersion"] = 5.into();
        assert!(check_json(&value.to_string()).is_err());
    }
    #[test]
    fn bounds_recovery_drafts_and_keeps_document_identity() {
        use std::collections::HashMap;
        assert!(validate_drafts(&Some(HashMap::from([(
            "new".into(),
            "c: y=\\frac{".into()
        )])))
        .is_ok());
        assert!(
            validate_drafts(&Some(HashMap::from([("new".into(), "x".repeat(16385))]))).is_err()
        );
        assert!(validate_drafts(&Some(HashMap::from([("x".repeat(161), "a".into())]))).is_err());
        let content =
            |id: &str, title: &str| serde_json::json!({"id":id,"title":title}).to_string();
        assert_eq!(
            archive_name(&content("same", "A")).unwrap(),
            archive_name(&content("same", "B")).unwrap()
        );
        assert_ne!(
            archive_name(&content("one", "A")).unwrap(),
            archive_name(&content("two", "A")).unwrap()
        );
        let old = r#"{"content":"{}","path":null,"hash":null}"#;
        assert!(serde_json::from_str::<DrawingFile>(old)
            .unwrap()
            .ui_draft
            .is_none());
    }
    #[test]
    fn source_saving_keeps_external_edits() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("test.mathdraw.json");
        let (a, b, c) = (source("A"), source("B"), source("C"));
        write_source(&path, &a, None, true).unwrap();
        let hash = vault::hash(a.as_bytes());
        write_source(&path, &b, Some(&hash), false).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), b);
        assert!(write_source(&path, &c, Some(&hash), false).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), b);
    }
    #[test]
    fn recovery_keeps_the_original_format_until_save() {
        let mut file = DrawingFile {
            content: source("normalized in memory")
                .replace("\"schemaVersion\":1", "\"schemaVersion\":2"),
            path: None,
            hash: None,
            saved_content: None,
            ui_draft: None,
            source_version: Some(1),
        };
        let reopened: DrawingFile =
            serde_json::from_str(&serde_json::to_string(&file).unwrap()).unwrap();
        assert_eq!(reopened.source_version, Some(1));
        assert!(validate_recovery(&reopened).is_ok());
        file.source_version = Some(3);
        assert!(validate_recovery(&file).is_ok());
        file.source_version = Some(4);
        assert!(validate_recovery(&file).is_ok());
        file.source_version = Some(5);
        assert!(validate_recovery(&file).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn source_saving_rejects_symbolic_links() {
        let tmp = tempfile::tempdir().unwrap();
        let (real, link) = (
            tmp.path().join("real.mathdraw.json"),
            tmp.path().join("link.mathdraw.json"),
        );
        fs::write(&real, source("original")).unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert!(write_source(&link, &source("new"), None, true).is_err());
        assert_eq!(fs::read_to_string(real).unwrap(), source("original"));
    }
    #[test]
    fn rejects_active_or_external_svg() {
        let db = usvg::fontdb::Database::new();
        for svg in [
            "<svg><script/></svg>",
            "<svg><image href='file:///tmp/private'/></svg>",
            "<svg><path onclick='x'/></svg>",
            "<svg><path style='fill:url(https://example.com)'/></svg>",
        ] {
            assert!(validate_svg(svg, &db).is_err());
        }
    }
    #[test]
    fn export_outlines_times_font_and_renders_transparency() {
        let mut db = usvg::fontdb::Database::new();
        db.load_system_fonts();
        if font_id(&db, false).is_err() || font_id(&db, true).is_err() {
            eprintln!("Times New Roman is absent on this build host; outline check skipped");
            return;
        }
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><path d="M20 70 L180 70" stroke="black"/><text x="30" y="50" font-family="Times New Roman" font-size="22" font-style="italic">A<tspan baseline-shift="sub" font-size="70%">1</tspan>α</text></svg>"#;
        validate_svg(svg, &db).unwrap();
        let opt = usvg::Options {
            fontdb: Arc::new(db),
            ..Default::default()
        };
        let tree = usvg::Tree::from_str(svg, &opt).unwrap();
        let outlined = tree.to_string(&usvg::WriteOptions::default());
        assert!(!outlined.contains("<text"));
        assert!(outlined.contains("<path"));
        let mut p = tiny_skia::Pixmap::new(400, 200).unwrap();
        resvg::render(
            &tree,
            tiny_skia::Transform::from_scale(2., 2.),
            &mut p.as_mut(),
        );
        assert_eq!(p.pixel(0, 0).unwrap().alpha(), 0);
        assert!(p.pixels().iter().any(|p| p.alpha() > 0));
        assert!(p.encode_png().unwrap().starts_with(b"\x89PNG"));
    }
}

fn check_condition_configuration(content: &str) -> Result<(), String> {
    if content.len() > 8 * 1024 * 1024 { return Err("条件配置不能超过 8 MB".into()); }
    let value: serde_json::Value = serde_json::from_str(content).map_err(vault::err)?;
    if value["format"].as_str() != Some("mathdraw-conditions") || !matches!(value["version"].as_u64(), Some(1 | 2)) {
        return Err("不是受支持的条件作图配置文件".into());
    }
    Ok(())
}
#[derive(Serialize)]
pub struct ConditionConfigurationFile { path: String, content: String }
#[tauri::command]
pub async fn drawing_conditions_open(app:tauri::AppHandle,window:tauri::WebviewWindow)->Result<Option<ConditionConfigurationFile>,String>{
    drawing_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(p)=app.dialog().file().set_title("加载条件作图配置").add_filter("条件作图配置", &["mathdraw-conditions.json"]).blocking_pick_file() else{return Ok(None);};
        let path=p.into_path().map_err(vault::err)?;
        if fs::metadata(&path).map_err(vault::err)?.len()>8*1024*1024{return Err("条件配置不能超过 8 MB".into());}
        let content=fs::read_to_string(&path).map_err(vault::err)?;check_condition_configuration(&content)?;
        Ok(Some(ConditionConfigurationFile{path:path.to_string_lossy().into_owned(),content}))
    }).await.map_err(vault::err)?
}
#[tauri::command]
pub async fn drawing_conditions_save(app:tauri::AppHandle,window:tauri::WebviewWindow,content:String)->Result<Option<String>,String>{
    drawing_only(&window)?;check_condition_configuration(&content)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(p)=app.dialog().file().set_title("保存条件作图配置").set_file_name("条件作图.mathdraw-conditions.json").add_filter("条件作图配置", &["mathdraw-conditions.json"]).blocking_save_file() else{return Ok(None);};
        let mut path=p.into_path().map_err(vault::err)?;
        if !path.to_string_lossy().to_lowercase().ends_with(".mathdraw-conditions.json") {
            path.set_file_name(format!("{}.mathdraw-conditions.json",path.file_name().unwrap_or_default().to_string_lossy()));
        }
        vault::atomic_write(&path,content.as_bytes())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await.map_err(vault::err)?
}
