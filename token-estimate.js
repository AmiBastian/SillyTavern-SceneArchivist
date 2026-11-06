// Fallback when a model tokenizer is unavailable. Non-Latin scripts and emoji
// need a larger allowance than the English prose heuristic.
export function estimateTokens(value) {
    const text = String(value ?? '');
    if (/^[\x00-\x7f]*$/.test(text)) return Math.ceil(text.length / 3.6);
    let count = 0;
    for (const symbol of text) {
        if (/[\x00-\x7f\p{Script=Latin}\s]/u.test(symbol)) count += 1 / 3.6;
        else if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Extended_Pictographic}/u.test(symbol)) count += 1.6;
        else count += 1;
    }
    return Math.ceil(count);
}
