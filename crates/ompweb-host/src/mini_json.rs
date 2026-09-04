//! Minimal zero-dependency JSON parser for session JSONL shadow reads
//! (doc 15 R6/R7). Keeps the crates offline-buildable; only the subset
//! needed to walk omp session lines is implemented, with strict error
//! propagation so malformed lines surface instead of silently mis-parsing.

#[derive(Debug, Clone, PartialEq)]
pub enum JsonValue {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<JsonValue>),
    Obj(Vec<(String, JsonValue)>),
}
/// Maximum container nesting depth (objects/arrays). Bounds parser recursion
/// so hostile input cannot overflow the connection thread stack.
const MAX_JSON_DEPTH: usize = 64;

impl JsonValue {
    /// Parse a complete JSON document. Rejects trailing garbage.
    pub fn parse(input: &str) -> Result<JsonValue, String> {
        let mut p = Parser {
            bytes: input.as_bytes(),
            pos: 0,
        };
        p.skip_ws();
        let value = p.parse_value()?;
        p.skip_ws();
        if p.pos != p.bytes.len() {
            return Err(format!("trailing data at byte {}", p.pos));
        }
        Ok(value)
    }

    /// Navigate a dotted path (e.g. ["message", "role"]). Missing → None.
    pub fn get(&self, path: &[&str]) -> Option<&JsonValue> {
        let mut current = self;
        for key in path {
            match current {
                JsonValue::Obj(entries) => {
                    current = entries.iter().find(|(k, _)| k == key).map(|(_, v)| v)?;
                }
                _ => return None,
            }
        }
        Some(current)
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            JsonValue::Str(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            JsonValue::Bool(b) => Some(*b),
            _ => None,
        }
    }

    pub fn as_num(&self) -> Option<f64> {
        match self {
            JsonValue::Num(n) => Some(*n),
            _ => None,
        }
    }
}

