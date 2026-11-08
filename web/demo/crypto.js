// Demo build: the one piece of node:crypto that db.js uses (new ids), from the browser's Web Crypto.
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export default {
  randomBytes(n) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(n));
    return { toString: (enc) => (enc === 'base64url' ? b64url(bytes) : Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')) };
  },
};
