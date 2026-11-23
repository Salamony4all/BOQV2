/**
 * Arabic Reshaper (with Lam-Alif ligatures), Bidi visual ordering (preserving LTR numbers),
 * and cached Almarai font loader for jsPDF.
 */

// Basic mapping for Arabic characters joining forms: [Isolated, Initial, Medial, Final]
const ArabicForms = {
    "\u0627": ["\uFE8D", "\uFE8D", "\uFE8E", "\uFE8E"], // Alif
    "\u0628": ["\uFE8F", "\uFE91", "\uFE92", "\uFE90"], // Ba
    "\u062A": ["\uFE95", "\uFE97", "\uFE98", "\uFE96"], // Ta
    "\u062B": ["\uFE99", "\uFE9B", "\uFE9C", "\uFE9A"], // Tha
    "\u062C": ["\uFE9D", "\uFE9F", "\uFEA0", "\uFE9E"], // Jeem
    "\u062D": ["\uFEA1", "\uFEA3", "\uFEA4", "\uFEA2"], // Ha
    "\u062E": ["\uFEA5", "\uFEA7", "\uFEA8", "\uFEA6"], // Kha
    "\u062F": ["\uFEA9", "\uFEA9", "\uFEAA", "\uFEAA"], // Dal
    "\u0630": ["\uFEAB", "\uFEAB", "\uFEAC", "\uFEAC"], // Thal
    "\u0631": ["\uFEAD", "\uFEAD", "\uFEAE", "\uFEAE"], // Ra
    "\u0632": ["\uFEAF", "\uFEAF", "\uFEB0", "\uFEB0"], // Zayn
    "\u0633": ["\uFEB1", "\uFEB3", "\uFEB4", "\uFEB2"], // Seen
    "\u0634": ["\uFEB5", "\uFEB7", "\uFEB8", "\uFEB6"], // Sheen
    "\u0635": ["\uFEB9", "\uFEBB", "\uFEBC", "\uFEBA"], // Sad
    "\u0636": ["\uFEBD", "\uFEBF", "\uFEC0", "\uFEBE"], // Dad
    "\u0637": ["\uFEC1", "\uFEC3", "\uFEC4", "\uFEC2"], // Ta'
    "\u0638": ["\uFEC5", "\uFEC7", "\uFEC8", "\uFEC6"], // Za'
    "\u0639": ["\uFEC9", "\uFECB", "\uFECC", "\uFECA"], // Ain
    "\u063A": ["\uFECD", "\uFECF", "\uFED0", "\uFECE"], // Ghain
    "\u0641": ["\uFED1", "\uFED3", "\uFED4", "\uFED2"], // Fa
    "\u0642": ["\uFED5", "\uFED7", "\uFED8", "\uFED6"], // Qaf
    "\u0643": ["\uFED9", "\uFEDB", "\uFEDC", "\uFEDA"], // Kaf
    "\u0644": ["\uFEDD", "\uFEDF", "\uFEE0", "\uFEDE"], // Lam
    "\u0645": ["\uFEE1", "\uFEE3", "\uFEE4", "\uFEE2"], // Meem
    "\u0646": ["\uFEE5", "\uFEE7", "\uFEE8", "\uFEE6"], // Noon
    "\u0647": ["\uFEE9", "\uFEEB", "\uFEEC", "\uFEEA"], // Ha'
    "\u0648": ["\uFEED", "\uFEED", "\uFEEE", "\uFEEE"], // Waw
    "\u064A": ["\uFEF1", "\uFEF3", "\uFEF4", "\uFEF2"], // Ya
    "\u0626": ["\uFE89", "\uFE8B", "\uFE8C", "\uFE8A"], // Hamza on Ya
    "\u0624": ["\uFE85", "\uFE85", "\uFE86", "\uFE86"], // Hamza on Waw
    "\u0622": ["\uFE81", "\uFE81", "\uFE82", "\uFE82"], // Alif Mada
    "\u0623": ["\uFE83", "\uFE83", "\uFE84", "\uFE84"], // Alif Hamza Above
    "\u0625": ["\uFE87", "\uFE87", "\uFE88", "\uFE88"], // Alif Hamza Below
    "\u0629": ["\uFE93", "\uFE93", "\uFE94", "\uFE94"], // Ta Marbuta
    "\u0649": ["\uFEEF", "\uFEEF", "\uFEF0", "\uFEF0"], // Alif Maqsura
    "\u0621": ["\uFE80", "\uFE80", "\uFE80", "\uFE80"], // Standalone Hamza
};