struct Parser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn skip_ws(&mut self) {
        while self.pos < self.bytes.len()
            && matches!(self.bytes[self.pos], b' ' | b'\t' | b'\n' | b'\r')
        {
            self.pos += 1;
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    /// Nesting cap: input is attacker-visible over local IPC pre-auth, and
    /// unbounded recursion would overflow the connection thread's stack on a
    /// ≤1MiB line of nested brackets, aborting the host (kills every session).
    fn parse_value(&mut self) -> Result<JsonValue, String> {
        self.parse_value_at(0)
    }

    fn parse_value_at(&mut self, depth: usize) -> Result<JsonValue, String> {
        if depth > MAX_JSON_DEPTH {
            return Err(format!("nesting too deep at byte {}", self.pos));
        }
        self.skip_ws();
        match self.peek() {
            Some(b'{') => self.parse_object_at(depth),
            Some(b'[') => self.parse_array_at(depth),
            Some(b'"') => Ok(JsonValue::Str(self.parse_string()?)),
            Some(b't') => self.parse_literal("true", JsonValue::Bool(true)),
            Some(b'f') => self.parse_literal("false", JsonValue::Bool(false)),
            Some(b'n') => self.parse_literal("null", JsonValue::Null),
            Some(c) if c == b'-' || c.is_ascii_digit() => self.parse_number(),
            other => Err(format!(
                "unexpected char {:?} at byte {}",
                other.map(|c| c as char),
                self.pos
            )),
        }
    }

    fn parse_literal(&mut self, lit: &str, value: JsonValue) -> Result<JsonValue, String> {
        for (i, expected) in lit.bytes().enumerate() {
            match self.bytes.get(self.pos + i) {
                Some(b) if *b == expected => {}
                _ => return Err(format!("bad literal at byte {}", self.pos)),
            }
        }
        self.pos += lit.len();
        Ok(value)
    }

    fn parse_string(&mut self) -> Result<String, String> {
        // Opening quote already consumed by caller? No: consume here.
        if self.peek() != Some(b'"') {
            return Err("expected string".into());
        }
        self.pos += 1;
        let mut out = String::new();
        loop {
            let c = *self.bytes.get(self.pos).ok_or("unterminated string")?;
            self.pos += 1;
            match c {
                b'"' => return Ok(out),
                b'\\' => {
                    let esc = *self.bytes.get(self.pos).ok_or("unterminated escape")?;
                    self.pos += 1;
                    match esc {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\u{0008}'),
                        b'f' => out.push('\u{000C}'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'u' => {
                            let hex = self
                                .bytes
                                .get(self.pos..self.pos + 4)
                                .ok_or("bad unicode escape")?;
                            let code = u32::from_str_radix(
                                std::str::from_utf8(hex).map_err(|e| e.to_string())?,
                                16,
                            )
                            .map_err(|e| e.to_string())?;
                            self.pos += 4;
                            out.push(char::from_u32(code).unwrap_or('\u{FFFD}'));
                        }
                        other => return Err(format!("bad escape \\{}", other as char)),
                    }
                }
                _ => {
                    // UTF-8 continuation bytes pass through as-is.
                    let start = self.pos - 1;
                    let mut len = 1;
                    if c >= 0xF0 {
                        len = 4;
                    } else if c >= 0xE0 {
                        len = 3;
                    } else if c >= 0xC0 {
                        len = 2;
                    }
                    let slice = self
                        .bytes
                        .get(start..start + len)
                        .ok_or("truncated utf-8")?;
                    let text = std::str::from_utf8(slice).map_err(|e| e.to_string())?;
                    out.push_str(text);
                    self.pos = start + len;
                }
            }
        }
    }

    fn parse_number(&mut self) -> Result<JsonValue, String> {
        let start = self.pos;
        while self.pos < self.bytes.len()
            && matches!(
                self.bytes[self.pos],
                b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E'
            )
        {
            self.pos += 1;
        }
        let text = std::str::from_utf8(&self.bytes[start..self.pos]).map_err(|e| e.to_string())?;
        text.parse::<f64>()
            .map(JsonValue::Num)
            .map_err(|e| format!("bad number {text}: {e}"))
    }

    fn parse_object_at(&mut self, depth: usize) -> Result<JsonValue, String> {
        self.pos += 1; // consume {
        let mut entries = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Ok(JsonValue::Obj(entries));
        }
        loop {
            self.skip_ws();
            let key = self.parse_string()?;
            self.skip_ws();
            if self.peek() != Some(b':') {
                return Err(format!("expected ':' at byte {}", self.pos));
            }
            self.pos += 1;
            let value = self.parse_value_at(depth + 1)?;
            entries.push((key, value));
            self.skip_ws();
            match self.peek() {
                Some(b',') => {
                    self.pos += 1;
                }
                Some(b'}') => {
                    self.pos += 1;
                    return Ok(JsonValue::Obj(entries));
                }
                _ => return Err(format!("expected ',' or '}}' at byte {}", self.pos)),
            }
        }
    }

    fn parse_array_at(&mut self, depth: usize) -> Result<JsonValue, String> {
        self.pos += 1; // consume [
        let mut items = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Ok(JsonValue::Arr(items));
        }
        loop {
            let value = self.parse_value_at(depth + 1)?;
            items.push(value);
            self.skip_ws();
            match self.peek() {
                Some(b',') => {
                    self.pos += 1;
                }
                Some(b']') => {
                    self.pos += 1;
                    return Ok(JsonValue::Arr(items));
                }
                _ => return Err(format!("expected ',' or ']' at byte {}", self.pos)),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_ok(input: &str) -> JsonValue {
        JsonValue::parse(input).unwrap_or_else(|e| panic!("parse failed for {input}: {e}"))
    }

    #[test]
    fn parses_omp_session_line() {
        let v = parse_ok(
            r#"{"type":"message","id":"a1b2","parentId":null,"timestamp":"2026-08-31T00:00:00Z","message":{"role":"user","content":"hello"}}"#,
        );
        assert_eq!(v.get(&["type"]).unwrap().as_str(), Some("message"));
        assert_eq!(v.get(&["id"]).unwrap().as_str(), Some("a1b2"));
        assert_eq!(v.get(&["message", "role"]).unwrap().as_str(), Some("user"));
        assert_eq!(
            v.get(&["message", "content"]).unwrap().as_str(),
            Some("hello")
        );
        assert_eq!(v.get(&["missing"]), None);
    }

    #[test]
    fn parses_title_slot_and_arrays() {
        let v = parse_ok(r#"{"type":"title","v":1,"title":"demo","pad":"   "}"#);
        assert_eq!(v.get(&["v"]), Some(&JsonValue::Num(1.0)));
        let arr = parse_ok(r#"{"blocks":[{"type":"text","text":"x"},{"type":"image"}]}"#);
        assert_eq!(arr.get(&["blocks"]).unwrap().as_str(), None); // it's an array
    }

    #[test]
    fn handles_escapes_and_unicode() {
        let v = parse_ok(r#"{"s":"a\"b\\c\nd\u00e9"}"#);
        assert_eq!(v.get(&["s"]).unwrap().as_str(), Some("a\"b\\c\nd\u{00e9}"));
    }

    #[test]
    fn rejects_malformed() {
        assert!(JsonValue::parse("{").is_err());
        assert!(JsonValue::parse(r#"{"a":}"#).is_err());
        assert!(JsonValue::parse("null extra").is_err());
        assert!(JsonValue::parse(r#"{"a":1,}"#).is_err());
    }

    #[test]
    fn bounds_nesting_depth() {
        // 65 nested arrays exceed the 64-deep cap; 60 is fine.
        let deep = "[".repeat(100).to_string() + &"]".repeat(100);
        assert!(JsonValue::parse(&deep).is_err());
        let ok = "[".repeat(60).to_string() + &"]".repeat(60);
        assert!(JsonValue::parse(&ok).is_ok());
    }

    #[test]
    fn nested_and_trailing_ok() {
        let v = parse_ok(r#" {"outer":{"inner":[1,2,{"k":"v"}]}} "#);
        let inner = v.get(&["outer", "inner"]).unwrap();
        match inner {
            JsonValue::Arr(items) => assert_eq!(items.len(), 3),
            _ => panic!("expected array"),
        }
    }
}
