//! Standard base64, padded, both ways.
//!
//! Written out rather than taken from a crate: it is two short loops, and its
//! only uses are the two places a picture crosses a boundary that carries text.
//! The diagram font goes to the page in `protocol.rs`, and a diagram copied as
//! a PNG comes back from it in `main.rs`.

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        let group = (u32::from(chunk[0]) << 16)
            | (u32::from(chunk.get(1).copied().unwrap_or(0)) << 8)
            | u32::from(chunk.get(2).copied().unwrap_or(0));
        let digit = |shift: u32| ALPHABET[((group >> shift) & 63) as usize] as char;

        out.push(digit(18));
        out.push(digit(12));
        out.push(if chunk.len() > 1 { digit(6) } else { '=' });
        out.push(if chunk.len() > 2 { digit(0) } else { '=' });
    }
    out
}

/// The bytes behind `text`, or `None` for anything that is not base64 in
/// exactly the form `encode` writes. What arrives here comes from a page that
/// may be showing any document at all, which is no place to be lenient. Not
/// even whitespace is let through: the FileReader that writes it never adds
/// any.
pub fn decode(text: &str) -> Option<Vec<u8>> {
    let text = text.as_bytes();
    if text.len() % 4 != 0 {
        return None;
    }
    let groups = text.len() / 4;
    let mut out = Vec::with_capacity(groups * 3);

    for (index, quad) in text.chunks(4).enumerate() {
        // Padding belongs at the very end, and there is never more than two.
        let padding = quad.iter().rev().take_while(|&&c| c == b'=').count();
        if padding > 2 || (padding > 0 && index + 1 != groups) {
            return None;
        }

        let mut group = 0u32;
        for &c in &quad[..4 - padding] {
            group = (group << 6) | u32::from(value(c)?);
        }
        group <<= 6 * padding as u32;

        let bytes = [(group >> 16) as u8, (group >> 8) as u8, group as u8];
        out.extend_from_slice(&bytes[..3 - padding]);
    }
    Some(out)
}

fn value(c: u8) -> Option<u8> {
    match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 4648's own examples, which between them cover every way a length can
    /// fall against the three-byte groups.
    const STANDARD: [(&str, &str); 7] = [
        ("", ""),
        ("f", "Zg=="),
        ("fo", "Zm8="),
        ("foo", "Zm9v"),
        ("foob", "Zm9vYg=="),
        ("fooba", "Zm9vYmE="),
        ("foobar", "Zm9vYmFy"),
    ];

    #[test]
    fn encodes_the_standard_examples() {
        for (plain, encoded) in STANDARD {
            assert_eq!(encode(plain.as_bytes()), encoded, "encoding {plain:?}");
        }
    }

    /// A PNG is every byte value there is, so the round trip covers all of them
    /// and not only the ones the examples happen to spell.
    #[test]
    fn decodes_the_standard_examples_and_every_byte() {
        for (plain, encoded) in STANDARD {
            assert_eq!(decode(encoded).as_deref(), Some(plain.as_bytes()), "decoding {encoded:?}");
        }

        let every: Vec<u8> = (0..=255).collect();
        assert_eq!(decode(&encode(&every)), Some(every));
    }

    /// Guessing at a malformed picture would put something on the clipboard
    /// nobody copied.
    #[test]
    fn refuses_what_is_not_base64() {
        for bad in ["Zg=", "Z===", "====", "Zg==Zm9v", "Zm9v!", "Zm 9v", "Zm9v\n"] {
            assert_eq!(decode(bad), None, "{bad:?} was accepted");
        }
    }
}
