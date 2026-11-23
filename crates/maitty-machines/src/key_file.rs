//! A private key file a person names for a machine (`identity_file`): is there a file at the
//! path. The file is never opened, so its contents are never read here; ssh is the only reader.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

/// The full path of the key file `input` names (`~` is the home folder), or words for the person.
pub fn check_key_file(input: &str) -> Result<String, String> {
    let home = directories::BaseDirs::new().map(|dirs| dirs.home_dir().to_path_buf());
    check_key_file_at(input, home.as_deref())
}

fn check_key_file_at(input: &str, home: Option<&Path>) -> Result<String, String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("Give the path of the key file, like ~/.ssh/id_ed25519".to_string());
    }
    if input.starts_with('-') || input.chars().any(char::is_control) {
        return Err("That is not a file path".to_string());
    }
    if input.ends_with(".pub") {
        return Err("That is the public half of a key. Pick the file without .pub".to_string());
    }
    let path = expand(input, home);
    if !path.is_absolute() {
        return Err("Give the full path of the key file, like ~/.ssh/id_ed25519".to_string());
    }
    match std::fs::metadata(&path) {
        Ok(found) if found.is_file() => path
            .to_str()
            .map(str::to_owned)
            .ok_or_else(|| "That path has characters this app cannot pass on".to_string()),
        Ok(_) => Err(format!("{} is a folder, not a key file", path.display())),
        Err(error) if error.kind() == ErrorKind::NotFound => {
            Err(format!("There is no file at {}", path.display()))
        }
        Err(error) => Err(format!("Could not look at {}: {error}", path.display())),
    }
}

/// `~/rest` (or `~\rest`) under the home folder; anything else as given.
fn expand(input: &str, home: Option<&Path>) -> PathBuf {
    match (input.strip_prefix("~/").or_else(|| input.strip_prefix("~\\")), home) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(input),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sandbox(label: &str) -> maitty_test_support::TempFolder {
        let dir = maitty_test_support::TempFolder::new(&format!("key-file-{label}"));
        std::fs::create_dir_all(dir.join(".ssh")).unwrap();
        dir
    }

    #[test]
    fn a_file_that_exists_is_accepted_and_its_home_shorthand_is_expanded() {
        let home = sandbox("ok");
        std::fs::write(home.join(".ssh").join("id_ed25519"), "not read").unwrap();
        let found = check_key_file_at("~/.ssh/id_ed25519", Some(&home)).unwrap();
        assert_eq!(PathBuf::from(found), home.join(".ssh").join("id_ed25519"));
    }

    #[test]
    fn a_missing_file_a_folder_and_a_public_key_are_each_refused_in_words() {
        let home = sandbox("bad");
        assert!(check_key_file_at("~/.ssh/nope", Some(&home)).unwrap_err().starts_with("There is no file"));
        assert!(check_key_file_at("~/.ssh", Some(&home)).unwrap_err().contains("folder"));
        assert!(check_key_file_at("~/.ssh/id.pub", Some(&home)).unwrap_err().contains("public half"));
    }

    #[test]
    fn a_blank_relative_option_like_or_control_character_path_is_refused() {
        for bad in ["", "  ", "id_ed25519", "-oProxyCommand=x", "/a\nb"] {
            assert!(check_key_file_at(bad, None).is_err(), "{bad:?}");
        }
    }
}
