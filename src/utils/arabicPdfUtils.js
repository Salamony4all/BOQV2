/**
 * Simple Arabic Reshaper and Bidi support for jsPDF
 */

// Basic mapping for Arabic characters joining forms
const ArabicForms = {
    // Isolated, Initial, Medial, Final
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
};

// Characters that don't join with the following character
const NonJoiningFollowing = ["\u0627", "\u062F", "\u0630", "\u0631", "\u0632", "\u0648", "\u0622", "\u0623", "\u0625", "\u0629", "\u0649"];

export const fixArabic = (text) => {
    if (!text) return "";
    const hasAr = /[\u0600-\u06FF]/.test(text);
    if (!hasAr) return text;

    // Reshape logic
    let reshaped = "";
    const originalChars = text.split("");
    for (let i = 0; i < originalChars.length; i++) {
        const char = originalChars[i];
        if (ArabicForms[char]) {
            const prev = i > 0 ? originalChars[i - 1] : null;
            const next = i < originalChars.length - 1 ? originalChars[i + 1] : null;
            const prevJoins = prev && ArabicForms[prev] && !NonJoiningFollowing.includes(prev);
            const nextJoins = next && ArabicForms[next];

            let formIdx = 0; // Isolated
            if (prevJoins && nextJoins) formIdx = 2; // Medial
            else if (prevJoins) formIdx = 3; // Final
            else if (nextJoins) formIdx = 1; // Initial

            reshaped += ArabicForms[char][formIdx];
        } else {
            reshaped += char;
        }
    }

    // Bidi segments logic
    const segments = [];
    let current = "";
    let isAr = false;

    // Helper to flip brackets
    const flipBracket = (char) => {
        if (char === "(") return ")";
        if (char === ")") return "(";
        if (char === "[") return "]";
        if (char === "]") return "[";
        if (char === "{") return "}";
        if (char === "}") return "{";
        return char;
    };

    for (let i = 0; i < reshaped.length; i++) {
        const char = reshaped[i];
        // Arabic block or reshaped block (including neutral characters that should stay with Arabic)
        const isCharAr = /[\u0600-\u06FF\uFE70-\uFEFF]/.test(char);
        const isNeutral = /[\s\d\(\)\[\]\{\}\.\,:\-\+_]/.test(char);

        // If it's the first character, establish base direction
        if (i === 0) {
            isAr = isCharAr;
            current = char;
        } else {
            // If it's neutral, it tends to follow the current direction unless we hit a strong opposite
            if (isNeutral) {
                current += char;
            } else if (isCharAr === isAr) {
                current += char;
            } else {
                segments.push({ text: current, isArabic: isAr });
                isAr = isCharAr;
                current = char;
            }
        }
    }
    segments.push({ text: current, isArabic: isAr });

    // Determine if the string should be treated as RTL overall for segment ordering.
    let isPrimarilyRtl = false;
    for (const char of reshaped) {
        const isStrongAr = /[\u0600-\u06FF\uFE70-\uFEFF]/.test(char);
        const isStrongEn = /[a-zA-Z]/.test(char);
        if (isStrongAr) { isPrimarilyRtl = true; break; }
        if (isStrongEn) { isPrimarilyRtl = false; break; }
    }

    // Refined segmentation: Neutrals shouldn't always stick to Arabic
    const finalSegments = [];
    let currentText = "";
    let currentIsAr = false;

    for (let i = 0; i < reshaped.length; i++) {
        const char = reshaped[i];
        const isCharAr = /[\u0600-\u06FF\uFE70-\uFEFF]/.test(char);
        const isNeutral = /[\s\d\(\)\[\]\{\}\.\,:\-\+_]/.test(char);

        if (i === 0) {
            currentIsAr = isCharAr;
            currentText = char;
        } else {
            // A neutral character joins the current segment ONLY if it doesn't break a strong run
            if (isNeutral) {
                currentText += char;
            } else if (isCharAr === currentIsAr) {
                currentText += char;
            } else {
                finalSegments.push({ text: currentText, isArabic: currentIsAr });
                currentIsAr = isCharAr;
                currentText = char;
            }
        }
    }
    finalSegments.push({ text: currentText, isArabic: currentIsAr });

    const processedSegments = finalSegments.map(s => {
        if (s.isArabic) {
            return s.text.split("").reverse().map(flipBracket).join("");
        }
        return s.text;
    });

    if (isPrimarilyRtl) {
        return processedSegments.reverse().join("");
    } else {
        return processedSegments.join("");
    }
};

export const hasArabic = (text) => /[\u0600-\u06FF]/.test(text);

export const loadArabicFont = async (doc) => {
    try {
        // Use a lightweight Almarai font from CDN
        const fontUrl = "https://cdn.jsdelivr.net/gh/googlefonts/almarai@master/fonts/ttf/Almarai-Regular.ttf";
        const response = await fetch(fontUrl);
        const arrayBuffer = await response.arrayBuffer();

        // Convert arrayBuffer to Base64
        const base64 = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));

        doc.addFileToVFS("Almarai-Regular.ttf", base64);
        doc.addFont("Almarai-Regular.ttf", "Almarai", "normal");
        doc.addFont("Almarai-Regular.ttf", "Almarai", "bold");
        return true;
    } catch (e) {
        console.error("Failed to load Arabic font:", e);
        return false;
    }
};
