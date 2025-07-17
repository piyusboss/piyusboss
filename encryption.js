// File: encryption.js

/**
 * --------------------------------------------------------------------------
 * WARNING: SECURITY RISK!
 * --------------------------------------------------------------------------
 * Yeh encryption key client-side code mein store karna bilkul bhi surakshit
 * NAHI hai. Koi bhi user ise aasani se browser developer tools mein dekh sakta hai.
 * Yeh code sirf functionality demonstrate karne ke liye hai.
 * Production environment mein, key ko kabhi bhi client-side par expose na karein.
 * --------------------------------------------------------------------------
 */
const ENCRYPTION_KEY_HEX = '2b7e151628aed2a6abf7158809cf4f3c2b7e151628aed2a6abf7158809cf4f3c';

/**
 * Ek plain text string ko AES-256-CBC ka use karke encrypt karta hai.
 * Output format "iv_hex:ciphertext_hex" hota hai, jo PHP backend ke anukool hai.
 * @param {string} plainText - Encrypt karne wala text.
 * @returns {string} - "iv:ciphertext" format mein encrypted string.
 */
function encryptMessage(plainText) {
    if (typeof CryptoJS === 'undefined') {
        console.error("CryptoJS library is not loaded. Please include it in your HTML.");
        // Fallback to sending plaintext to avoid breaking the app
        return plainText; 
    }
    
    try {
        // Key ko hex se parse karein.
        const key = CryptoJS.enc.Hex.parse(ENCRYPTION_KEY_HEX);

        // Har encryption ke liye ek naya random 16-byte IV (Initialization Vector) generate karein.
        const iv = CryptoJS.lib.WordArray.random(16);

        // AES ka use karke encrypt karein.
        const encrypted = CryptoJS.AES.encrypt(plainText, key, {
            iv: iv,
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7
        });

        // IV aur ciphertext ko hex format mein combine karke return karein.
        // Format: "iv_in_hex:ciphertext_in_hex"
        return iv.toString(CryptoJS.enc.Hex) + ':' + encrypted.ciphertext.toString(CryptoJS.enc.Hex);
    } catch (e) {
        console.error("Encryption failed: ", e);
        // Fallback to sending plaintext if encryption fails
        return plainText;
    }
}
