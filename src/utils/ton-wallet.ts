import crypto from 'node:crypto';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { TonClient, WalletContractV4, internal } from '@ton/ton';
// @ton/core used by @ton/ton internally
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

// ── Send from Escrow ──────────────────────────────────────

/**
 * Send TON from an escrow wallet to a recipient address.
 * Handles auto-deployment of the wallet contract (stateInit included on first tx).
 * Returns the on-chain transaction hash, or null if confirmation timed out.
 */
export async function sendFromEscrow(params: {
  publicKey: Buffer;
  secretKey: Buffer;
  toAddress: string;
  amount: bigint;
}): Promise<string | null> {
  const { publicKey, secretKey, toAddress, amount } = params;

  const endpoint = `${TON_ENDPOINT}/jsonRPC`;

  const client = new TonClient({
    endpoint,
    apiKey: config.TON_API_KEY || undefined,
  });

  const wallet = WalletContractV4.create({ workchain: 0, publicKey });
  const isTestnet = config.TON_NETWORK === 'testnet';
  const escrowAddress = wallet.address.toString({ bounceable: false, testOnly: isTestnet });

  const contract = client.open(wallet);

  // Get seqno (0 if wallet not deployed yet — sendTransfer will auto-deploy)
  let seqno = 0;
  try {
    seqno = await contract.getSeqno();
  } catch {
    // Wallet not deployed yet — seqno=0 triggers stateInit (auto-deploy)
    seqno = 0;
  }

  // Send transfer with retry (includes stateInit for auto-deploy when seqno === 0)
  const maxRetries = 3;
  for (let retry = 0; retry < maxRetries; retry++) {
    try {
      if (retry > 0) {
        await new Promise(r => setTimeout(r, retry * 3000));
      }
      await contract.sendTransfer({
        seqno,
        secretKey,
        messages: [
          internal({
            to: toAddress,
            value: amount,
            bounce: false,
          }),
        ],
      });
      break;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[sendFromEscrow] attempt ${retry + 1} failed:`, errMsg);
      if (errMsg.includes('429') && retry < maxRetries - 1) {
        continue; // Rate limited — retry
      }
      throw err;
    }
  }

  // Wait for transaction confirmation (poll seqno change)
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const newSeqno = await contract.getSeqno();
      if (newSeqno > seqno) {
        // Transaction confirmed — wait a bit for indexing, then get tx hash
        await new Promise(r => setTimeout(r, 2000));
        try {
          const txs = await getTransactions(escrowAddress, 1);
          const tx = txs[0] as { transaction_id?: { hash?: string } } | undefined;
          if (tx?.transaction_id?.hash) {
            return tx.transaction_id.hash;
          }
        } catch {
          // Indexing might be slow, return null
        }
        return null;
      }
    } catch {
      // Contract might not be queryable yet, keep polling
    }
  }

  // Transaction sent but not confirmed within ~45s — may still confirm
  return null;
}