// Lam-Alif ligatures: [Isolated, Final]
const LamAlifLigatures = {
    "\u0622": ["\uFEF5", "\uFEF6"], // Lam + Alif Mada (لآ)
    "\u0623": ["\uFEF7", "\uFEF8"], // Lam + Alif Hamza Above (لأ)
    "\u0625": ["\uFEF9", "\uFEFA"], // Lam + Alif Hamza Below (لإ)
    "\u0627": ["\uFEFB", "\uFEFC"], // Lam + Alif (لا)
};

// Characters that don't join with the following character
const NonJoiningFollowing = new Set([
    "\u0621", "\u0622", "\u0623", "\u0624", "\u0625", "\u0627",
    "\u0629", "\u062F", "\u0630", "\u0631", "\u0632", "\u0648", "\u0649"
]);

const ARABIC_CHAR_RE = /[\u0600-\u06FF\uFE70-\uFEFF]/;
const LTR_OR_DIGIT_RE = /[A-Za-z0-9\u0660-\u0669\u06F0-\u06F9]/;

const flipBracket = (char) => {
    switch (char) {
        case "(": return ")";
        case ")": return "(";
        case "[": return "]";
        case "]": return "[";
        case "{": return "}";
        case "}": return "{";
        case "<": return ">";
        case ">": return "<";
        default: return char;
    }
};

function reshapeArabic(text) {
    let reshaped = "";
    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        const prev = i > 0 ? chars[i - 1] : null;
        const next = i < chars.length - 1 ? chars[i + 1] : null;
        const prevJoins = Boolean(prev && ArabicForms[prev] && !NonJoiningFollowing.has(prev));

        // Handle Lam-Alif ligatures (لا، لأ، لإ، لآ)
        if (char === "\u0644" && next && LamAlifLigatures[next]) {
            reshaped += LamAlifLigatures[next][prevJoins ? 1 : 0];
            i++; // Consume the following Alif
            continue;
        }

        if (ArabicForms[char]) {
            const nextJoins = Boolean(next && ArabicForms[next] && !NonJoiningFollowing.has(char));
            let formIdx = 0; // Isolated
            if (prevJoins && nextJoins) formIdx = 2; // Medial
            else if (prevJoins) formIdx = 3; // Final
            else if (nextJoins) formIdx = 1; // Initial
            reshaped += ArabicForms[char][formIdx];
        } else {
            reshaped += char;
        }
    }
    return reshaped;
}

