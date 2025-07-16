import { PublicKey } from '@solana/web3.js';
import { 
  ITransactionParser, 
  ISolanaClient, 
  ParsedTransaction, 
  BalanceChanges, 
  TransactionSummary
} from './types';

export class TransactionParser implements ITransactionParser {
  private solanaClient: ISolanaClient;

  constructor(solanaClient: ISolanaClient) {
    this.solanaClient = solanaClient;
  }

  async parseBalanceChanges(transaction: ParsedTransaction, walletAddress: string): Promise<BalanceChanges> {
    if (!transaction || !transaction.meta) {
      return {
        solChange: 0,
        tokenChanges: {},
        success: false,
        fee: 0,
        signature: '',
        blockTime: 0
      };
    }

    const walletPublicKey = new PublicKey(walletAddress);
    
    // Handle different transaction versions and structures
    let accountKeys: PublicKey[];
    if (transaction.transaction.message.accountKeys) {
      accountKeys = transaction.transaction.message.accountKeys;
    } else if (transaction.transaction.message.staticAccountKeys) {
      accountKeys = transaction.transaction.message.staticAccountKeys;
    } else {
      console.warn('No account keys found in transaction');
      return {
        solChange: 0,
        tokenChanges: {},
        success: false,
        fee: 0,
        signature: '',
        blockTime: 0
      };
    }
    
    if (!accountKeys || !Array.isArray(accountKeys) || accountKeys.length === 0) {
      console.warn('Account keys is not a valid array');
      return {
        solChange: 0,
        tokenChanges: {},
        success: false,
        fee: 0,
        signature: '',
        blockTime: 0
      };
    }
    
    let walletIndex = -1;
    for (let i = 0; i < accountKeys.length; i++) {
      if (accountKeys[i]?.equals && accountKeys[i]?.equals(walletPublicKey)) {
        walletIndex = i;
        break;
      } else if (accountKeys[i]?.toString() === walletAddress) {
        walletIndex = i;
        break;
      }
    }

    if (walletIndex === -1) {
      return {
        solChange: 0,
        tokenChanges: {},
        success: false,
        fee: 0,
        signature: '',
        blockTime: 0
      };
    }

    const preBalance = transaction.meta.preBalances[walletIndex] || 0;
    const postBalance = transaction.meta.postBalances[walletIndex] || 0;
    const solChange = (postBalance - preBalance) / 1000000000; // Convert lamports to SOL

    const tokenChanges: Record<string, number> = {};

    if (transaction.meta.preTokenBalances && transaction.meta.postTokenBalances) {
      const preTokenBalances = new Map<string, number>();
      const postTokenBalances = new Map<string, number>();

      transaction.meta.preTokenBalances.forEach(balance => {
        if (balance.owner === walletAddress) {
          preTokenBalances.set(balance.mint, balance.uiTokenAmount?.uiAmount || 0);
        }
      });

      transaction.meta.postTokenBalances.forEach(balance => {
        if (balance.owner === walletAddress) {
          postTokenBalances.set(balance.mint, balance.uiTokenAmount?.uiAmount || 0);
        }
      });

      const allMints = new Set([...preTokenBalances.keys(), ...postTokenBalances.keys()]);
      
      for (const mint of allMints) {
        const preAmount = preTokenBalances.get(mint) || 0;
        const postAmount = postTokenBalances.get(mint) || 0;
        const change = postAmount - preAmount;
        
        if (change !== 0) {
          tokenChanges[mint] = change;
        }
      }
    }

    return {
      solChange,
      tokenChanges,
      success: transaction.meta.err === null,
      fee: transaction.meta.fee ? transaction.meta.fee / 1000000000 : 0,
      signature: transaction.transaction.signatures[0] || '',
      blockTime: transaction.blockTime || 0
    };
  }

  async getTransactionSummary(signature: string, walletAddress: string): Promise<TransactionSummary | null> {
    try {
      const transaction = await this.solanaClient.getTransactionDetails(signature);
      if (!transaction) {
        console.warn(`Transaction ${signature} not found`);
        return null;
      }

      const balanceChanges = await this.parseBalanceChanges(transaction, walletAddress);
      
      if (!balanceChanges) {
        console.warn(`Could not parse balance changes for transaction ${signature}`);
        return null;
      }
      
      return {
        signature,
        timestamp: balanceChanges.blockTime ? new Date(balanceChanges.blockTime * 1000) : new Date(),
        success: balanceChanges.success,
        solChange: balanceChanges.solChange || 0,
        tokenChanges: balanceChanges.tokenChanges || {},
        fee: balanceChanges.fee || 0,
        transactionType: this.determineTransactionType(balanceChanges)
      };
    } catch (error) {
      console.error(`Error parsing transaction ${signature}:`, error);
      console.error('Error details:', (error as Error).message);
      return null;
    }
  }

  determineTransactionType(balanceChanges: BalanceChanges): string {
    if (balanceChanges.solChange > 0) {
      return 'Received SOL';
    } else if (balanceChanges.solChange < 0) {
      return 'Sent SOL';
    }

    const tokenChangeEntries = Object.entries(balanceChanges.tokenChanges);
    if (tokenChangeEntries.length > 0) {
      const hasPositiveChange = tokenChangeEntries.some(([, change]) => change > 0);
      const hasNegativeChange = tokenChangeEntries.some(([, change]) => change < 0);
      
      if (hasPositiveChange && hasNegativeChange) {
        return 'Token Swap';
      } else if (hasPositiveChange) {
        return 'Received Tokens';
      } else if (hasNegativeChange) {
        return 'Sent Tokens';
      }
    }

    return 'Other Transaction';
  }

  formatBalanceChange(amount: number, decimals: number = 9): string {
    if (amount === 0) return '0';
    const sign = amount > 0 ? '+' : '';
    return `${sign}${amount.toFixed(decimals)}`;
  }
}

export default TransactionParser;