//! AnkiBase's HTTP API for Anki, answered from the collection on the phone.

use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::engine::{Engine, Failure, Outcome, StudyHidden};
use crate::http::{mime_type, Reply, Request};

#[derive(Deserialize)]
struct ReviewRequest {
    deck: String,
    card_id: Option<i64>,
    ease: Option<u8>,
}

#[derive(Deserialize)]
struct LoginRequest {
    email: String,
    password: String,
    /// A self-hosted sync server instead of AnkiWeb.
    endpoint: Option<String>,
}

#[derive(Deserialize)]
struct DeckName {
    deck_name: String,
}

#[derive(Deserialize)]
struct Rename {
    old_name: String,
    new_name: String,
}

#[derive(Deserialize)]
struct Fields {
    fields: Map<String, Value>,
}

#[derive(Deserialize)]
struct Rollover {
    hour: u32,
}

#[derive(Deserialize)]
struct FrontBack {
    front: String,
    back: String,
}

fn body<'a, T: Deserialize<'a>>(data: &'a [u8]) -> Outcome<T> {
    serde_json::from_slice(data).map_err(|e| Failure::new(422, e.to_string()))
}

pub fn failure(failure: Failure) -> Reply {
    Reply::error(failure.status, failure.detail)
}

/// Answer `request` if it's one of Anki's; None sends it on (to the AnkiBase server).
pub fn handle(engine: &mut Engine, request: &Request) -> Option<Reply> {
    let segments = request.segments("/api/")?;
    let segments: Vec<&str> = segments.iter().map(String::as_str).collect();
    let data = request.body.as_slice();
    let query = |key: &str| request.query(key).unwrap_or_default();

    let result: Outcome<Value> = match (request.method.as_str(), segments.as_slice()) {
        ("GET", ["decks"]) => engine.decks(),
        ("GET", ["decks", "names"]) => engine.deck_names().map(|names| json!({"decks": names})),
        ("GET", ["decks", deck, "words"]) => {
            let limit = query("limit").parse().unwrap_or(500).min(5000);
            engine.deck_words(deck, limit, &query("field"))
        }
        ("POST", ["decks", "delete"]) => body::<DeckName>(data).and_then(|r| engine.delete_deck(&r.deck_name)),
        ("POST", ["decks", "rename"]) => body::<Rename>(data).and_then(|r| engine.rename_deck(&r.old_name, &r.new_name)),
        ("POST", ["review", "current"]) => body::<ReviewRequest>(data).and_then(|r| engine.current(&r.deck)),
        ("POST", ["review", "answer"]) => body::<ReviewRequest>(data).and_then(|r| match (r.card_id, r.ease) {
            (Some(card_id), Some(ease)) => engine.answer(&r.deck, card_id, ease),
            _ => Err(Failure::new(400, "card_id and ease (1-4) required")),
        }),
        ("POST", ["review", "undo"]) => body::<ReviewRequest>(data).and_then(|r| engine.undo(&r.deck)),
        ("GET", ["media-file", name]) => {
            return Some(match engine.media_file(name) {
                Ok(bytes) => media_reply(name, bytes, request.header("range")),
                Err(err) => failure(err),
            });
        }
        ("GET", ["media", name]) => engine.media_base64(name),
        ("GET", ["cards", id]) if id.parse::<i64>().is_ok() => engine.card_info(id.parse().unwrap()),
        ("PUT", ["notes", id, "fields"]) => match id.parse::<i64>() {
            Ok(id) => body::<Fields>(data).and_then(|r| engine.update_note_fields(id, &r.fields)),
            Err(_) => Err(Failure::new(400, "Invalid note id")),
        },
        ("POST", ["notes", "basic"]) => {
            body::<FrontBack>(data).and_then(|r| engine.add_basic_note(&query("deck"), &r.front, &r.back))
        }
        ("POST", ["import"]) => match multipart_file(request) {
            Some((name, bytes)) => engine.import_package(&name, &bytes),
            None => Err(Failure::new(400, "Send the .apkg file as multipart form data (field \"file\")")),
        },
        ("POST", ["sync"]) => engine
            .sync()
            .map(|outcome| json!({"success": true, "message": "Sync completed", "outcome": outcome})),
        ("POST", ["sync", "full-download"]) => engine.full_sync(false).map(|_| {
            json!({"success": true, "message": "Full download completed - local data overwritten with AnkiWeb"})
        }),
        ("POST", ["sync", "full-upload"]) => engine.full_sync(true).map(|_| {
            json!({"success": true, "message": "Full upload completed - AnkiWeb overwritten with local data"})
        }),
        ("GET", ["sync", "media"]) => Ok(engine.media_status()),
        ("POST", ["ankiweb", "login"]) => body::<LoginRequest>(data)
            .and_then(|r| engine.login(r.email.trim(), &r.password, r.endpoint.filter(|e| !e.trim().is_empty())))
            .map(|_| json!({"success": true, "message": "Logged in"})),
        ("GET", ["ankiweb", "status"]) => Ok(engine.status()),
        ("DELETE", ["ankiweb", "credentials"]) => engine.logout().map(|_| json!({"success": true})),
        // Anki's "Next day starts at" (Settings → Study).
        ("GET", ["collection", "rollover"]) => engine.rollover().map(|hour| json!({"hour": hour})),
        ("PUT", ["collection", "rollover"]) => body::<Rollover>(data)
            .and_then(|r| engine.set_rollover(r.hour).map(|_| json!({"hour": r.hour}))),
        // "Show in Study": what's hidden from Study, synced with the collection.
        ("GET", ["collection", "study-hidden"]) => engine.study_hidden().map(|hidden| json!({"hidden": hidden})),
        ("PUT", ["collection", "study-hidden"]) => body::<StudyHidden>(data)
            .and_then(|hidden| engine.set_study_hidden(&hidden).map(|_| json!({"hidden": hidden}))),
        _ => return None,
    };
    Some(match result {
        Ok(value) => Reply::ok(value),
        Err(err) => failure(err),
    })
}

