use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;

pub const META: &str = ".mindgrove";
pub const MAX_NOTE: u64 = 8 * 1024 * 1024;
pub fn hash(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}
pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
pub fn is_note(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".md") || lower.ends_with(".mindmap.json")
}
pub fn is_markdown(path: &str) -> bool {
    path.to_lowercase().ends_with(".md")
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub modified: u64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRecord {
    pub id: String,
    pub path: String,
    pub title: String,
    pub format: String,
    pub content: String,
    pub hash: String,
    pub modified: u64,
}
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct Snapshot {
    pub kind: String,
    pub data: Option<String>,
    pub hash: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub id: String,
    pub path: String,
    pub deleted_at: String,
}

pub fn validate_relative(path: &str) -> Result<(), String> {
    if path.contains('\\') || path.contains(':') || path.contains('\0') {
        return Err("无效的笔记路径".into());
    }
    for c in Path::new(path).components() {
        match c {
            Component::Normal(v) if v.to_str().is_some_and(|s| validate_name(s).is_ok()) => {}
            _ => return Err("路径必须位于笔记库中，且名称需兼容 macOS 和 Windows".into()),
        }
    }
    Ok(())
}
pub fn safe(root: &Path, path: &str) -> Result<PathBuf, String> {
    validate_relative(path)?;
    let canonical_root = root.canonicalize().map_err(err)?;
    let root = canonical_root.as_path();
    let target = root.join(path);
    let mut check = target.as_path();
    while !check.exists() {
        check = check.parent().ok_or("路径无效")?;
    }
    if !check.canonicalize().map_err(err)?.starts_with(root) {
        return Err("拒绝访问笔记库之外的路径".into());
    }
    let mut cursor = root.to_path_buf();
    for c in Path::new(path).components() {
        cursor.push(c);
        if cursor
            .symlink_metadata()
            .is_ok_and(|m| m.file_type().is_symlink())
        {
            return Err("不读取符号链接，避免访问笔记库外的文件".into());
        }
    }
    Ok(target)
}
pub fn metadata(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let root = root.canonicalize().map_err(err)?;
    let mut cursor = root.join(META);
    let parts: Vec<_> = Path::new(relative).components().collect();
    if parts.iter().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("无效的内部资料路径".into());
    }
    if cursor
        .symlink_metadata()
        .is_ok_and(|m| m.file_type().is_symlink())
    {
        return Err("笔记库的 .mindgrove 不能是符号链接".into());
    }
    for part in parts {
        cursor.push(part);
        if cursor
            .symlink_metadata()
            .is_ok_and(|m| m.file_type().is_symlink())
        {
            return Err("内部资料路径不能包含符号链接".into());
        }
    }
    Ok(cursor)
}
fn modified(p: &Path) -> u64 {
    p.metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
pub fn entries(root: &Path) -> Result<Vec<Entry>, String> {
    fn visit(root: &Path, dir: &Path, out: &mut Vec<Entry>, depth: usize) -> Result<(), String> {
        if depth > 64 || out.len() > 20000 {
            return Err("笔记库过大或目录嵌套超过 64 层".into());
        }
        for item in fs::read_dir(dir).map_err(err)? {
            let item = item.map_err(err)?;
            let p = item.path();
            let name = item.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || item.file_type().map_err(err)?.is_symlink() {
                continue;
            }
            let path = p
                .strip_prefix(root)
                .map_err(err)?
                .to_string_lossy()
                .replace('\\', "/");
            validate_relative(&path)?;
            if p.is_dir() {
                out.push(Entry {
                    path,
                    name,
                    kind: "folder".into(),
                    modified: modified(&p),
                });
                visit(root, &p, out, depth + 1)?;
            } else if is_note(&path) {
                let kind = if is_markdown(&path) {
                    "markdown"
                } else {
                    "mindmap"
                }
                .into();
                out.push(Entry {
                    path,
                    name,
                    kind,
                    modified: modified(&p),
                });
            }
        }
        Ok(())
    }
    let mut out = vec![];
    visit(root, root, &mut out, 0)?;
    out.sort_by(|a, b| {
        (a.kind != "folder", a.path.to_lowercase())
            .cmp(&(b.kind != "folder", b.path.to_lowercase()))
    });
    Ok(out)
}
pub fn title(path: &str) -> String {
    let name = Path::new(path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy();
    let lower = name.to_lowercase();
    let len = if lower.ends_with(".mindmap.json") {
        name.len() - 13
    } else if lower.ends_with(".md") {
        name.len() - 3
    } else {
        name.len()
    };
    name[..len].to_string()
}
pub fn decode_md(raw: &str) -> (Option<String>, String) {
    for ending in ["\n", "\r\n"] {
        if let Some(rest) = raw.strip_prefix(&format!("---{ending}mindgrove_id: ")) {
            if let Some((id, body)) = rest.split_once(&format!("{ending}---{ending}")) {
                if Uuid::parse_str(id).is_ok() {
                    return (Some(id.into()), body.into());
                }
            }
        }
    }
    (None, raw.into())
}
pub fn read(root: &Path, path: &str) -> Result<NoteRecord, String> {
    if !is_note(path) {
        return Err("只支持 Markdown 和思维导图文件".into());
    }
    let p = safe(root, path)?;
    if p.metadata().map_err(err)?.len() > MAX_NOTE {
        return Err("单篇笔记不能超过 8 MB".into());
    }
    let raw = fs::read_to_string(&p).map_err(err)?;
    let format = if is_markdown(path) {
        "markdown"
    } else {
        "mindmap"
    };
    let (id, content) = if format == "markdown" {
        decode_md(&raw)
    } else {
        (
            serde_json::from_str::<serde_json::Value>(&raw)
                .ok()
                .and_then(|v| v["id"].as_str().map(str::to_string)),
            raw.clone(),
        )
    };
    Ok(NoteRecord {
        id: id.unwrap_or_else(|| hash(path.as_bytes())),
        path: path.into(),
        title: title(path),
        format: format.into(),
        content,
        hash: hash(raw.as_bytes()),
        modified: modified(&p),
    })
}
pub fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("缺少父目录")?;
    fs::create_dir_all(parent).map_err(err)?;
    let temp = parent.join(format!(".mindgrove-write-{}", Uuid::new_v4()));
    let result = (|| {
        use std::io::Write;
        let mut f = fs::File::create(&temp).map_err(err)?;
        f.write_all(data).map_err(err)?;
        f.sync_all().map_err(err)?;
        fs::rename(&temp, path).map_err(err)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}
pub fn write(root: &Path, path: &str, content: &str, expected: &str) -> Result<NoteRecord, String> {
    if content.len() as u64 > MAX_NOTE {
        return Err("单篇笔记不能超过 8 MB".into());
    }
    let p = safe(root, path)?;
    let raw = fs::read_to_string(&p).map_err(err)?;
    if hash(raw.as_bytes()) != expected {
        return Err("文件已被其他编辑器或同步修改。请先另存副本，再重新读取文件。".into());
    }
    let data = if is_markdown(path) {
        let id = decode_md(&raw)
            .0
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        format!("---\nmindgrove_id: {id}\n---\n{content}")
    } else {
        let v: serde_json::Value =
            serde_json::from_str(content).map_err(|_| "思维导图 JSON 无效")?;
        if v["schemaVersion"] != 1 || !v["nodes"].is_array() {
            return Err("思维导图格式无效".into());
        }
        content.into()
    };
    if data.len() as u64 > MAX_NOTE {
        return Err("单篇笔记（含元数据）不能超过 8 MB".into());
    }
    atomic_write(&p, data.as_bytes())?;
    read(root, path)
}
pub fn validate_name(name: &str) -> Result<(), String> {
    if name.trim() != name
        || name.is_empty()
        || name.len() > 240
        || name.contains(['/', '\\', '<', '>', ';', ':', '"', '|', '?', '*'])
        || name.chars().any(|c| c.is_control())
        || name.starts_with('.')
        || name.ends_with('.')
    {
        return Err("名称不能为空或过长，不能含路径分隔符或系统保留字符".into());
    }
    let stem = name.split('.').next().unwrap_or("").to_uppercase();
    if [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ]
    .contains(&stem.as_str())
    {
        return Err("这是 Windows 保留名称".into());
    }
    Ok(())
}
pub fn create(
    root: &Path,
    dir: &str,
    name: &str,
    format: &str,
    content: Option<&str>,
) -> Result<String, String> {
    validate_name(name)?;
    let parent = safe(root, dir)?;
    if !parent.is_dir() {
        return Err("目标文件夹不存在".into());
    }
    let extension = match format {
        "folder" => "",
        "markdown" => ".md",
        "mindmap" => ".mindmap.json",
        _ => return Err("未知的笔记类型".into()),
    };
    let relative = if dir.is_empty() {
        format!("{name}{extension}")
    } else {
        format!("{dir}/{name}{extension}")
    };
    let p = safe(root, &relative)?;
    if p.exists()
        || fs::read_dir(&parent)
            .map_err(err)?
            .filter_map(Result::ok)
            .any(|f| {
                f.file_name().to_string_lossy().to_lowercase()
                    == format!("{name}{extension}").to_lowercase()
            })
    {
        return Err("同名文件已存在".into());
    }
    if format == "folder" {
        fs::create_dir(&p).map_err(err)?;
    } else {
        let id = Uuid::new_v4().to_string();
        let raw = if format == "markdown" {
            format!(
                "---\nmindgrove_id: {id}\n---\n{}",
                content
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("# {name}\n\n"))
            )
        } else {
            content.map(str::to_string).unwrap_or_else(||serde_json::json!({"schemaVersion":1,"id":id,"nodes":[{"id":Uuid::new_v4().to_string(),"parentId":null,"order":0,"text":name,"collapsed":false}]}).to_string())
        };
        if raw.len() as u64 > MAX_NOTE {
            return Err("笔记过大".into());
        }
        atomic_write(&p, raw.as_bytes())?;
    }
    Ok(relative)
}
pub fn relocate(root: &Path, path: &str, destination: &str) -> Result<String, String> {
    if path.is_empty() {
        return Err("不能移动笔记库根目录".into());
    }
    let from = safe(root, path)?;
    let to = safe(root, destination)?;
    if to.exists() {
        return Err("目标已存在同名文件或文件夹".into());
    }
    if to.starts_with(&from) {
        return Err("不能把文件夹移到自己内部".into());
    }
    if !to.parent().is_some_and(|p| p.is_dir()) {
        return Err("目标文件夹不存在".into());
    }
    fs::rename(from, to).map_err(err)?;
    Ok(destination.into())
}
pub fn trash(root: &Path, path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("不能删除笔记库根目录".into());
    }
    let p = safe(root, path)?;
    if !p.exists() {
        return Ok(());
    }
    let id = Uuid::new_v4().to_string();
    let trash_dir = metadata(root, &format!("trash/{id}"))?;
    fs::create_dir_all(&trash_dir).map_err(err)?;
    let record = TrashEntry {
        id,
        path: path.into(),
        deleted_at: chrono::Utc::now().to_rfc3339(),
    };
    atomic_write(
        &trash_dir.join("entry.json"),
        &serde_json::to_vec(&record).map_err(err)?,
    )?;
    fs::rename(p, trash_dir.join("data")).map_err(err)
}
pub fn list_trash(root: &Path) -> Result<Vec<TrashEntry>, String> {
    let dir = metadata(root, "trash")?;
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out: Vec<TrashEntry> = fs::read_dir(dir)
        .map_err(err)?
        .filter_map(Result::ok)
        .filter_map(|f| {
            metadata(
                root,
                &format!("trash/{}/entry.json", f.file_name().to_string_lossy()),
            )
            .ok()
        })
        .filter_map(|p| fs::read(p).ok())
        .filter_map(|b| serde_json::from_slice(&b).ok())
        .collect();
    out.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    Ok(out)
}
pub fn restore(root: &Path, id: &str) -> Result<(), String> {
    Uuid::parse_str(id).map_err(err)?;
    let dir = metadata(root, &format!("trash/{id}"))?;
    let record_path = metadata(root, &format!("trash/{id}/entry.json"))?;
    metadata(root, &format!("trash/{id}/data"))?;
    let rec: TrashEntry =
        serde_json::from_slice(&fs::read(record_path).map_err(err)?).map_err(err)?;
    let target = safe(root, &rec.path)?;
    if target.exists() {
        return Err("原位置已有同名文件，请先重命名或移动它".into());
    }
    fs::create_dir_all(target.parent().unwrap()).map_err(err)?;
    fs::rename(dir.join("data"), target).map_err(err)?;
    fs::remove_dir_all(dir).map_err(err)
}
pub fn inventory(root: &Path) -> Result<BTreeMap<String, Snapshot>, String> {
    let mut out = BTreeMap::new();
    for e in entries(root)? {
        let s = if e.kind == "folder" {
            Snapshot {
                kind: "folder".into(),
                data: None,
                hash: "folder".into(),
            }
        } else {
            let p = safe(root, &e.path)?;
            if p.metadata().map_err(err)?.len() > MAX_NOTE {
                return Err(format!("{} 超过 8 MB，未同步", e.name));
            }
            let data = fs::read_to_string(p).map_err(err)?;
            Snapshot {
                kind: e.kind,
                data: Some(data.clone()),
                hash: hash(data.as_bytes()),
            }
        };
        out.insert(e.path, s);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_escape_and_symlink() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().canonicalize().unwrap();
        assert!(safe(&root, "../outside").is_err());
        assert!(safe(&root, "/etc/passwd").is_err());
        assert!(safe(&root, ".mindgrove/x").is_err());
        assert!(safe(&root, "a\\b").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/tmp", root.join("link")).unwrap();
            assert!(safe(&root, "link/test").is_err());
        }
    }
    #[test]
    fn create_save_external_change_and_restore() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().canonicalize().unwrap();
        let p = create(&root, "", "数学", "markdown", None).unwrap();
        let n = read(&root, &p).unwrap();
        assert!(n.content.starts_with("# 数学"));
        let updated = write(&root, &p, "# 公式\n\n$x$", &n.hash).unwrap();
        assert_eq!(n.id, updated.id);
        assert!(write(&root, &p, "old", &n.hash).is_err());
        trash(&root, &p).unwrap();
        assert!(!root.join(&p).exists());
        restore(&root, &list_trash(&root).unwrap()[0].id).unwrap();
        assert_eq!(read(&root, &p).unwrap().content, "# 公式\n\n$x$");
    }
    #[test]
    fn rejects_windows_reserved_names_and_metadata_symlinks() {
        assert!(validate_name("CON.md").is_err());
        assert!(validate_relative("folder/bad:name.md").is_err());
        #[cfg(unix)]
        {
            let a = tempfile::tempdir().unwrap();
            let b = tempfile::tempdir().unwrap();
            std::os::unix::fs::symlink(b.path(), a.path().join(META)).unwrap();
            assert!(metadata(a.path(), "sync").is_err());
        }
    }
    #[test]
    fn windows_line_endings_and_uppercase_extensions_keep_identity() {
        let d = tempfile::tempdir().unwrap();
        let id = Uuid::new_v4().to_string();
        let raw = format!("---\r\nmindgrove_id: {id}\r\n---\r\n# Windows\r\n");
        fs::write(d.path().join("Windows.MD"), raw).unwrap();
        let note = read(d.path(), "Windows.MD").unwrap();
        assert_eq!(note.id, id);
        assert_eq!(note.title, "Windows");
        assert_eq!(note.format, "markdown");
        let saved = write(d.path(), "Windows.MD", "# updated", &note.hash).unwrap();
        assert_eq!(saved.id, id);
        assert_eq!(saved.content, "# updated");
    }
}
