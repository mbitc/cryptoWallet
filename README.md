# Sepolia ETH Piniginė

Vieno ekrano Sepolia testinio tinklo piniginė, sukurta su Expo / React Native.

## Priklausomybės

```bash
# ethers.js v6
npm i ethers

# Kriptografija (tikras AES-256-GCM)
npm i react-native-quick-crypto

# Saugus saugojimas
npx expo install expo-secure-store

# Kamera (QR skaitytuvas)
npx expo install expo-camera

# QR kodų generavimas
npm i react-native-qrcode-svg
```

> **Pastaba:** `react-native-quick-crypto` reikalauja native build'o.  
> Naudokite `expo prebuild` arba `eas build` — **neveiks Expo Go**.

## Failų struktūra

```
SepoliaWallet/
├── WalletApp.tsx          ← Pagrindinis komponentas (prijungiamas prie App.tsx)
└── crypto/
    ├── walletCrypto.ts    ← AES-256-GCM šifravimas / iššifravimas
    └── walletService.ts   ← ethers.js operacijos
```

## Paleidimas

```tsx
// App.tsx
import WalletApp from './SepoliaWallet/WalletApp';
export default WalletApp;
```

## Saugumo architektūra

```
PIN (6 skaitmenys)
    │
    ▼
PBKDF2-HMAC-SHA512
  salt: 32 baito atsitiktinis
  iteracijos: 100 000
  išvestis: 32 baitai (AES-256 raktas)
    │
    ▼
AES-256-GCM šifravimas
  IV: 12 baito atsitiktinis
  AuthTag: 16 baitai (automatinis PIN patikrinimas)
    │
    ▼
expo-secure-store (iOS Keychain / Android Keystore)
Blob: salt[32] | iv[12] | authTag[16] | ciphertext
```

### Ką tai reiškia praktiškai:

| Grėsmė | Apsauga |
|---|---|
| Fizinė prieiga prie įrenginio | SecureStore → iOS Keychain / Android Keystore |
| PIN atspėjimas | 100k PBKDF2 iteracijų + GCM authTag patikrinimas |
| Backup ištraukimas | Keychain įrašas nėra iCloud/Google backup'e (pagal nutylėjimą) |
| Šifravimo nulaužimas | AES-256-GCM yra dabartinis pramonės standartas |

## Funkcionalumas

- **Sukurti piniginę** — HD wallet + mnemonic frazė (tik vieną kartą rodoma)
- **Balansas** — atsinaujina kas 15 sekundžių
- **Gauti** — QR kodas + adreso kopijavimas
- **Siųsti** — adreso įvedimas + QR skaitytuvas + kiekis
- **QR skaitytuvas** — skaito Ethereum adresus / `ethereum:` URI
- **Auto-lock** — 10 min be aktyvumo → PIN ekranas
- **Užrakinti** — rankinis užrakinimas

## Produkcijai rekomenduojama

1. **RPC endpoint** — pakeiskite `https://rpc.sepolia.org` į savo  
   Alchemy arba Infura Sepolia URL su API raktu
2. **PIN bandymai** — dabartinė versija leidžia neribotus bandymus;  
   produkcijai pridėkite blokavimą po N nesėkmingų bandymų
3. **Tinklas** — pakeiskite į Ethereum Mainnet kai pereinate nuo testų
