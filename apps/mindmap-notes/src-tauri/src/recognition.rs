//! User-triggered Bailian calls. Secrets never cross into returned UI state.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashSet, fs, io::Read, sync::Mutex, time::Duration};
use tauri::{Manager, State};
use base64::Engine;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

// Read only a file explicitly selected by the user; no arbitrary path is exposed.
#[tauri::command]
pub async fn recognition_choose_image(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    only(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app.dialog().file().set_title("选择题干截图")
            .add_filter("PNG / JPEG 截图", &["png", "jpg", "jpeg"]).blocking_pick_file() else { return Ok(None); };
        let path = file.into_path().map_err(|_| "无法读取所选截图")?;
        let mut bytes = Vec::new();
        fs::File::open(path).map_err(|_| "无法打开所选截图")?.take(8 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes).map_err(|_| "读取截图失败")?;
        if bytes.len() > 8 * 1024 * 1024 { return Err("请选择 8 MB 以内的截图".into()); }
        let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { "image/png" }
            else if bytes.starts_with(&[0xff, 0xd8, 0xff]) { "image/jpeg" }
            else { return Err("请选择有效的 PNG/JPEG 截图".into()); };
        Ok(Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))))
    }).await.map_err(|_| "读取截图失败".to_string())?
}

#[tauri::command]
pub async fn recognition_paste_image(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<String, String> {
    only(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let image = app.clipboard().read_image().map_err(|_| "剪贴板中没有可读取的图片，请先复制截图或使用“选择截图”")?;
        let (width, height) = (image.width(), image.height());
        if width == 0 || height == 0 || width > 12000 || height > 12000 || u64::from(width) * u64::from(height) > 16_000_000 {
            return Err("图片过大，请先裁剪题干".into());
        }
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().map_err(|_| "处理剪贴板图片失败")?;
            writer.write_image_data(image.rgba()).map_err(|_| "处理剪贴板图片失败")?;
        }
        if bytes.len() > 8 * 1024 * 1024 { return Err("截图过大，请裁剪或压缩后重试".into()); }
        Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
    }).await.map_err(|_| "读取剪贴板图片失败".to_string())?
}

