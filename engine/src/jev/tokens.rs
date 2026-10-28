//! Estimates how many tokens Jev bills for a text. The estimate is
//! deterministic, so the runner splits text and questions into the same
//! requests on every open and finds their stored answers again.

/// A run of letters counts one token per four letters, rounded up. Each digit,
/// other non-space character and line break counts one. On 720 requests the
/// bench billed, the estimate was at least the billed count for all but the
/// densest, an SVG of path data that it undercounted by 3%. The median request
/// billed 0.73 of its estimate.
pub fn tokens(text: &str) -> usize {
    let mut n: usize = 0;
    let mut letters: usize = 0;
    for c in text.chars() {
        if c.is_alphabetic() {
            letters += 1;
            continue;
        }
        n += letters.div_ceil(4);
        letters = 0;
        if c == '\n' || !c.is_whitespace() {
            n += 1;
        }
    }
    n + letters.div_ceil(4)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digits_and_marks_count_more_than_words() {
        assert_eq!(tokens("walk"), 1);
        assert_eq!(tokens("walking"), 2);
        assert_eq!(tokens("a1b2"), 4);
        assert_eq!(tokens("M12.5,3"), 7);
        assert_eq!(tokens("one two\nthree"), 5);
    }
}
