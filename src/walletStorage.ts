import { promises as fs } from 'fs';
import path from 'path';
import { PublicKey } from '@solana/web3.js';
import { 
  IWalletStorage, 
  UserStats,
  WalletMappingData
} from './types';

export class WalletStorage implements IWalletStorage {
  private filePath: string;
  private userWallets: Map<string, Set<string>>;
  private walletUsers: Map<string, string>;

  constructor(filePath: string = 'walletMappings.json') {
    this.filePath = path.resolve(filePath);
    this.userWallets = new Map();
    this.walletUsers = new Map();
  }

  async initialize(): Promise<void> {
    try {
      await this.loadFromFile();
    } catch (error) {
      console.log('No existing wallet mappings found, starting with empty storage');
      this.userWallets = new Map();
      this.walletUsers = new Map();
    }
  }

  private async loadFromFile(): Promise<void> {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      const parsed: WalletMappingData = JSON.parse(data);
      
      // Convert userWallets back to Map with Sets as values
      this.userWallets = new Map();
      if (parsed.userWallets) {
        for (const [userId, wallets] of parsed.userWallets) {
          // Handle both array format (new) and object format (old)
          if (Array.isArray(wallets)) {
            this.userWallets.set(userId, new Set(wallets));
          } else if (typeof wallets === 'object' && wallets !== null) {
            // Handle old format where wallets was an object (likely empty {})
            this.userWallets.set(userId, new Set(Object.keys(wallets as Record<string, any>)));
          } else {
            // Fallback for any other format
            this.userWallets.set(userId, new Set());
          }
        }
      }
      
      this.walletUsers = new Map(parsed.walletUsers || []);
      
      // Rebuild userWallets from walletUsers if userWallets is empty or corrupted
      if (this.userWallets.size === 0 && this.walletUsers.size > 0) {
        console.log('Rebuilding userWallets from walletUsers data...');
        for (const [walletAddress, userId] of this.walletUsers.entries()) {
          if (!this.userWallets.has(userId)) {
            this.userWallets.set(userId, new Set());
          }
          this.userWallets.get(userId)!.add(walletAddress);
        }
        // Save the corrected data
        await this.saveToFile();
      }
      
      console.log(`Loaded ${this.userWallets.size} user-wallet mappings`);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error('Error loading wallet mappings:', error);
      }
      throw error;
    }
  }

  private async saveToFile(): Promise<void> {
    try {
      const data: WalletMappingData = {
        userWallets: Array.from(this.userWallets.entries()).map(([userId, wallets]) => [userId, Array.from(wallets)]),
        walletUsers: Array.from(this.walletUsers.entries())
      };
      
      await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error saving wallet mappings:', error);
      throw error;
    }
  }

  async addWallet(userId: string, walletAddress: string): Promise<void> {
    if (!this.userWallets.has(userId)) {
      this.userWallets.set(userId, new Set());
    }
    
    this.userWallets.get(userId)!.add(walletAddress);
    this.walletUsers.set(walletAddress, userId);
    
    await this.saveToFile();
    console.log(`Added wallet ${walletAddress} for user ${userId}`);
  }

  async removeWallet(userId: string, walletAddress: string): Promise<void> {
    if (this.userWallets.has(userId)) {
      this.userWallets.get(userId)!.delete(walletAddress);
      
      if (this.userWallets.get(userId)!.size === 0) {
        this.userWallets.delete(userId);
      }
    }
    
    this.walletUsers.delete(walletAddress);
    
    await this.saveToFile();
    console.log(`Removed wallet ${walletAddress} for user ${userId}`);
  }

  getUserWallets(userId: string): string[] {
    return Array.from(this.userWallets.get(userId) || []);
  }

  getWalletOwner(walletAddress: string): string | undefined {
    return this.walletUsers.get(walletAddress);
  }

  getAllWallets(): string[] {
    return Array.from(this.walletUsers.keys());
  }

  getAllUsers(): string[] {
    return Array.from(this.userWallets.keys());
  }

  getUserWalletCount(userId: string): number {
    return this.userWallets.get(userId)?.size || 0;
  }

  getTotalWalletCount(): number {
    return this.walletUsers.size;
  }

  hasWallet(walletAddress: string): boolean {
    return this.walletUsers.has(walletAddress);
  }

  isValidSolanaAddress(address: string): boolean {
    try {
      new PublicKey(address);
      return true;
    } catch (error) {
      return false;
    }
  }

  async getUserStats(userId: string): Promise<UserStats> {
    const wallets = this.getUserWallets(userId);
    return {
      userId,
      walletCount: wallets.length,
      wallets: wallets.map(wallet => ({
        address: wallet,
        shortAddress: `${wallet.slice(0, 8)}...${wallet.slice(-8)}`
      }))
    };
  }
}

export default WalletStorage;