#[derive(Default)]
pub struct RecognitionState {
    cancelled: Mutex<HashSet<String>>,
    secret: Mutex<Option<String>>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    region: String,
    workspace: String,
    ocr_model: String,
    model: String,
    #[serde(default)]
    credential_saved: Option<bool>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            region: "beijing".into(),
            workspace: String::new(),
            ocr_model: "qwen3.5-ocr".into(),
            model: "qwen3-vl-plus".into(),
            credential_saved: Some(false),
        }
    }
}
fn only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "drawing" {
        Err("仅绘图窗口可识别题干".into())
    } else {
        Ok(())
    }
}
fn read_secret(settings: &std::path::Path) -> Result<String, String> {
    let key = fs::read_to_string(settings.with_file_name("recognition-api-key"))
        .map_err(|_| "未保存百炼 API Key，请在设置中填写")?;
    if key.is_empty() || key.len() > 1024 || key.chars().any(char::is_whitespace) { return Err("本机 API Key 格式无效，请重新保存".into()); }
    Ok(key)
}
fn write_secret(settings: &std::path::Path, key: &str) -> Result<(), String> {
    use std::io::Write;
    let target = settings.with_file_name("recognition-api-key");
    let temp = settings.with_file_name(format!(".recognition-key-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options=fs::OpenOptions::new(); options.write(true).create_new(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let mut file=options.open(&temp).map_err(|_| "无法保存本机 API Key")?;
        file.write_all(key.as_bytes()).map_err(|_| "保存本机 API Key 失败")?;
        file.sync_all().map_err(|_| "保存本机 API Key 失败")?;
        fs::rename(&temp,&target).map_err(|_| "替换本机 API Key 失败")
    })();
    if result.is_err(){let _=fs::remove_file(temp);}result.map_err(String::from)
}
fn path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let d = app
        .path()
        .config_dir()
        .map_err(|_| "无法访问应用配置目录")?
        .join("lab.chuan.mathdraw")
        .join("drawing");
    fs::create_dir_all(&d).map_err(|_| "无法创建设置目录")?;
    Ok(d.join("recognition-settings.json"))
}
fn settings(app: &tauri::AppHandle) -> Result<Settings, String> {
    let p = path(app)?;
    if !p.exists() {
        // Bailian credentials use one product service. Share the non-secret settings
        // too, and migrate an older isolated/drawing window without requesting its key.
        let current = app
            .path()
            .app_config_dir()
            .map_err(|_| "无法访问应用配置目录")?
            .join("drawing/recognition-settings.json");
        let mut candidates = vec![current];
        if let Some(base) = p.parent().and_then(|p| p.parent()).and_then(|p| p.parent()) {
            if let Ok(entries) = fs::read_dir(base) {
                for entry in entries.flatten() {
                    if entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("lab.chuan.mathdraw.")
                    {
                        candidates.push(entry.path().join("drawing/recognition-settings.json"));
                    }
                }
            }
        }
        candidates.sort_by_key(|candidate| fs::metadata(candidate).and_then(|m| m.modified()).ok());
        if let Some(old) = candidates
            .into_iter()
            .rev()
            .find(|candidate| candidate != &p && candidate.is_file())
        {
            let bytes = fs::read(old).map_err(|_| "读取识别设置失败")?;
            let s: Settings = serde_json::from_slice(&bytes).map_err(|_| "识别设置格式无效")?;
            validate(&s)?;
            crate::vault::atomic_write(&p, &bytes)?;
            return Ok(s);
        }
        return Ok(Settings::default());
    }
    serde_json::from_slice(&fs::read(p).map_err(|_| "读取识别设置失败")?)
        .map_err(|_| "识别设置格式无效".into())
}
fn validate(s: &Settings) -> Result<(), String> {
    if !["beijing", "singapore"].contains(&s.region.as_str())
        || s.workspace.len() > 100
        || !s
            .workspace
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
        || [&s.ocr_model, &s.model].iter().any(|s| {
            s.is_empty()
                || s.len() > 100
                || !s
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        })
    {
        return Err("识别地域、工作空间或模型名无效".into());
    }
    Ok(())
}
#[tauri::command]
pub fn recognition_settings(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    only(&window)?;
    let s = settings(&app)?;
    let configured = path(&app)?.with_file_name("recognition-api-key").is_file();
    let mut v = serde_json::to_value(s).map_err(|_| "识别设置无效")?;
    v["configured"] = configured.into();
    Ok(v)
}
#[tauri::command]
pub fn recognition_save_settings(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    mut settings: Settings,
    key: Option<String>,
    forget: bool,
) -> Result<(), String> {
    only(&window)?;
    validate(&settings)?;
    settings.credential_saved = Some(path(&app)?.with_file_name("recognition-api-key").is_file());
    if forget {
        match fs::remove_file(path(&app)?.with_file_name("recognition-api-key")) {
            Ok(()) => (), Err(e) if e.kind()==std::io::ErrorKind::NotFound => (),
            Err(_) => return Err("移除本机 API Key 失败".into()),
        }
        *app.state::<RecognitionState>()
            .secret
            .lock()
            .map_err(|_| "识别状态无效")? = None;
        settings.credential_saved = Some(false);
    }
    if let Some(k) = key {
        if !k.trim().is_empty() {
            if k.len() > 1024 || k.chars().any(char::is_whitespace) {
                return Err("API Key 格式无效".into());
            }
            write_secret(&path(&app)?, &k)?;
            *app.state::<RecognitionState>()
                .secret
                .lock()
                .map_err(|_| "识别状态无效")? = Some(k);
            settings.credential_saved = Some(true);
        }
    }
    crate::vault::atomic_write(
        &path(&app)?,
        &serde_json::to_vec(&settings).map_err(|_| "识别设置无效")?,
    )
}
#[tauri::command]
pub fn recognition_cancel(
    window: tauri::WebviewWindow,
    state: State<'_, RecognitionState>,
    id: String,
) -> Result<(), String> {
    only(&window)?;
    let mut cancelled = state.cancelled.lock().map_err(|_| "识别状态无效")?;
    if cancelled.len() > 100 {
        cancelled.clear();
    }
    cancelled.insert(id);
    Ok(())
}
fn endpoint(s: &Settings) -> String {
    let host = if s.workspace.is_empty() {
        if s.region == "beijing" {
            "dashscope.aliyuncs.com".into()
        } else {
            "dashscope-intl.aliyuncs.com".into()
        }
    } else {
        format!(
            "{}.{}.maas.aliyuncs.com",
            s.workspace,
            if s.region == "beijing" {
                "cn-beijing"
            } else {
                "ap-southeast-1"
            }
        )
    };
    format!("https://{host}/api/v1/services/aigc/multimodal-generation/generation")
}
#[tauri::command]
pub async fn recognition_call(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    stage: String,
    image: String,
    prompt: String,
) -> Result<Value, String> {
    only(&window)?;
    if id.is_empty()
        || id.len() > 128
        || !["ocr", "extract"].contains(&stage.as_str())
        || image.len() > 6 * 1024 * 1024
        || !(image.starts_with("data:image/png;base64,")
            || image.starts_with("data:image/jpeg;base64,"))
        || prompt.len() > 180000
    {
        return Err("识别请求大小或格式无效".into());
    }
    let s = settings(&app)?;
    validate(&s)?;
    if app
        .state::<RecognitionState>()
        .cancelled
        .lock()
        .map_err(|_| "识别状态无效")?
        .contains(&id)
    {
        return Err("识别已取消".into());
    }
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<RecognitionState>();
        let secret = cached_secret(&state, || read_secret(&path(&handle)?))?;
        if state
            .cancelled
            .lock()
            .map_err(|_| "识别状态无效")?
            .remove(&id)
        {
            return Err("识别已取消".into());
        }
        let value = call_cloud(&s, &secret, &stage, &image, &prompt)?;
        if handle
            .state::<RecognitionState>()
            .cancelled
            .lock()
            .map_err(|_| "识别状态无效")?
            .remove(&id)
        {
            return Err("识别已取消".into());
        }
        Ok(value)
    })
    .await
    .map_err(|_| "识别任务执行失败")?
}

