use crate::vault::{err, hash};
use chrono::Utc;
use hmac::{Hmac, Mac};
use reqwest::{blocking::Client, Method};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::time::Duration;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CosConfig {
    pub access_key_id: String,
    pub region: String,
    pub bucket: String,
    pub prefix: String,
    pub auto_sync: bool,
}
impl CosConfig {
    pub fn validate(&self) -> Result<(), String> {
        if self.access_key_id.trim().is_empty()
            || self.access_key_id.chars().any(char::is_whitespace)
        {
            return Err("请填写有效的 AccessKey ID".into());
        }
        if self.region.is_empty()
            || !self
                .region
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        {
            return Err("地域格式应类似 ap-guangzhou".into());
        }
        if self.bucket.is_empty()
            || !self
                .bucket
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        {
            return Err("请填写完整存储桶名（含 APPID 后缀）".into());
        }
        if self.prefix.trim_matches('/').is_empty()
            || self.prefix.contains("..")
            || self.prefix.contains('\\')
            || self.prefix.chars().any(char::is_control)
        {
            return Err("请填写专用同步前缀，例如 mindgrove/personal".into());
        }
        Ok(())
    }
    pub fn profile(&self) -> String {
        hash(
            format!(
                "{}|{}|{}",
                self.bucket,
                self.region,
                self.prefix.trim_matches('/')
            )
            .as_bytes(),
        )
    }
    fn account(&self) -> String {
        hash(
            format!(
                "{}|{}|{}|{}",
                self.region,
                self.bucket,
                self.prefix.trim_matches('/'),
                self.access_key_id
            )
            .as_bytes(),
        )
    }
    pub fn get_secret(&self) -> Result<String, String> {
        keyring::Entry::new("lab.chuan.mindgrove.cos", &self.account())
            .map_err(err)?
            .get_password()
            .map_err(|_| "未找到系统凭据，请在同步设置中重新填写 SecretAccessKey".into())
    }
    pub fn set_secret(&self, secret: &str) -> Result<(), String> {
        if secret.trim().is_empty() {
            return Err("SecretAccessKey 不能为空".into());
        }
        keyring::Entry::new("lab.chuan.mindgrove.cos", &self.account())
            .map_err(err)?
            .set_password(secret.trim())
            .map_err(|e| format!("系统凭据保存失败：{e}"))
    }
    pub fn forget_secret(&self) -> Result<(), String> {
        match keyring::Entry::new("lab.chuan.mindgrove.cos", &self.account())
            .map_err(err)?
            .delete_credential()
        {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(err(e)),
        }
    }
}
pub struct CosClient {
    config: CosConfig,
    secret: String,
    http: Client,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ListedObject {
    key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Listing {
    #[serde(default)]
    contents: Vec<ListedObject>,
    #[serde(default)]
    is_truncated: bool,
    next_marker: Option<String>,
}
fn mac(key: &[u8], data: &str) -> Vec<u8> {
    let mut m = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts any key");
    m.update(data.as_bytes());
    m.finalize().into_bytes().to_vec()
}
pub fn encode(value: &str, slash: bool) -> String {
    let mut out = String::new();
    for b in value.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) || (slash && b == b'/') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}
impl CosClient {
    pub fn new(config: CosConfig) -> Result<Self, String> {
        config.validate()?;
        let secret = config.get_secret()?;
        let http = Client::builder()
            .timeout(Duration::from_secs(45))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(err)?;
        Ok(Self {
            config,
            secret,
            http,
        })
    }
    fn request(
        &self,
        method: Method,
        key: &str,
        query: Vec<(&str, String)>,
        body: Vec<u8>,
    ) -> Result<Vec<u8>, String> {
        let host = format!(
            "{}.cos.{}.myqcloud.com",
            self.config.bucket, self.config.region
        );
        let path = format!("/{}", encode(key, true));
        let mut pairs: Vec<_> = query
            .into_iter()
            .map(|(k, v)| (encode(k, false), encode(&v, false)))
            .collect();
        pairs.sort();
        let qs = pairs
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("&");
        let now = Utc::now();
        let date = now.format("%Y%m%d").to_string();
        let timestamp = now.format("%Y%m%dT%H%M%SZ").to_string();
        let payload = hash(&body);
        let headers =
            format!("host:{host}\nx-amz-content-sha256:{payload}\nx-amz-date:{timestamp}\n");
        let signed = "host;x-amz-content-sha256;x-amz-date";
        let canonical = format!(
            "{}\n{path}\n{qs}\n{headers}\n{signed}\n{payload}",
            method.as_str()
        );
        let scope = format!("{date}/{}/s3/aws4_request", self.config.region);
        let to_sign = format!(
            "AWS4-HMAC-SHA256\n{timestamp}\n{scope}\n{}",
            hash(canonical.as_bytes())
        );
        let kdate = mac(format!("AWS4{}", self.secret).as_bytes(), &date);
        let kregion = mac(&kdate, &self.config.region);
        let kservice = mac(&kregion, "s3");
        let ksign = mac(&kservice, "aws4_request");
        let signature = hex::encode(mac(&ksign, &to_sign));
        let auth = format!(
            "AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed}, Signature={signature}",
            self.config.access_key_id
        );
        let url = format!(
            "https://{host}{path}{}",
            if qs.is_empty() {
                String::new()
            } else {
                format!("?{qs}")
            }
        );
        let response = self
            .http
            .request(method, url)
            .header("x-amz-date", timestamp)
            .header("x-amz-content-sha256", payload)
            .header("authorization", auth)
            .header("content-type", "application/json")
            .body(body)
            .send()
            .map_err(|e| {
                if e.is_timeout() {
                    "COS 请求超时，本地内容已保留，稍后可重试".into()
                } else {
                    "无法连接 COS，请检查网络、存储桶和地域设置".to_string()
                }
            })?;
        let status = response.status();
        let limit = crate::vault::MAX_NOTE * 6 + 65536;
        if response.content_length().is_some_and(|n| n > limit) {
            return Err("云端单条记录过大，未读取".into());
        }
        let mut bytes = Vec::new();
        use std::io::Read;
        response
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(err)?;
        if bytes.len() as u64 > limit {
            return Err("云端单条记录过大，未读取".into());
        }
        if !status.is_success() {
            #[derive(Deserialize)]
            #[serde(rename_all = "PascalCase")]
            struct ErrorBody {
                code: Option<String>,
                message: Option<String>,
            }
            let detail = quick_xml::de::from_reader::<_, ErrorBody>(bytes.as_slice())
                .ok()
                .map(|e| {
                    format!(
                        "{} {}",
                        e.code.unwrap_or_default(),
                        e.message.unwrap_or_default()
                    )
                })
                .unwrap_or_default();
            return Err(format!(
                "COS 返回 {}：{}",
                status.as_u16(),
                detail.chars().take(250).collect::<String>()
            ));
        }
        Ok(bytes)
    }
    pub fn list(&self) -> Result<Vec<String>, String> {
        let prefix = format!("{}/records/", self.config.prefix.trim_matches('/'));
        let mut out = vec![];
        let mut marker: Option<String> = None;
        loop {
            let mut q = vec![("prefix", prefix.clone()), ("max-keys", "1000".into())];
            if let Some(t) = &marker {
                q.push(("marker", t.clone()));
            }
            let bytes = self.request(Method::GET, "", q, vec![])?;
            let listing: Listing = quick_xml::de::from_reader(bytes.as_slice())
                .map_err(|e| format!("COS 列表响应无法解析：{e}"))?;
            let next = listing
                .next_marker
                .filter(|s| !s.is_empty())
                .or_else(|| listing.contents.last().map(|o| o.key.clone()));
            out.extend(listing.contents.into_iter().map(|o| o.key));
            if out.len() > 50000 {
                return Err("同步版本超过 50,000 条，请使用新的同步前缀整理笔记库".into());
            }
            if !listing.is_truncated {
                break;
            }
            let next = next.ok_or("COS 分页响应缺少 marker")?;
            if marker.as_ref().is_some_and(|m| m >= &next) {
                return Err("COS 列表分页没有推进，已停止同步".into());
            }
            marker = Some(next);
        }
        Ok(out)
    }
    pub fn get(&self, key: &str) -> Result<Vec<u8>, String> {
        self.request(Method::GET, key, vec![], vec![])
    }
    pub fn put(&self, key: &str, data: Vec<u8>) -> Result<(), String> {
        self.request(Method::PUT, key, vec![], data).map(|_| ())
    }
    pub fn record_key(&self, path: &str, revision: &str) -> String {
        format!(
            "{}/records/{}/{}.json",
            self.config.prefix.trim_matches('/'),
            hash(path.as_bytes()),
            revision
        )
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encoding() {
        assert_eq!(encode("a b/数学.md", true), "a%20b/%E6%95%B0%E5%AD%A6.md");
        assert_eq!(encode("a/b", false), "a%2Fb");
    }
    #[test]
    fn reads_cos_marker_pagination() {
        let xml = r#"<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>true</IsTruncated><NextMarker>prefix/b.json</NextMarker><Contents><Key>prefix/a.json</Key></Contents><Contents><Key>prefix/b.json</Key></Contents></ListBucketResult>"#;
        let page: Listing = quick_xml::de::from_str(xml).unwrap();
        assert!(page.is_truncated);
        assert_eq!(page.contents.len(), 2);
        assert_eq!(page.next_marker.as_deref(), Some("prefix/b.json"));
        let empty: Listing = quick_xml::de::from_str(
            "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>",
        )
        .unwrap();
        assert!(empty.contents.is_empty());
    }
    #[test]
    fn rejects_invalid_settings_without_network_or_keychain() {
        let c = CosConfig {
            access_key_id: "test".into(),
            region: "ap-guangzhou/evil".into(),
            bucket: "notes-123".into(),
            prefix: "personal".into(),
            auto_sync: false,
        };
        assert!(c.validate().is_err());
    }
}
