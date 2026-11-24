//! Cleaning text before it goes into a bundle someone else will read. Each pass removes one kind of
//! thing and the passes run in a fixed order. They are heuristics that catch the common shapes of a
//! secret, which is why a file that is not plain text is left out whole and why the person is told
//! to look before sending.

/// What replaces a secret value.
const SECRET: &str = "[redacted]";
/// Words in a key's name that make its value a secret.
const SECRET_KEYS: [&str; 14] = [
    "token", "secret", "password", "passwd", "pwd", "apikey", "api_key", "api-key", "authorization",
    "credential", "private_key", "access_key", "cookie", "passphrase",
];
/// Word prefixes of well-known key and token formats.
const KEY_PREFIXES: [&str; 12] = [
    "sk-", "ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_", "glpat-", "xoxb-", "xoxp-", "xoxa-", "xoxr-",
];
/// The shortest run of letters and digits (both kinds in it) read as a key or a hash.
const LONG_WORD: usize = 32;
/// Endings that make a dotted word a host name rather than a file name or a version.
const HOST_ENDINGS: [&str; 16] = [
    "com", "net", "org", "io", "dev", "local", "lan", "internal", "home", "ai", "app", "cloud", "edu", "gov", "co", "de",
];
/// Folders that hold one folder per user, as the three systems spell them.
const USER_FOLDERS: [&str; 3] = ["/home/", "/Users/", "\\Users\\"];

/// What a bundle's text is cleaned with: the home folder and this computer's own name.
pub struct Context {
    pub home: Option<String>,
    pub host: Option<String>,
}

/// Why a file cannot be cleaned, so it is left out. `None` when it is plain text.
pub fn unsafe_to_clean(bytes: &[u8]) -> Option<&'static str> {
    if bytes.contains(&0) {
        return Some("it is not plain text");
    }
    let text = String::from_utf8_lossy(bytes);
    let broken = text.chars().filter(|c| *c == '\u{fffd}').count();
    (broken * 100 > text.chars().count().max(1)).then_some("it is not readable text")
}

/// `text` with everything the passes know to hide, hidden.
pub fn clean(text: &str, context: &Context) -> String {
    let mut in_private_key = false;
    text.lines()
        .map(|line| clean_line(line, context, &mut in_private_key))
        .collect::<Vec<_>>()
        .join("\n")
}

fn clean_line(line: &str, context: &Context, in_private_key: &mut bool) -> String {
    if *in_private_key {
        *in_private_key = !line.contains("-----END");
        return String::new();
    }
    if line.contains("-----BEGIN") && line.contains("PRIVATE KEY") {
        *in_private_key = !line.contains("-----END");
        return format!("{SECRET} (private key)");
    }
    let line = hide_names(line, context);
    let line = hide_url_credentials(&line);
    let line = hide_bearer(&line);
    let line = hide_key_values(&line);
    let line = hide_key_shapes(&line);
    hide_network(&line)
}

fn hide_names(line: &str, context: &Context) -> String {
    let mut line = line.to_string();
    if let Some(home) = context.home.as_deref().filter(|home| home.len() > 1) {
        line = line.replace(home, "~").replace(&home.replace('\\', "/"), "~");
    }
    if let Some(host) = context.host.as_deref().filter(|host| host.len() > 2) {
        line = line.replace(host, "[this-computer]");
    }
    for folder in USER_FOLDERS {
        line = hide_user_folder(&line, folder);
    }
    line
}

/// `/home/<name>/` becomes `/home/[user]/`, for any user, not only the one running the app.
fn hide_user_folder(line: &str, folder: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(at) = rest.find(folder) {
        let (before, after) = rest.split_at(at + folder.len());
        out.push_str(before);
        let name_end = after
            .find(|c: char| matches!(c, '/' | '\\' | '"' | '\'') || c.is_whitespace())
            .unwrap_or(after.len());
        out.push_str(if name_end > 0 { "[user]" } else { "" });
        rest = &after[name_end..];
    }
    out.push_str(rest);
    out
}

/// `scheme://name:password@host` loses the part before the `@`.
fn hide_url_credentials(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(at) = rest.find("://") {
        let (before, after) = rest.split_at(at + 3);
        out.push_str(before);
        let authority_end = after
            .find(|c: char| matches!(c, '/' | '"' | '\'') || c.is_whitespace())
            .unwrap_or(after.len());
        match after[..authority_end].rfind('@') {
            Some(sign) => {
                out.push_str(SECRET);
                rest = &after[sign..];
            }
            None => rest = after,
        }
    }
    out.push_str(rest);
    out
}

/// `Bearer <token>` and `Basic <token>`, whatever the key before them was called.
fn hide_bearer(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut words = line.split_inclusive(char::is_whitespace);
    while let Some(word) = words.next() {
        out.push_str(word);
        let name = word.trim_end().to_ascii_lowercase();
        if matches!(name.as_str(), "bearer" | "basic")
            && word.ends_with(char::is_whitespace)
            && let Some(token) = words.next()
        {
            out.push_str(SECRET);
            out.push_str(&token[token.trim_end().len()..]);
        }
    }
    out
}