/// Cache the local credential within the current application session.
fn cached_secret(
    state: &RecognitionState,
    load: impl FnOnce() -> Result<String, String>,
) -> Result<String, String> {
    let mut cache = state.secret.lock().map_err(|_| "识别状态无效")?;
    if let Some(secret) = cache.as_ref() {
        return Ok(secret.clone());
    }
    let secret = load()?;
    *cache = Some(secret.clone());
    Ok(secret)
}
fn call_cloud(
    s: &Settings,
    secret: &str,
    stage: &str,
    image: &str,
    prompt: &str,
) -> Result<Value, String> {
    let parameters = if stage == "ocr" {
        json!({"ocr_options":{"task":"advanced_recognition"}})
    } else {
        json!({"enable_thinking":false,"result_format":"message","response_format":{"type":"json_object"},"max_tokens":12000})
    };
    let content = if stage == "ocr" {
        json!([{"image":image,"enable_rotate":false}])
    } else {
        json!([{"image":image,"enable_rotate":false},{"text":prompt}])
    };
    let messages = if stage == "ocr" {
        json!([{"role":"user","content":content}])
    } else {
        json!([{"role":"system","content":[{"text":"你是结构化数学题录入器。严格遵守用户提供的 JSON 协议与 source 命令语法。完整转录选项；不解题，不增加已知。source 不能写自然语言或组合 and 条件。"}]},{"role":"user","content":content}])
    };
    let body = json!({"model":if stage=="ocr"{&s.ocr_model}else{&s.model},"input":{"messages":messages},"parameters":parameters});
    let response = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(90))
        .connect_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "建立识别连接失败")?
        .post(endpoint(&s))
        .bearer_auth(secret)
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .send()
        .map_err(|_| "云端识别连接失败或超时；未修改绘图，可重试")?;
    let status = response.status();
    let mut bytes = Vec::new();
    response
        .take(4 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取识别回复失败")?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("云端回复过大".into());
    }
    let parsed = serde_json::from_slice::<Value>(&bytes);
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 403 => "API Key、地域或模型权限无效".into(),
            429 => "百炼限流或额度不足，请稍后手动重试".into(),
            _ => {
                let code = parsed
                    .as_ref()
                    .ok()
                    .and_then(|v| v.get("code"))
                    .and_then(Value::as_str)
                    .filter(|c| {
                        c.len() < 100
                            && c.chars()
                                .all(|x| x.is_ascii_alphanumeric() || "._-".contains(x))
                    })
                    .unwrap_or("ServiceError");
                if code == "Arrearage" {
                    "百炼账户欠费或余额不足（Arrearage），请在阿里云控制台检查账户后手动重试".into()
                } else {
                    format!(
                        "百炼返回 {}（{}），请检查模型名、地域及接口参数",
                        status.as_u16(),
                        code
                    )
                }
            }
        });
    }
    let value: Value = parsed.map_err(|_| "云端回复不是有效 JSON")?;
    if value.get("code").is_some() {
        return Err("百炼拒绝了识别请求，请检查模型权限和设置".into());
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoints_and_settings_are_restricted() {
        let mut s = Settings::default();
        assert!(endpoint(&s).starts_with("https://dashscope.aliyuncs.com/"));
        s.region = "singapore".into();
        assert!(endpoint(&s).contains("dashscope-intl.aliyuncs.com"));
        s.workspace = "work-123".into();
        assert!(endpoint(&s).contains("work-123.ap-southeast-1.maas.aliyuncs.com"));
        s.workspace = "evil.example/".into();
        assert!(validate(&s).is_err());
    }
    #[test]
    fn local_credential_roundtrip_and_permissions() {
        let directory = tempfile::tempdir().unwrap();
        let settings = directory.path().join("recognition-settings.json");
        write_secret(&settings, "sk-test-one").unwrap();
        assert_eq!(read_secret(&settings).unwrap(), "sk-test-one");
        write_secret(&settings, "sk-test-two").unwrap();
        assert_eq!(read_secret(&settings).unwrap(), "sk-test-two");
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; assert_eq!(fs::metadata(settings.with_file_name("recognition-api-key")).unwrap().permissions().mode() & 0o777, 0o600); }
    }
    #[test]
    fn credential_is_read_only_once_per_session() {
        let state = RecognitionState::default();
        assert_eq!(
            cached_secret(&state, || Ok("test-secret".into())).unwrap(),
            "test-secret"
        );
        assert_eq!(
            cached_secret(&state, || panic!("must not read the local credential twice")).unwrap(),
            "test-secret"
        );
        *state.secret.lock().unwrap() = None;
        assert_eq!(
            cached_secret(&state, || Ok("new-test-secret".into())).unwrap(),
            "new-test-secret"
        );
    }
    /// Explicit opt-in integration check. The credential stays in Rust and is never printed.
    /// Input manifest: {settings: path, prompt: path, cases:[{name,image: data URI}]}.
    #[test]
    #[ignore = "requires configured Bailian credential and explicitly uploads test screenshots"]
    fn live_recognition() {
        let path = std::env::var("MATHDRAW_RECOGNITION_MANIFEST").expect("test manifest required");
        let manifest: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        let s: Settings =
            serde_json::from_slice(&fs::read(manifest["settings"].as_str().unwrap()).unwrap())
                .unwrap();
        validate(&s).unwrap();
        let prompt = fs::read_to_string(manifest["prompt"].as_str().unwrap()).unwrap();
        let secret = read_secret(std::path::Path::new(manifest["settings"].as_str().unwrap()))
            .expect("configure the local API Key in the application first");
        let output = std::path::PathBuf::from(manifest["output"].as_str().unwrap());
        fs::create_dir_all(&output).unwrap();
        for case in manifest["cases"].as_array().unwrap() {
            let name = case["name"].as_str().unwrap();
            assert!(name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
            let image = case["image"].as_str().unwrap();
            let saved = output.join(format!("{name}-ocr.json"));
            let ocr = if manifest["reuseOcr"] == true && saved.exists() {
                serde_json::from_slice(&fs::read(saved).unwrap()).unwrap()
            } else {
                call_cloud(&s, &secret, "ocr", image, "")
                    .unwrap_or_else(|e| panic!("{name} OCR: {e}"))
            };
            fs::write(
                output.join(format!("{name}-ocr.json")),
                serde_json::to_vec_pretty(&ocr).unwrap(),
            )
            .unwrap();
            let mut regions = Vec::new();
            fn collect(v: &Value, rows: &mut Vec<Value>) {
                match v {
                    Value::Array(a) => {
                        for x in a {
                            collect(x, rows)
                        }
                    }
                    Value::Object(m) => {
                        if let Some(a) = m.get("words_info").and_then(Value::as_array) {
                            for x in a {
                                rows.push(json!({"id":format!("r{}",rows.len()+1),"text":x.get("text").or_else(||x.get("words")).unwrap_or(&Value::Null)}));
                            }
                        }
                        for (k, x) in m {
                            if k != "words_info" {
                                collect(x, rows)
                            }
                        }
                    }
                    _ => (),
                }
            }
            collect(&ocr, &mut regions);
            assert!(!regions.is_empty(), "{name}: no measured OCR regions");
            let extraction = call_cloud(
                &s,
                &secret,
                "extract",
                image,
                &format!(
                    "{prompt}\nOCR 区域：\n{}",
                    serde_json::to_string(&regions).unwrap()
                ),
            )
            .unwrap_or_else(|e| panic!("{name} extraction: {e}"));
            fs::write(
                output.join(format!("{name}-extract.json")),
                serde_json::to_vec_pretty(&extraction).unwrap(),
            )
            .unwrap();
            println!(
                "{name}: OCR and structured extraction completed ({} measured regions)",
                regions.len()
            );
        }
    }
}