/// The `file` field of a multipart/form-data body: (file name, contents).
fn multipart_file(request: &Request) -> Option<(String, Vec<u8>)> {
    let content_type = request.header("content-type")?;
    let boundary = content_type
        .split(';')
        .map(str::trim)
        .find_map(|p| p.strip_prefix("boundary="))?
        .trim_matches('"');
    let delimiter = format!("--{boundary}").into_bytes();
    let body = &request.body;
    let mut start = find(body, &delimiter, 0)? + delimiter.len();
    loop {
        let end = find(body, &delimiter, start)?;
        // Each part: CRLF, headers, CRLF CRLF, contents, CRLF.
        let part = &body[start..end];
        let part = part.strip_prefix(b"\r\n").unwrap_or(part);
        if let Some(split) = find(part, b"\r\n\r\n", 0) {
            let headers = String::from_utf8_lossy(&part[..split]);
            let contents = &part[split + 4..];
            let contents = contents.strip_suffix(b"\r\n").unwrap_or(contents);
            let disposition = headers
                .lines()
                .find(|l| l.to_ascii_lowercase().starts_with("content-disposition"))
                .unwrap_or_default();
            let param = |key: &str| {
                disposition.split(';').map(str::trim).find_map(|p| {
                    p.strip_prefix(&format!("{key}=")).map(|v| v.trim_matches('"').to_string())
                })
            };
            if param("name").as_deref() == Some("file") {
                return Some((param("filename").unwrap_or_else(|| "deck.apkg".into()), contents.to_vec()));
            }
        }
        start = end + delimiter.len();
        if body[start..].starts_with(b"--") {
            return None;
        }
    }
}

fn find(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    haystack.get(from..)?.windows(needle.len()).position(|w| w == needle).map(|i| i + from)
}

/// A collection media file. WebKit's media player (card audio and video) reads files in byte
/// ranges and gives up without them ("AudioVideoRenderer… destroyed"): a `Range` gets just
/// those bytes (206), and every answer says its length and that ranges work.
pub fn media_reply(name: &str, bytes: Vec<u8>, range: Option<&str>) -> Reply {
    let total = bytes.len();
    let reply = |status: u16, body: Vec<u8>| {
        let length = body.len().to_string();
        Reply::new(status, mime_type(name), body)
            .with_header("Cache-Control", "max-age=3600")
            // Card media is from anywhere: a file opened on its own can't run scripts.
            .with_header("Content-Security-Policy", "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'")
            .with_header("Accept-Ranges", "bytes")
            .with_header("Content-Length", &length)
    };
    let Some(range) = range else { return reply(200, bytes) };
    match byte_range(range, total) {
        Some((start, end)) => reply(206, bytes[start..=end].to_vec())
            .with_header("Content-Range", &format!("bytes {start}-{end}/{total}")),
        None => Reply::new(416, "text/plain", Vec::new()).with_header("Content-Range", &format!("bytes */{total}")),
    }
}

/// `bytes=a-b`, `bytes=a-` or `bytes=-n` as first and last byte, within `total`.
fn byte_range(header: &str, total: usize) -> Option<(usize, usize)> {
    let spec = header.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
    let (from, to) = spec.split_once('-')?;
    if total == 0 {
        return None;
    }
    let (start, end) = match (from.trim(), to.trim()) {
        ("", n) => {
            let n: usize = n.parse().ok()?;
            (total.saturating_sub(n), total - 1)
        }
        (a, "") => (a.parse().ok()?, total - 1),
        (a, b) => (a.parse().ok()?, b.parse::<usize>().ok()?.min(total - 1)),
    };
    (start <= end && start < total).then_some((start, end))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_ranges() {
        assert_eq!(byte_range("bytes=0-1", 10), Some((0, 1)));
        assert_eq!(byte_range("bytes=4-", 10), Some((4, 9)));
        assert_eq!(byte_range("bytes=-3", 10), Some((7, 9)));
        assert_eq!(byte_range("bytes=5-99", 10), Some((5, 9)));
        assert_eq!(byte_range("bytes=10-", 10), None);
        assert_eq!(byte_range("bytes=0-1", 0), None);
        let r = media_reply("a.mp3", b"0123456789".to_vec(), Some("bytes=0-1"));
        assert_eq!((r.status, r.body.as_slice()), (206, &b"01"[..]));
        let header = |r: &Reply, n: &str| r.headers.iter().find(|(k, _)| k == n).map(|(_, v)| v.clone());
        assert_eq!(header(&r, "Content-Range").as_deref(), Some("bytes 0-1/10"));
        assert_eq!(header(&r, "Content-Length").as_deref(), Some("2"));
        let full = media_reply("a.mp3", b"0123456789".to_vec(), None);
        assert_eq!((full.status, header(&full, "Accept-Ranges").as_deref()), (200, Some("bytes")));
        assert_eq!(media_reply("a.mp3", b"01".to_vec(), Some("bytes=5-")).status, 416);
    }
}
