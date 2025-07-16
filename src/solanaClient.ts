import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { dasApi } from '@metaplex-foundation/digital-asset-standard-api';
import { Connection, PublicKey } from '@solana/web3.js';
import { 
  ISolanaClient, 
  TokenBalances, 
  DASBalanceData, 
  DASTokenBalances, 
  NFTAsset, 
  ParsedTransaction
} from './types';

export class SolanaClient implements ISolanaClient {
  private connection: Connection;
  private umi: any;
  private lastCheckedSignatures: Map<string, string>;

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl);
    this.umi = createUmi(rpcUrl).use(dasApi());
    this.lastCheckedSignatures = new Map();
  }

  async getRecentTransactions(walletAddress: string, limit: number = 100): Promise<any[]> {
    try {
      const publicKey = new PublicKey(walletAddress);
      const signatures = await this.connection.getSignaturesForAddress(publicKey, {
        limit
      });
      
      return signatures;
    } catch (error) {
      console.error(`Error fetching transactions for ${walletAddress}:`, error);
      return [];
    }
  }

  async getNewTransactions(walletAddress: string): Promise<any[]> {
    try {
      const signatures = await this.getRecentTransactions(walletAddress, 50);
      const lastChecked = this.lastCheckedSignatures.get(walletAddress);
      
      if (!lastChecked) {
        this.lastCheckedSignatures.set(walletAddress, signatures[0]?.signature || '');
        return [];
      }

      const newTransactions = [];
      for (const sig of signatures) {
        if (sig.signature === lastChecked) {
          break;
        }
        newTransactions.push(sig);
      }

      if (newTransactions.length > 0) {
        this.lastCheckedSignatures.set(walletAddress, newTransactions[0].signature);
      }

      return newTransactions;
    } catch (error) {
      console.error(`Error checking new transactions for ${walletAddress}:`, error);
      return [];
    }
  }

  async getTransactionDetails(signature: string): Promise<ParsedTransaction | null> {
    try {
      const transaction = await this.connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0
      });
      return transaction as ParsedTransaction;
    } catch (error) {
      console.error(`Error fetching transaction details for ${signature}:`, error);
      return null;
    }
  }

  async getWalletBalance(walletAddress: string): Promise<number> {
    try {
      const publicKey = new PublicKey(walletAddress);
      const balance = await this.connection.getBalance(publicKey);
      return balance / 1000000000; // Convert lamports to SOL
    } catch (error) {
      console.error(`Error fetching balance for ${walletAddress}:`, error);
      return 0;
    }
  }

  async getTokenBalances(walletAddress: string): Promise<TokenBalances> {
    try {
      const publicKey = new PublicKey(walletAddress);
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(publicKey, {
        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
      });

      const balances: TokenBalances = {};
      for (const account of tokenAccounts.value) {
        const tokenInfo = account.account.data.parsed.info;
        if (tokenInfo.tokenAmount.uiAmount > 0) {
          balances[tokenInfo.mint] = {
            amount: tokenInfo.tokenAmount.uiAmount,
            decimals: tokenInfo.tokenAmount.decimals
          };
        }
      }

      return balances;
    } catch (error) {
      console.error(`Error fetching token balances for ${walletAddress}:`, error);
      return {};
    }
  }

  async getAssetsByOwner(walletAddress: string): Promise<any> {
    try {
      const assets = await this.umi.rpc.getAssetsByOwner({
        owner: walletAddress,
        limit: 1000
      });
      return assets;
    } catch (error) {
      console.error(`Error fetching assets for ${walletAddress}:`, error);
      return { items: [] };
    }
  }

  async getDasTokenBalances(walletAddress: string): Promise<DASBalanceData> {
    try {
      const assets = await this.umi.rpc.getAssetsByOwner({
        owner: walletAddress,
        limit: 1000
      });

      const tokenBalances: DASTokenBalances = {};
      const nftAssets: NFTAsset[] = [];

      for (const asset of assets.items || []) {
        if (asset.interface === 'FungibleToken' || asset.interface === 'FungibleAsset') {
          // This is a token
          const mint = asset.id;
          const amount = asset.token_info?.balance || 0;
          const decimals = asset.token_info?.decimals || 9;
          
          if (amount > 0) {
            tokenBalances[mint] = {
              amount: amount / Math.pow(10, decimals),
              decimals: decimals,
              name: asset.content?.metadata?.name || 'Unknown Token',
              symbol: asset.content?.metadata?.symbol || 'UNK'
            };
          }
        } else if (asset.interface === 'NonFungibleToken' || asset.interface === 'NonFungible') {
          // This is an NFT
          nftAssets.push({
            id: asset.id,
            name: asset.content?.metadata?.name || 'Unknown NFT',
            collection: asset.grouping?.find((g: any) => g.group_key === 'collection')?.group_value || null,
            image: asset.content?.files?.[0]?.uri || asset.content?.metadata?.image || null
          });
        }
      }

      return {
        tokenBalances,
        nftAssets,
        totalAssets: assets.items?.length || 0
      };
    } catch (error) {
      console.error(`Error fetching DAS token balances for ${walletAddress}:`, error);
      return {
        tokenBalances: {},
        nftAssets: [],
        totalAssets: 0
      };
    }
  }
}

export default SolanaClient;