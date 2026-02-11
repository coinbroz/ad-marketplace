import crypto from 'node:crypto';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV4 } from '@ton/ton';
import { config, TON_ENDPOINT } from '../config.js';

// ── Key Encryption (AES-256-GCM) ──────────────────────────

interface EncryptedKey {
  encrypted: string;
  iv: string;
  tag: string;
}

function getEncryptionKey(): Buffer {
  return crypto.createHash('sha256').update(config.ESCROW_ENCRYPTION_KEY).digest();
}

export function encryptSecretKey(secretKey: Buffer): EncryptedKey {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(secretKey);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encrypted: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

export function decryptSecretKey(encryptedData: EncryptedKey): Buffer {
  const key = getEncryptionKey();
  const iv = Buffer.from(encryptedData.iv, 'hex');
  const tag = Buffer.from(encryptedData.tag, 'hex');
  const encrypted = Buffer.from(encryptedData.encrypted, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted;
}

// ── Wallet Generation ──────────────────────────────────────

export interface EscrowWalletData {
  address: string;
  publicKey: string;
  secretKeyEnc: string;
  secretKeyIv: string;
  secretKeyTag: string;
}

/**
 * Generate a new escrow wallet using a random mnemonic.
 * Each deal gets a unique wallet for isolation.
 */
export async function generateEscrowWallet(): Promise<EscrowWalletData> {
  // Generate a 24-word mnemonic and derive keypair
  const mnemonic = generateMnemonic();
  const keyPair = await mnemonicToPrivateKey(mnemonic);

  const wallet = WalletContractV4.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });

  const isTestnet = config.TON_NETWORK === 'testnet';
  const address = wallet.address.toString({ bounceable: false, testOnly: isTestnet });

  // Encrypt the secret key (64 bytes: seed + public key)
  const encrypted = encryptSecretKey(Buffer.from(keyPair.secretKey));

  return {
    address,
    publicKey: Buffer.from(keyPair.publicKey).toString('hex'),
    secretKeyEnc: encrypted.encrypted,
    secretKeyIv: encrypted.iv,
    secretKeyTag: encrypted.tag,
  };
}

/**
 * Generate a random 24-word mnemonic using BIP39-like approach.
 * For escrow wallets, we only need randomness — not human-readable backup.
 */
function generateMnemonic(): string[] {
  // Use a simple word list approach — @ton/crypto's mnemonicToPrivateKey
  // accepts any string array as mnemonic (it hashes it internally)
  const words: string[] = [];
  for (let i = 0; i < 24; i++) {
    words.push(crypto.randomBytes(4).toString('hex'));
  }
  return words;
}

// ── TON API Calls ──────────────────────────────────────────

/**
 * Get wallet balance from toncenter API.
 */
export async function getWalletBalance(address: string): Promise<bigint> {
  const url = `${TON_ENDPOINT}/getAddressBalance?address=${address}`;
  const headers: Record<string, string> = {};
  if (config.TON_API_KEY) {
    headers['X-API-Key'] = config.TON_API_KEY;
  }

  const response = await fetch(url, { headers });
  const data = await response.json() as { ok: boolean; result: string };

  if (!data.ok) {
    throw new Error(`Failed to get balance for ${address}`);
  }

  return BigInt(data.result);
}

/**
 * Get transactions for an address.
 */
export async function getTransactions(address: string, limit = 10) {
  const url = `${TON_ENDPOINT}/getTransactions?address=${address}&limit=${limit}`;
  const headers: Record<string, string> = {};
  if (config.TON_API_KEY) {
    headers['X-API-Key'] = config.TON_API_KEY;
  }

  const response = await fetch(url, { headers });
  const data = await response.json() as { ok: boolean; result: unknown[] };

  if (!data.ok) {
    throw new Error(`Failed to get transactions for ${address}`);
  }

  return data.result;
}

/**
 * Convert TON to nanoton.
 */
export function toNano(amount: number): bigint {
  return BigInt(Math.round(amount * 1_000_000_000));
}

/**
 * Convert nanoton to TON.
 */
export function fromNano(amount: bigint): number {
  return Number(amount) / 1_000_000_000;
}
