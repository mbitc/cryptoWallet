/**
 * walletCrypto.ts
 * Šifravimas naudojant tik expo-crypto (veikia su Expo Go).
 *
 * Priklausomybės:
 *   expo-crypto       (npx expo install expo-crypto)
 *   expo-secure-store (npx expo install expo-secure-store)
 *
 * ─── Kaip tai veikia ────────────────────────────────────────────────────────
 *
 * expo-crypto neturi AES, todėl naudojame SHA-512 pagrįstą stream cipher:
 *
 *   1. RAKTO IŠVEDIMAS (KDF):
 *      Imituojame PBKDF2 — 10 000 kartų kartojame SHA-512(pin + salt + iteracija).
 *      Rezultatas: 64 baito "master key".
 *
 *   2. ŠIFRAVIMAS (XOR stream):
 *      encKey   = SHA-512(masterKey + "enc")   → 64B šifravimo raktas
 *      keystream = SHA-512(encKey + nonce + 0) | SHA-512(encKey + nonce + 1) | ...
 *      ciphertext = privateKey XOR keystream
 *
 *   3. AUTENTIFIKACIJA (PIN patikrinimas):
 *      macKey  = SHA-512(masterKey + "mac")    → 64B MAC raktas
 *      authTag = SHA-512(macKey + ciphertext)  → 64B
 *      Iššifruojant: jei authTag nesutampa → WRONG_PIN
 *
 * Blob struktūra SecureStore:
 *   base64( salt[32] | nonce[16] | authTag[64] | ciphertext )
 *
 * ⚠️  Mokymosi projektas. Produkcijai naudoti AES-256-GCM
 *     (react-native-quick-crypto arba react-native-aes-crypto).
 * ────────────────────────────────────────────────────────────────────────────
 */

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const WALLET_BLOB_KEY = 'sepolia_wallet_blob_v2';
const KDF_ITERATIONS  = 10_000;  // kompromisas: Expo Go lėtas JS thread

// ─── Pagalbinės funkcijos ────────────────────────────────────────────────────

/** Uint8Array → hex string */
const toHex = (b: Uint8Array) =>
  Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');

/** hex string → Uint8Array */
const fromHex = (h: string): Uint8Array =>
  new Uint8Array(h.match(/.{2}/g)!.map(b => parseInt(b, 16)));

/** Uint8Array → base64 */
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

/** base64 → Uint8Array */
const fromB64 = (s: string): Uint8Array =>
  new Uint8Array(atob(s).split('').map(c => c.charCodeAt(0)));

/** XOR dviejų Uint8Array (a.length <= b.length) */
const xor = (a: Uint8Array, b: Uint8Array): Uint8Array =>
  a.map((byte, i) => byte ^ b[i]);

/** SHA-512 → Uint8Array (64 baitai) */
async function sha512(input: string): Promise<Uint8Array> {
  const hex = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA512,
    input,
    { encoding: Crypto.CryptoEncoding.HEX }
  );
  return fromHex(hex);
}

/** Atsitiktiniai baitai per expo-crypto */
function randomBytes(n: number): Uint8Array {
  return Crypto.getRandomBytes(n);
}

// ─── KDF — rakto išvedimas ───────────────────────────────────────────────────

/**
 * Iteratyvus SHA-512 KDF (PBKDF2 imitacija).
 * Grąžina 64 baito master key.
 */
async function deriveKey(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const saltHex = toHex(salt);
  let current   = await sha512(pin + saltHex + '0');

  for (let i = 1; i < KDF_ITERATIONS; i++) {
    // XOR folding + naujas hash — paprastas, bet pakankamai ilgas
    const next = await sha512(toHex(current) + pin + saltHex + i.toString());
    current = xor(current, next);
  }
  return current; // 64B master key
}

// ─── Keystream generavimas ───────────────────────────────────────────────────

/**
 * Generuoja keystream reikalingą ilgį iš encKey + nonce.
 * Blokuoja po 64 baitus (SHA-512 išvestis).
 */
async function generateKeystream(
  encKey: Uint8Array,
  nonce: Uint8Array,
  length: number
): Promise<Uint8Array> {
  const stream  = new Uint8Array(Math.ceil(length / 64) * 64);
  const keyHex  = toHex(encKey);
  const nonceHex = toHex(nonce);

  for (let block = 0; block * 64 < stream.length; block++) {
    const blockHash = await sha512(keyHex + nonceHex + block.toString());
    stream.set(blockHash, block * 64);
  }
  return stream.slice(0, length);
}

// ─── Šifravimas ir saugojimas ────────────────────────────────────────────────

export async function encryptAndStore(privateKey: string, pin: string): Promise<void> {
  const salt      = randomBytes(32);
  const nonce     = randomBytes(16);
  const masterKey = await deriveKey(pin, salt);

  // Atskiri raktai šifravimui ir MAC
  const encKey = await sha512(toHex(masterKey) + 'enc');
  const macKey = await sha512(toHex(masterKey) + 'mac');

  // Šifravimas
  const plainBytes  = new TextEncoder().encode(privateKey);
  const keystream   = await generateKeystream(encKey, nonce, plainBytes.length);
  const ciphertext  = xor(plainBytes, keystream);

  // Autentifikacijos žyma (authTag)
  const authTag = await sha512(toHex(macKey) + toHex(ciphertext));

  // Blob: salt[32] | nonce[16] | authTag[64] | ciphertext
  const blob = new Uint8Array(32 + 16 + 64 + ciphertext.length);
  blob.set(salt,       0);
  blob.set(nonce,      32);
  blob.set(authTag,    48);
  blob.set(ciphertext, 112);

  await SecureStore.setItemAsync(WALLET_BLOB_KEY, toB64(blob));
}

// ─── Iššifravimas ────────────────────────────────────────────────────────────

export async function decryptAndLoad(pin: string): Promise<string> {
  const blobB64 = await SecureStore.getItemAsync(WALLET_BLOB_KEY);
  if (!blobB64) throw new Error('WALLET_NOT_FOUND');

  const blob       = fromB64(blobB64);
  const salt       = blob.slice(0, 32);
  const nonce      = blob.slice(32, 48);
  const authTag    = blob.slice(48, 112);
  const ciphertext = blob.slice(112);

  const masterKey  = await deriveKey(pin, salt);
  const encKey     = await sha512(toHex(masterKey) + 'enc');
  const macKey     = await sha512(toHex(masterKey) + 'mac');

  // Patikrinamas authTag PRIEŠ iššifruojant
  const expectedTag = await sha512(toHex(macKey) + toHex(ciphertext));
  const tagMatch    = toHex(expectedTag) === toHex(authTag);
  if (!tagMatch) throw new Error('WRONG_PIN');

  // Iššifravimas
  const keystream  = await generateKeystream(encKey, nonce, ciphertext.length);
  const plainBytes = xor(ciphertext, keystream);
  return new TextDecoder().decode(plainBytes);
}

// ─── Pagalbinės eksportuojamos funkcijos ─────────────────────────────────────

export async function walletExists(): Promise<boolean> {
  const val = await SecureStore.getItemAsync(WALLET_BLOB_KEY);
  return val !== null;
}

export async function deleteWallet(): Promise<void> {
  await SecureStore.deleteItemAsync(WALLET_BLOB_KEY);
}
