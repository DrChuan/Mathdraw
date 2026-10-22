use crate::{
    cos::CosClient,
    vault::{self, err, hash, Snapshot},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};
use uuid::Uuid;

// Revisions are immutable. Concurrent devices never overwrite each other's objects.
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    pub schema_version: u32,
    pub revision: String,
    pub path: String,
    pub parents: Vec<String>,
    pub snapshot: Option<Snapshot>,
    pub device: String,
    pub timestamp: String,
}
#[derive(Clone, Default, Serialize, Deserialize)]
struct Base {
    heads: Vec<String>,
    snapshot: Option<Snapshot>,
}
#[derive(Default, Serialize, Deserialize)]
struct SyncState {
    #[serde(default)]
    records: BTreeMap<String, Revision>,
    #[serde(default)]
    baseline: BTreeMap<String, Base>,
    #[serde(default)]
    outbox: BTreeSet<String>,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub uploaded: usize,
    pub downloaded: usize,
    pub conflicts: usize,
    pub deferred: usize,
    pub last_sync: String,
}
pub trait Remote {
    fn list(&self) -> Result<Vec<String>, String>;
    fn get(&self, key: &str) -> Result<Vec<u8>, String>;
    fn put_record(&self, record: &Revision) -> Result<(), String>;
}
impl Remote for CosClient {
    fn list(&self) -> Result<Vec<String>, String> {
        self.list()
    }
    fn get(&self, key: &str) -> Result<Vec<u8>, String> {
        self.get(key)
    }
    fn put_record(&self, r: &Revision) -> Result<(), String> {
        self.put(
            &self.record_key(&r.path, &r.revision),
            serde_json::to_vec(r).map_err(err)?,
        )
    }
}
fn save(path: &Path, state: &SyncState) -> Result<(), String> {
    vault::atomic_write(path, &serde_json::to_vec(state).map_err(err)?)
}
fn fingerprint(snapshot: &Option<Snapshot>) -> String {
    snapshot
        .as_ref()
        .map(|s| format!("{}:{}", s.kind, s.hash))
        .unwrap_or_else(|| "deleted".into())
}
fn validate(r: &Revision) -> Result<(), String> {
    vault::validate_relative(&r.path)?;
    if r.path.is_empty()
        || r.schema_version != 1
        || r.parents.len() > 100
        || r.revision.len() > 80
        || r.revision.len() < 8
        || !r
            .revision
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("云端存在不支持的同步记录，未改动本地数据".into());
    }
    if let Some(s) = &r.snapshot {
        if s.kind == "folder" {
            if s.data.is_some() {
                return Err("云端目录记录无效".into());
            }
        } else if ["markdown", "mindmap"].contains(&s.kind.as_str()) && vault::is_note(&r.path) {
            let data = s.data.as_ref().ok_or("云端笔记缺少内容")?;
            if data.len() as u64 > vault::MAX_NOTE || hash(data.as_bytes()) != s.hash {
                return Err("云端笔记校验失败，未改动本地数据".into());
            }
        } else {
            return Err("云端笔记类型无效".into());
        }
    }
    Ok(())
}
fn fetch(remote: &impl Remote, state: &mut SyncState) -> Result<(), String> {
    for key in remote.list()? {
        if !key.ends_with(".json") {
            continue;
        }
        let id = key
            .rsplit('/')
            .next()
            .unwrap_or("")
            .trim_end_matches(".json");
        if state.records.contains_key(id) {
            continue;
        }
        let record: Revision = serde_json::from_slice(&remote.get(&key)?)
            .map_err(|_| "云端记录无法读取；请确认同步前缀只供枝间使用")?;
        validate(&record)?;
        if record.revision != id {
            return Err("云端版本 ID 不匹配".into());
        }
        state.records.insert(record.revision.clone(), record);
    }
    Ok(())
}
fn flush(
    remote: &impl Remote,
    path: &Path,
    state: &mut SyncState,
    report: &mut SyncReport,
) -> Result<(), String> {
    save(path, state)?;
    for id in state.outbox.clone() {
        let r = state.records.get(&id).ok_or("待同步版本缺失")?;
        remote.put_record(r)?;
        state.outbox.remove(&id);
        report.uploaded += 1;
    }
    save(path, state)
}
fn insert(state: &mut SyncState, r: Revision) {
    state.outbox.insert(r.revision.clone());
    state.records.insert(r.revision.clone(), r);
}
fn heads(state: &SyncState) -> BTreeMap<String, Vec<Revision>> {
    let parents: BTreeSet<_> = state
        .records
        .values()
        .flat_map(|r| r.parents.iter().cloned())
        .collect();
    let mut out: BTreeMap<String, Vec<Revision>> = BTreeMap::new();
    for r in state.records.values() {
        if !parents.contains(&r.revision) {
            out.entry(r.path.clone()).or_default().push(r.clone());
        }
    }
    out
}
fn conflict_path(path: &str, revision: &str, timestamp: &str, device: &str) -> String {
    let lower = path.to_lowercase();
    let ext = if lower.ends_with(".mindmap.json") {
        ".mindmap.json"
    } else if vault::is_markdown(path) {
        ".md"
    } else {
        ""
    };
    let stamp = chrono::DateTime::parse_from_rfc3339(timestamp)
        .map(|t| t.format("%Y%m%d-%H%M%S").to_string())
        .unwrap_or_else(|_| "unknown".into());
    let device: String = device
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(4)
        .collect();
    let suffix = format!(
        " (冲突-{stamp}-{device}-{}){ext}",
        &revision[..revision.len().min(8)]
    );
    let file = std::path::Path::new(path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy();
    let stem = &file[..file.len() - ext.len()];
    let mut truncated = String::new();
    for c in stem.chars() {
        if truncated.len() + c.len_utf8() + suffix.len() > 240 {
            break;
        }
        truncated.push(c);
    }
    let name = format!("{truncated}{suffix}");
    std::path::Path::new(path)
        .parent()
        .unwrap_or(Path::new(""))
        .join(name)
        .to_string_lossy()
        .replace('\\', "/")
}
fn copy_snapshot(snapshot: &Snapshot, revision: &str) -> Snapshot {
    let mut copy = snapshot.clone();
    if let Some(data) = &copy.data {
        let bytes = hex::decode(&revision[..32]).unwrap_or_else(|_| vec![0; 16]);
        let id = Uuid::from_bytes(bytes.try_into().unwrap_or([0; 16])).to_string();
        let updated = if copy.kind == "markdown" {
            let (old, body) = vault::decode_md(data);
            if old.is_some() {
                format!("---\nmindgrove_id: {id}\n---\n{body}")
            } else {
                data.clone()
            }
        } else if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(data) {
            if value.is_object() {
                value["id"] = id.into();
                value.to_string()
            } else {
                data.clone()
            }
        } else {
            data.clone()
        };
        copy.hash = hash(updated.as_bytes());
        copy.data = Some(updated);
    }
    copy
}
fn current(root: &Path, path: &str) -> Result<Option<Snapshot>, String> {
    let p = vault::safe(root, path)?;
    if !p.exists() {
        return Ok(None);
    }
    if p.is_dir() {
        return Ok(Some(Snapshot {
            kind: "folder".into(),
            data: None,
            hash: "folder".into(),
        }));
    }
    let data = fs::read_to_string(&p).map_err(err)?;
    Ok(Some(Snapshot {
        kind: if vault::is_markdown(path) {
            "markdown"
        } else {
            "mindmap"
        }
        .into(),
        hash: hash(data.as_bytes()),
        data: Some(data),
    }))
}
fn apply(root: &Path, path: &str, snapshot: &Option<Snapshot>) -> Result<bool, String> {
    let p = vault::safe(root, path)?;
    match snapshot {
        Some(s) if s.kind == "folder" => {
            if p.is_file() {
                vault::trash(root, path)?;
            }
            fs::create_dir_all(p).map_err(err)?;
        }
        Some(s) => {
            if p.is_dir() {
                vault::trash(root, path)?;
            }
            vault::atomic_write(&p, s.data.as_ref().ok_or("笔记内容缺失")?.as_bytes())?;
        }
        None => {
            if p.is_file() {
                vault::trash(root, path)?;
            } else if p.is_dir() {
                if fs::read_dir(&p).map_err(err)?.next().is_some() {
                    return Ok(false);
                }
                fs::remove_dir(p).map_err(err)?;
            }
        }
    }
    Ok(true)
}
pub fn run(
    root: &Path,
    remote: &impl Remote,
    profile: &str,
    device: &str,
) -> Result<SyncReport, String> {
    let dir = vault::metadata(root, "sync")?;
    fs::create_dir_all(&dir).map_err(err)?;
    let state_path = vault::metadata(root, &format!("sync/{profile}.json"))?;
    let mut state: SyncState = if state_path.exists() {
        serde_json::from_slice(&fs::read(&state_path).map_err(err)?)
            .map_err(|_| "本地同步记录损坏，请备份笔记库后联系支持")?
    } else {
        SyncState::default()
    };
    let mut report = SyncReport::default();
    fetch(remote, &mut state)?;
    let captured = vault::inventory(root)?;
    let paths: BTreeSet<_> = captured
        .keys()
        .chain(state.baseline.keys())
        .cloned()
        .collect();
    for path in paths {
        let local = captured.get(&path).cloned();
        let base = state.baseline.get(&path).cloned().unwrap_or_default();
        if fingerprint(&local) == fingerprint(&base.snapshot) {
            continue;
        }
        let r = Revision {
            schema_version: 1,
            revision: Uuid::new_v4().to_string(),
            path: path.clone(),
            parents: base.heads,
            snapshot: local.clone(),
            device: device.into(),
            timestamp: chrono::Utc::now().to_rfc3339(),
        };
        state.baseline.insert(
            path,
            Base {
                heads: vec![r.revision.clone()],
                snapshot: local,
            },
        );
        insert(&mut state, r);
    }
    flush(remote, &state_path, &mut state, &mut report)?;
    fetch(remote, &mut state)?;
    // Merge divergent heads deterministically; losing live contents become ordinary notes.
    for (path, mut versions) in heads(&state) {
        if versions.len() < 2 {
            continue;
        }
        versions.sort_by(|a, b| {
            (a.snapshot.is_some(), &a.timestamp, &a.revision).cmp(&(
                b.snapshot.is_some(),
                &b.timestamp,
                &b.revision,
            ))
        });
        let winner = versions.last().unwrap().clone();
        let mut seen = BTreeSet::new();
        seen.insert(fingerprint(&winner.snapshot));
        let mut parents: Vec<_> = versions.iter().map(|r| r.revision.clone()).collect();
        parents.sort();
        for other in &versions {
            if let Some(s) = &other.snapshot {
                if s.kind != "folder" && seen.insert(fingerprint(&other.snapshot)) {
                    let new_path =
                        conflict_path(&path, &other.revision, &other.timestamp, &other.device);
                    let id = hash(format!("copy|{path}|{}", other.revision).as_bytes());
                    if !state.records.contains_key(&id) {
                        let copied = copy_snapshot(s, &id);
                        insert(
                            &mut state,
                            Revision {
                                schema_version: 1,
                                revision: id,
                                path: new_path,
                                parents: vec![],
                                snapshot: Some(copied),
                                device: "conflict-copy".into(),
                                timestamp: winner.timestamp.clone(),
                            },
                        );
                        report.conflicts += 1;
                    }
                }
            }
        }
        let id = hash(format!("merge|{path}|{}", parents.join("|")).as_bytes());
        insert(
            &mut state,
            Revision {
                schema_version: 1,
                revision: id,
                path,
                parents,
                snapshot: winner.snapshot,
                device: "merge".into(),
                timestamp: winner.timestamp,
            },
        );
    }
    flush(remote, &state_path, &mut state, &mut report)?;
    let mut final_heads: Vec<_> = heads(&state).into_iter().collect();
    let mut names = BTreeMap::new();
    for (path, versions) in &final_heads {
        if versions.iter().any(|r| r.snapshot.is_some()) {
            if let Some(existing) = names.insert(path.to_lowercase(), path.clone()) {
                return Err(format!("云端存在仅大小写不同的路径：{existing} 与 {path}。请在原电脑重命名其中一项后同步。"));
            }
        }
    }
    // Create directories first, then files; remove children before parent directories.
    final_heads.sort_by_key(|(p, v)| {
        let snapshot = &v[0].snapshot;
        (
            if snapshot.is_none() {
                2
            } else if snapshot.as_ref().is_some_and(|s| s.kind == "folder") {
                0
            } else {
                1
            },
            if snapshot.is_none() {
                usize::MAX - p.matches('/').count()
            } else {
                p.matches('/').count()
            },
        )
    });
    for (path, versions) in final_heads {
        if versions.len() != 1 {
            report.deferred += 1;
            continue;
        }
        let r = &versions[0];
        let actual = current(root, &path)?;
        if fingerprint(&actual) != fingerprint(&captured.get(&path).cloned()) {
            report.deferred += 1;
            continue;
        }
        if fingerprint(&actual) != fingerprint(&r.snapshot) {
            if !apply(root, &path, &r.snapshot)? {
                report.deferred += 1;
                continue;
            }
            report.downloaded += 1;
        }
        state.baseline.insert(
            path,
            Base {
                heads: vec![r.revision.clone()],
                snapshot: r.snapshot.clone(),
            },
        );
    }
    // Ancestor contents are already immutable in COS; retain their hashes and graph only.
    let ancestors: BTreeSet<_> = state
        .records
        .values()
        .flat_map(|r| r.parents.iter().cloned())
        .collect();
    for id in ancestors {
        if !state.outbox.contains(&id) {
            if let Some(s) = state.records.get_mut(&id).and_then(|r| r.snapshot.as_mut()) {
                s.data = None;
            }
        }
    }
    save(&state_path, &state)?;
    report.last_sync = chrono::Utc::now().to_rfc3339();
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    #[derive(Default)]
    struct Memory {
        data: RefCell<BTreeMap<String, Vec<u8>>>,
        fail: Cell<bool>,
    }
    impl Remote for Memory {
        fn list(&self) -> Result<Vec<String>, String> {
            Ok(self.data.borrow().keys().cloned().collect())
        }
        fn get(&self, key: &str) -> Result<Vec<u8>, String> {
            self.data.borrow().get(key).cloned().ok_or("missing".into())
        }
        fn put_record(&self, r: &Revision) -> Result<(), String> {
            if self.fail.get() {
                return Err("offline".into());
            }
            self.data.borrow_mut().insert(
                format!("{}.json", r.revision),
                serde_json::to_vec(r).unwrap(),
            );
            Ok(())
        }
    }
    #[test]
    fn two_devices_preserve_conflict_and_deletion() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let remote = Memory::default();
        vault::create(a.path(), "", "note", "markdown", Some("base")).unwrap();
        run(a.path(), &remote, "test", "A").unwrap();
        run(b.path(), &remote, "test", "B").unwrap();
        fs::write(a.path().join("note.md"), "A edit").unwrap();
        fs::write(b.path().join("note.md"), "B edit").unwrap();
        run(a.path(), &remote, "test", "A").unwrap();
        let report = run(b.path(), &remote, "test", "B").unwrap();
        assert_eq!(report.conflicts, 1);
        run(a.path(), &remote, "test", "A").unwrap();
        let content: Vec<_> = vault::inventory(a.path())
            .unwrap()
            .values()
            .filter_map(|s| s.data.clone())
            .collect();
        assert!(content.contains(&"A edit".into()));
        assert!(content.contains(&"B edit".into()));
        fs::remove_file(a.path().join("note.md")).unwrap();
        run(a.path(), &remote, "test", "A").unwrap();
        run(b.path(), &remote, "test", "B").unwrap();
        assert!(!b.path().join("note.md").exists());
        assert!(!vault::list_trash(b.path()).unwrap().is_empty());
    }
    #[test]
    fn first_sync_keeps_existing_different_local_file() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let r = Memory::default();
        fs::write(a.path().join("x.md"), "one").unwrap();
        fs::write(b.path().join("x.md"), "two").unwrap();
        run(a.path(), &r, "test", "A").unwrap();
        run(b.path(), &r, "test", "B").unwrap();
        assert_eq!(vault::inventory(b.path()).unwrap().len(), 2);
    }
    #[test]
    fn upload_failure_survives_restart_and_further_edits() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let r = Memory::default();
        fs::write(a.path().join("x.md"), "one").unwrap();
        r.fail.set(true);
        assert!(run(a.path(), &r, "test", "A").is_err());
        fs::write(a.path().join("x.md"), "two").unwrap();
        r.fail.set(false);
        run(a.path(), &r, "test", "A").unwrap();
        run(b.path(), &r, "test", "B").unwrap();
        assert_eq!(fs::read_to_string(b.path().join("x.md")).unwrap(), "two");
        assert_eq!(vault::inventory(b.path()).unwrap().len(), 1);
    }
    #[test]
    fn deletion_never_discards_an_offline_edit() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let r = Memory::default();
        fs::write(a.path().join("x.md"), "base").unwrap();
        run(a.path(), &r, "test", "A").unwrap();
        run(b.path(), &r, "test", "B").unwrap();
        fs::remove_file(a.path().join("x.md")).unwrap();
        run(a.path(), &r, "test", "A").unwrap();
        fs::write(b.path().join("x.md"), "offline edit").unwrap();
        run(b.path(), &r, "test", "B").unwrap();
        run(a.path(), &r, "test", "A").unwrap();
        assert_eq!(
            fs::read_to_string(a.path().join("x.md")).unwrap(),
            "offline edit"
        );
    }
}
