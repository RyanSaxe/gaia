//! Jev's tokens for a text, estimated the same way every time, so a request
//! is laid out the same way on every open and its stored answer is found
//! again. A run of letters counts a token for every four, every digit and
//! every other mark counts one, and a line break one. Fitted on 720
//! requests the bench billed in step 3: it counted at least as many tokens
//! as Jev billed for all but the densest, an SVG of path data it
//! undercounted by 3%, and the median request came to 0.73 of its estimate.

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
