/**
 * walletService.ts
 * Ethereum Sepolia tinklo operacijos naudojant ethers.js v6.
 *
 * Priklausomybės:
 *   ethers  (npm i ethers)
 *
 * RPC: Sepolia. Produkcijai rekomenduojama naudoti Alchemy / Infura
 * su API raktu ir fallback logika.
 */

import { formatEther, HDNodeWallet, isAddress, JsonRpcProvider, parseEther, Wallet } from 'ethers';

// ─── Provider ────────────────────────────────────────────────────────────────
// Rekomenduojama: pakeisti į savo Alchemy/Infura Sepolia endpoint
const ETHEREUM_MAINNET_RPC = 'https://ethereum-rpc.publicnode.com';

let _provider: JsonRpcProvider | null = null;

function getProvider(): JsonRpcProvider {
  if (!_provider) {
    _provider = new JsonRpcProvider(ETHEREUM_MAINNET_RPC);
  }
  return _provider;
}

// ─── Wallet kūrimas ──────────────────────────────────────────────────────────

export interface NewWalletResult {
  address: string;
  privateKey: string;
  mnemonic: string;
}

/**
 * Sugeneruoja naują HD wallet'ą.
 * privateKey ir mnemonic yra LAIKINI — šaukiančioji pusė turi juos iš karto
 * perduoti šifravimui ir/arba pateikti vartotojui parašyti.
 */
export function createNewWallet(): NewWalletResult {
  const wallet = Wallet.createRandom() as HDNodeWallet;
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic: wallet.mnemonic?.phrase ?? '',
  };
}

/**
 * Atkuria wallet'ą iš private key (po iššifravimo).
 */
export function walletFromPrivateKey(privateKey: string): Wallet {
  return new Wallet(privateKey, getProvider());
}

// ─── Balansas ────────────────────────────────────────────────────────────────

export async function getBalance(address: string): Promise<string> {
  const balance = await getProvider().getBalance(address);
  return formatEther(balance);
}

// ─── Siuntimas ───────────────────────────────────────────────────────────────

export interface SendResult {
  txHash: string;
}

/**
 * Siunčia ETH. Grąžina tx hash iš karto (nelaukia gavimo patvirtinimo).
 * UI lygmenyje galima stebėti tx.wait() atskirai.
 */
export async function sendEth(
  wallet: Wallet,
  toAddress: string,
  amountEth: string
): Promise<SendResult> {
  if (!isAddress(toAddress)) throw new Error('INVALID_ADDRESS');

  const value = parseEther(amountEth);
  if (value <= 0n) throw new Error('INVALID_AMOUNT');

  const tx = await wallet.sendTransaction({ to: toAddress, value });
  return { txHash: tx.hash };
}

// ─── Adreso validacija ───────────────────────────────────────────────────────

export { isAddress };