export const fixArabic = (text) => {
    if (!text) return "";
    const str = String(text);
    if (!/[\u0600-\u06FF]/.test(str)) return str;

    const reshaped = reshapeArabic(str);

    // Determine overall base direction from the first strong character
    let isPrimarilyRtl = true;
    for (const ch of reshaped) {
        if (ARABIC_CHAR_RE.test(ch)) { isPrimarilyRtl = true; break; }
        if (/[A-Za-z]/.test(ch)) { isPrimarilyRtl = false; break; }
    }

    // Tokenize into three run classes: 'ar' (Arabic), 'ltr' (Latin/digits/numeric tokens), 'sep' (whitespace/punctuation)
    // Keeping digits in 'ltr' runs guarantees numbers like "1200" or "2026" are NEVER reversed inside Arabic sentences.
    const rawTokens = [];
    const chars = Array.from(reshaped);
    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        let type = 'sep';
        if (ARABIC_CHAR_RE.test(ch)) {
            type = 'ar';
        } else if (LTR_OR_DIGIT_RE.test(ch)) {
            type = 'ltr';
        } else if (/[.,:/%+-]/.test(ch)) {
            // Keep numeric punctuation (e.g., 12.50, 160x80, 100%, 10-20) attached to surrounding LTR/number runs
            const prevType = rawTokens.length > 0 ? rawTokens[rawTokens.length - 1].type : null;
            const nextCh = chars[i + 1] || '';
            if (prevType === 'ltr' && (LTR_OR_DIGIT_RE.test(nextCh) || ch === '%')) {
                type = 'ltr';
            }
        }

        if (rawTokens.length > 0 && rawTokens[rawTokens.length - 1].type === type) {
            rawTokens[rawTokens.length - 1].text += ch;
        } else {
            rawTokens.push({ type, text: ch });
        }
    }

    // Merge consecutive 'ar' runs separated only by spaces/punctuation into a single RTL span
    const segments = [];
    for (let i = 0; i < rawTokens.length; i++) {
        const tok = rawTokens[i];
        const prev = segments[segments.length - 1];
        const next = rawTokens[i + 1];
        if (tok.type === 'sep' && prev && prev.type === 'ar' && next && next.type === 'ar') {
            prev.text += tok.text + next.text;
            i++; // Consumed next 'ar'
        } else if (tok.type === 'sep' && prev && prev.type === 'ltr' && next && next.type === 'ltr') {
            prev.text += tok.text + next.text;
            i++; // Consumed next 'ltr'
        } else {
            segments.push({ ...tok });
        }
    }

    const processed = segments.map((seg) => {
        if (seg.type === 'ar') {
            return Array.from(seg.text).reverse().map(flipBracket).join("");
        }
        if (seg.type === 'sep' && isPrimarilyRtl) {
            return Array.from(seg.text).reverse().map(flipBracket).join("");
        }
        return seg.text;
    });

    return isPrimarilyRtl ? processed.reverse().join("") : processed.join("");
};

export const hasArabic = (text) => /[\u0600-\u06FF]/.test(String(text || ""));

// Module-level cache so Almarai-Regular.ttf is fetched & encoded only once per session
let cachedAlmaraiBase64Promise = null;

async function fetchAlmaraiBase64() {
    if (!cachedAlmaraiBase64Promise) {
        const fontUrl = "https://cdn.jsdelivr.net/gh/googlefonts/almarai@master/fonts/ttf/Almarai-Regular.ttf";
        cachedAlmaraiBase64Promise = fetch(fontUrl)
            .then((response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status} loading Arabic font`);
                return response.arrayBuffer();
            })
            .then((arrayBuffer) => {
                const bytes = new Uint8Array(arrayBuffer);
                let binary = "";
                const chunkSize = 0x8000;
                for (let i = 0; i < bytes.length; i += chunkSize) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
                }
                return btoa(binary);
            })
            .catch((err) => {
                cachedAlmaraiBase64Promise = null;
                throw err;
            });
    }
    return cachedAlmaraiBase64Promise;
}

/**
 * Almarai has no glyphs for most isolated presentation forms (U+FE8D alif, U+FEAD ra,
 * U+FEED waw, …), and jsPDF writes a letter standing alone with them, so such letters went
 * missing from the PDFs ("الزوار" came out as "لز"). A letter alone already has its isolated
 * shape: each missing form is given its letter's own glyph.
 */
function aliasMissingArabicForms(doc) {
    for (const style of ["normal", "bold"]) {
        let codeMap = null;
        try {
            codeMap = doc.internal.getFont("Almarai", style)?.metadata?.cmap?.unicode?.codeMap || null;
        } catch {
            codeMap = null;
        }
        if (!codeMap) continue;
        for (let cp = 0xFB50; cp <= 0xFEFC; cp++) {
            if (codeMap[cp]) continue;
            const letter = String.fromCharCode(cp).normalize("NFKC");
            if (letter.length === 1 && codeMap[letter.charCodeAt(0)]) codeMap[cp] = codeMap[letter.charCodeAt(0)];
        }
    }
}

export const loadArabicFont = async (doc) => {
    try {
        const base64 = await fetchAlmaraiBase64();
        doc.addFileToVFS("Almarai-Regular.ttf", base64);
        doc.addFont("Almarai-Regular.ttf", "Almarai", "normal");
        doc.addFont("Almarai-Regular.ttf", "Almarai", "bold");
        aliasMissingArabicForms(doc);
        return true;
    } catch (e) {
        console.error("Failed to load Arabic font:", e);
        return false;
    }
};
