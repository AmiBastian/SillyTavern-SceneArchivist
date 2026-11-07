// Script allowances for when the model tokenizer is unavailable.
// Vocalized Arabic can cost more than the same text without vowel marks.
export function estimateTokens(value) {
    const text = String(value ?? '');
    if (/^[\x00-\x7f]*$/.test(text)) return Math.ceil(text.length / 3.6);
    let count = 0;
    for (const symbol of text) {
        if (/[\x00-\x7f\p{Script=Latin}\s]/u.test(symbol)) count += 1 / 3.6;
        else if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Extended_Pictographic}/u.test(symbol)) count += 1.6;
        else if (/\p{Script_Extensions=Arabic}/u.test(symbol)) count += /\p{M}/u.test(symbol) ? 1.8 : 0.85;
        else if (/\p{Script=Cyrillic}/u.test(symbol)) count += 0.72;
        else count += 1;
    }
    return Math.ceil(count);
}
