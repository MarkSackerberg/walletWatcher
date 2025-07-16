import { promises as fs } from 'fs';
import path from 'path';
import { 
  IBalanceStorage, 
  WalletBalances, 
  StoredBalances, 
  BalanceComparison, 
  NFTAsset, 
  TokenBalances, 
  NFTChanges, 
  TokenChangeData,
  BalanceData
} from './types';

export class BalanceStorage implements IBalanceStorage {
  private filePath: string;
  private previousBalances: Map<string, StoredBalances>;

  constructor(filePath: string = 'previousBalances.json') {
    this.filePath = path.resolve(filePath);
    this.previousBalances = new Map();
  }

  async initialize(): Promise<void> {
    try {
      await this.loadFromFile();
    } catch (error) {
      console.log('No existing balance history found, starting fresh');
      this.previousBalances = new Map();
    }
  }

  private async loadFromFile(): Promise<void> {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      const parsed: BalanceData = JSON.parse(data);
      
      this.previousBalances = new Map(parsed.balances || []);
      
      console.log(`Loaded balance history for ${this.previousBalances.size} wallets`);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error('Error loading balance history:', error);
      }
      throw error;
    }
  }

  private async saveToFile(): Promise<void> {
    try {
      const data: BalanceData = {
        balances: Array.from(this.previousBalances.entries()),
        lastUpdated: new Date().toISOString()
      };
      
      await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error saving balance history:', error);
      throw error;
    }
  }

  async updateWalletBalances(walletAddress: string, balances: WalletBalances): Promise<void> {
    const storedBalances: StoredBalances = {
      ...balances,
      timestamp: new Date().toISOString()
    };
    
    this.previousBalances.set(walletAddress, storedBalances);
    await this.saveToFile();
  }

  getPreviousBalances(walletAddress: string): StoredBalances | null {
    return this.previousBalances.get(walletAddress) || null;
  }

  compareBalances(walletAddress: string, currentBalances: WalletBalances): BalanceComparison {
    const previousBalances = this.getPreviousBalances(walletAddress);
    
    if (!previousBalances) {
      return {
        isFirstCheck: true,
        solChange: 0,
        tokenChanges: {},
        nftChanges: {
          added: [],
          removed: []
        }
      };
    }

    const solChange = currentBalances.solBalance - (previousBalances.solBalance || 0);
    const tokenChanges = this.compareTokenBalances(
      previousBalances.tokenBalances || {},
      currentBalances.tokenBalances || {}
    );
    const nftChanges = this.compareNFTs(
      previousBalances.nftAssets || [],
      currentBalances.nftAssets || []
    );

    return {
      isFirstCheck: false,
      solChange,
      tokenChanges,
      nftChanges,
      previousTimestamp: previousBalances.timestamp
    };
  }

  private compareTokenBalances(previousTokens: TokenBalances, currentTokens: TokenBalances): Record<string, TokenChangeData> {
    const changes: Record<string, TokenChangeData> = {};
    const allMints = new Set([
      ...Object.keys(previousTokens),
      ...Object.keys(currentTokens)
    ]);

    for (const mint of allMints) {
      const previousAmount = previousTokens[mint]?.amount || 0;
      const currentAmount = currentTokens[mint]?.amount || 0;
      const change = currentAmount - previousAmount;

      if (change !== 0) {
        changes[mint] = {
          change,
          previousAmount,
          currentAmount,
          decimals: currentTokens[mint]?.decimals || previousTokens[mint]?.decimals || 9
        };
      }
    }

    return changes;
  }

  private compareNFTs(previousNFTs: NFTAsset[], currentNFTs: NFTAsset[]): NFTChanges {
    const previousIds = new Set(previousNFTs.map(nft => nft.id));
    const currentIds = new Set(currentNFTs.map(nft => nft.id));

    const added = currentNFTs.filter(nft => !previousIds.has(nft.id));
    const removed = previousNFTs.filter(nft => !currentIds.has(nft.id));

    return { added, removed };
  }

  formatBalanceChange(amount: number, decimals: number = 9): string {
    if (amount === 0) return '0';
    const sign = amount > 0 ? '+' : '';
    return `${sign}${amount.toFixed(Math.min(decimals, 6))}`;
  }

  formatSolChange(change: number): string | null {
    if (change === 0) return null;
    const sign = change > 0 ? '+' : '';
    return `${sign}${change.toFixed(6)} SOL`;
  }

  hasSignificantChanges(comparison: BalanceComparison): boolean {
    return comparison.solChange !== 0 || 
           Object.keys(comparison.tokenChanges).length > 0 || 
           comparison.nftChanges.added.length > 0 || 
           comparison.nftChanges.removed.length > 0;
  }
}

export default BalanceStorage;