fn is_secret_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    SECRET_KEYS.iter().any(|word| key.contains(word))
}

/// `name=value`, `name: value` and `"name": "value"` where the name says it is a secret.
fn hide_key_values(line: &str) -> String {
    let chars: Vec<char> = line.chars().collect();
    let mut out = String::with_capacity(line.len());
    let mut i = 0;
    while i < chars.len() {
        out.push(chars[i]);
        i += 1;
        if !matches!(chars[i - 1], '=' | ':') || !is_secret_key(&key_before(&chars[..i - 1])) {
            continue;
        }
        while chars.get(i) == Some(&' ') {
            out.push(' ');
            i += 1;
        }
        let quote = chars.get(i).copied().filter(|c| matches!(c, '"' | '\''));
        if let Some(quote) = quote {
            out.push(quote);
            i += 1;
        }
        let ends = |c: char| match quote {
            Some(q) => c == q,
            None => c.is_whitespace() || matches!(c, ',' | '&' | ';' | '}' | ')'),
        };
        let end = (i..chars.len()).find(|&k| ends(chars[k])).unwrap_or(chars.len());
        if end > i {
            out.push_str(SECRET);
        }
        i = end;
    }
    out
}

/// The word that ends just before the end of `chars`, without quotes or spaces around it.
fn key_before(chars: &[char]) -> String {
    let word: String = chars
        .iter()
        .rev()
        .skip_while(|c| matches!(c, '"' | '\'' | ' '))
        .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '.'))
        .collect();
    word.chars().rev().collect()
}

/// Each word that is the shape of a known key or token, or a long run of letters and digits.
fn hide_key_shapes(line: &str) -> String {
    map_words(line, |c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'), |word| {
        if is_key_shape(word) { SECRET.to_string() } else { word.to_string() }
    })
}

fn is_key_shape(word: &str) -> bool {
    if KEY_PREFIXES.iter().any(|prefix| word.starts_with(prefix) && word.len() > prefix.len() + 8) {
        return true;
    }
    let cloud_id = |prefix: &str, len: usize| {
        word.starts_with(prefix) && word.len() == len && word.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
    };
    if cloud_id("AKIA", 20) || cloud_id("ASIA", 20) || (word.starts_with("AIza") && word.len() == 39) || (word.starts_with("eyJ") && word.len() >= 10) {
        return true;
    }
    let plain = word.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    plain && word.len() >= LONG_WORD && word.chars().any(|c| c.is_ascii_digit()) && word.chars().any(|c| c.is_ascii_alphabetic())
}

/// Addresses and host names: where a machine is, which is not the reader's to know.
fn hide_network(line: &str) -> String {
    map_words(line, |c| c.is_ascii_alphanumeric() || matches!(c, '.' | ':' | '@' | '_' | '-' | '[' | ']'), network_word)
}

/// `line` with each run of characters `in_word` accepts replaced by what `change` makes of it.
fn map_words(line: &str, in_word: impl Fn(char) -> bool, change: impl Fn(&str) -> String) -> String {
    let mut out = String::with_capacity(line.len());
    let mut word = String::new();
    for c in line.chars() {
        if in_word(c) {
            word.push(c);
        } else {
            out.push_str(&change(&word));
            word.clear();
            out.push(c);
        }
    }
    out.push_str(&change(&word));
    out
}

fn network_word(word: &str) -> String {
    if let Some((user, host)) = word.split_once('@')
        && !user.is_empty()
        && !host.is_empty()
    {
        return format!("[user]@{}", network_word(host));
    }
    if word.is_empty() || word.contains(SECRET) {
        return word.to_string();
    }
    let trimmed = word.trim_end_matches(['.', ':']);
    let tail = &word[trimmed.len()..];
    let placeholder = if is_ipv4(trimmed) || is_ipv6(trimmed) {
        "[ip]"
    } else if is_host(trimmed) {
        "[host]"
    } else {
        return word.to_string();
    };
    format!("{placeholder}{tail}")
}

fn is_ipv4(word: &str) -> bool {
    let address = word.split(':').next().unwrap_or(word);
    let parts: Vec<&str> = address.split('.').collect();
    parts.len() == 4
        && parts.iter().all(|part| {
            !part.is_empty() && part.len() <= 3 && part.chars().all(|c| c.is_ascii_digit()) && part.parse::<u16>().is_ok_and(|n| n <= 255)
        })
}

/// Hex groups with a `::` or with most of their groups; a clock time (`10:20:30`) has neither.
fn is_ipv6(word: &str) -> bool {
    let word = word.trim_matches(['[', ']']);
    let colons = word.matches(':').count();
    word.chars().all(|c| c.is_ascii_hexdigit() || c == ':') && (colons >= 5 || (colons >= 2 && word.contains("::")))
}

fn is_host(word: &str) -> bool {
    let labels: Vec<&str> = word.split('.').collect();
    let Some(last) = labels.last() else { return false };
    labels.len() >= 2
        && labels.iter().all(|l| !l.is_empty() && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
        && HOST_ENDINGS.contains(&last.to_ascii_lowercase().as_str())
}

#[cfg(test)]
mod tests;
