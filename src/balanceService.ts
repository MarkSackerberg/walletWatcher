import { 
  IBalanceService, 
  ISolanaClient, 
  IBalanceStorage, 
  IWalletStorage,
  WalletBalances, 
  TokenBalances, 
  TokenMetadata, 
  TransactionSummary
} from './types';

export class BalanceService implements IBalanceService {
  private solanaClient: ISolanaClient;
  private balanceStorage: IBalanceStorage;
  private walletStorage: IWalletStorage;

  constructor(solanaClient: ISolanaClient, balanceStorage: IBalanceStorage, walletStorage: IWalletStorage) {
    this.solanaClient = solanaClient;
    this.balanceStorage = balanceStorage;
    this.walletStorage = walletStorage;
  }

  async getCurrentBalances(walletAddress: string): Promise<WalletBalances> {
    try {
      const [solBalance, rpcTokenBalances, dasData] = await Promise.all([
        this.solanaClient.getWalletBalance(walletAddress),
        this.solanaClient.getTokenBalances(walletAddress),
        this.solanaClient.getDasTokenBalances(walletAddress)
      ]);

      // Merge RPC and DAS token balances (DAS takes precedence for metadata)
      const mergedTokenBalances: TokenBalances = { ...rpcTokenBalances };
      for (const [mint, dasToken] of Object.entries(dasData.tokenBalances)) {
        if (mergedTokenBalances[mint]) {
          // Use DAS metadata but keep RPC balance if available
          mergedTokenBalances[mint].name = dasToken.name;
          mergedTokenBalances[mint].symbol = dasToken.symbol;
        } else {
          // Use DAS token data entirely
          mergedTokenBalances[mint] = dasToken;
        }
      }

      return {
        solBalance: solBalance,
        tokenBalances: mergedTokenBalances,
        nftCount: dasData.nftAssets.length,
        nftAssets: dasData.nftAssets,
        totalAssets: dasData.totalAssets
      };
    } catch (error) {
      console.error(`Error fetching current balances for ${walletAddress}:`, error);
      return {
        solBalance: 0,
        tokenBalances: {},
        nftCount: 0,
        nftAssets: [],
        totalAssets: 0
      };
    }
  }

  async getTokenMetadata(mintAddress: string): Promise<TokenMetadata> {
    try {
      const asset = await this.solanaClient.getAssetsByOwner(''); // Note: This needs to be updated in the interface
      return {
        name: asset.content?.metadata?.name || 'Unknown Token',
        symbol: asset.content?.metadata?.symbol || 'UNK',
        decimals: asset.token_info?.decimals || 9
      };
    } catch (error) {
      console.error(`Error fetching token metadata for ${mintAddress}:`, error);
      return {
        name: 'Unknown Token',
        symbol: 'UNK',
        decimals: 9
      };
    }
  }

  formatBalance(amount: number, decimals: number = 9): string {
    if (amount === 0) return '0';
    if (amount < 0.001) return '<0.001';
    return amount.toFixed(Math.min(decimals, 6));
  }


  private async enrichTokenBalances(tokenBalances: TokenBalances): Promise<Array<{
    mint: string;
    name: string;
    symbol: string;
    amount: number;
    decimals: number;
    formatted: string;
  }>> {
    const enriched = [];
    for (const [mint, balance] of Object.entries(tokenBalances)) {
      if (balance.amount > 0) {
        try {
          const metadata = await this.getTokenMetadata(mint);
          enriched.push({
            mint: mint,
            name: metadata.name,
            symbol: metadata.symbol,
            amount: balance.amount,
            decimals: balance.decimals,
            formatted: this.formatBalance(balance.amount, balance.decimals)
          });
        } catch (error) {
          console.error(`Error enriching token ${mint}:`, error);
          enriched.push({
            mint: mint,
            name: 'Unknown Token',
            symbol: 'UNK',
            amount: balance.amount,
            decimals: balance.decimals,
            formatted: this.formatBalance(balance.amount, balance.decimals)
          });
        }
      }
    }
    return enriched;
  }

  async getBalanceChangeSummary(walletAddress: string, transactionSummary: TransactionSummary): Promise<string> {
    const currentBalances = await this.getCurrentBalances(walletAddress);
    const walletName = this.walletStorage.getWalletName(walletAddress);
    const displayName = walletName || `${walletAddress.slice(0, 8)}...${walletAddress.slice(-8)}`;
    
    let summary = `**Transaction Summary for ${displayName}**\n\n`;
    summary += `🔗 **Signature:** \`${transactionSummary.signature}\`\n`;
    summary += `⏰ **Time:** ${transactionSummary.timestamp.toLocaleString()}\n`;
    summary += `${transactionSummary.success ? '✅' : '❌'} **Status:** ${transactionSummary.success ? 'Success' : 'Failed'}\n`;
    summary += `📊 **Type:** ${transactionSummary.transactionType}\n\n`;

    if (transactionSummary.solChange !== 0) {
      const changeSymbol = transactionSummary.solChange > 0 ? '+' : '';
      summary += `💰 **SOL Change:** ${changeSymbol}${transactionSummary.solChange.toFixed(6)} SOL\n`;
    }

    if (transactionSummary.fee > 0) {
      summary += `💸 **Fee:** ${transactionSummary.fee.toFixed(6)} SOL\n`;
    }

    if (Object.keys(transactionSummary.tokenChanges).length > 0) {
      summary += `\n**Token Changes:**\n`;
      for (const [mint, change] of Object.entries(transactionSummary.tokenChanges)) {
        const changeSymbol = change > 0 ? '+' : '';
        const metadata = await this.getTokenMetadata(mint);
        summary += `🪙 **${metadata.name} (${metadata.symbol}):** ${changeSymbol}${this.formatBalance(change, metadata.decimals)}\n`;
      }
    }

    summary += `\n**Current Balances:**\n`;
    summary += `💰 **SOL:** ${this.formatBalance(currentBalances.solBalance, 9)} SOL\n`;

    if (Object.keys(currentBalances.tokenBalances).length > 0) {
      const enrichedTokens = await this.enrichTokenBalances(currentBalances.tokenBalances);
      for (const token of enrichedTokens) {
        summary += `🪙 **${token.name} (${token.symbol}):** ${token.formatted}\n`;
      }
    }

    if (currentBalances.nftCount > 0) {
      summary += `🖼️ **NFTs:** ${currentBalances.nftCount} assets\n`;
    }

    return summary;
  }

  async getBalanceComparisonSummary(walletAddress: string): Promise<string | null> {
    const currentBalances = await this.getCurrentBalances(walletAddress);
    const comparison = this.balanceStorage.compareBalances(walletAddress, currentBalances);
    const walletName = this.walletStorage.getWalletName(walletAddress);
    const displayName = walletName || `${walletAddress.slice(0, 8)}...${walletAddress.slice(-8)}`;
    
    // Update stored balances for next comparison
    await this.balanceStorage.updateWalletBalances(walletAddress, currentBalances);
    
    if (comparison.isFirstCheck) {
      return `📊 **Initial Balance Snapshot for ${displayName}**\n\n` +
             `💰 **SOL:** ${this.formatBalance(currentBalances.solBalance, 9)} SOL\n` +
             this.formatTokenBalancesForSummary(currentBalances.tokenBalances) +
             (currentBalances.nftCount > 0 ? `🖼️ **NFTs:** ${currentBalances.nftCount} assets\n` : '') +
             `\n*This is the first check for this wallet. Future changes will be compared to these balances.*`;
    }
    
    if (!this.balanceStorage.hasSignificantChanges(comparison)) {
      return null; // No significant changes to report
    }
    
    let summary = `📈 **Balance Changes Detected for ${displayName}**\n\n`;
    
    if (comparison.solChange !== 0) {
      const solChangeStr = this.balanceStorage.formatSolChange(comparison.solChange);
      summary += `💰 **SOL Change:** ${solChangeStr} (Now: ${this.formatBalance(currentBalances.solBalance, 9)} SOL)\n`;
    }
    
    if (Object.keys(comparison.tokenChanges).length > 0) {
      summary += `\n**Token Balance Changes:**\n`;
      for (const [mint, changeData] of Object.entries(comparison.tokenChanges)) {
        const tokenInfo = currentBalances.tokenBalances[mint] || { name: 'Unknown Token', symbol: 'UNK' };
        const changeStr = this.balanceStorage.formatBalanceChange(changeData.change, changeData.decimals);
        const currentStr = this.formatBalance(changeData.currentAmount, changeData.decimals);
        summary += `🪙 **${tokenInfo.name} (${tokenInfo.symbol}):** ${changeStr} (Now: ${currentStr})\n`;
      }
    }
    
    if (comparison.nftChanges.added.length > 0) {
      summary += `\n**NFTs Added:**\n`;
      for (const nft of comparison.nftChanges.added.slice(0, 5)) { // Limit to 5 to avoid spam
        summary += `🖼️ **${nft.name}** (${nft.id.slice(0, 8)}...)\n`;
      }
      if (comparison.nftChanges.added.length > 5) {
        summary += `*...and ${comparison.nftChanges.added.length - 5} more NFTs*\n`;
      }
    }
    
    if (comparison.nftChanges.removed.length > 0) {
      summary += `\n**NFTs Removed:**\n`;
      for (const nft of comparison.nftChanges.removed.slice(0, 5)) { // Limit to 5
        summary += `🖼️ **${nft.name}** (${nft.id.slice(0, 8)}...)\n`;
      }
      if (comparison.nftChanges.removed.length > 5) {
        summary += `*...and ${comparison.nftChanges.removed.length - 5} more NFTs*\n`;
      }
    }
    
    summary += `\n**Current Total:**\n`;
    summary += `💰 **SOL:** ${this.formatBalance(currentBalances.solBalance, 9)} SOL\n`;
    if (Object.keys(currentBalances.tokenBalances).length > 0) {
      const tokenCount = Object.keys(currentBalances.tokenBalances).length;
      summary += `🪙 **Tokens:** ${tokenCount} different tokens\n`;
    }
    if (currentBalances.nftCount > 0) {
      summary += `🖼️ **NFTs:** ${currentBalances.nftCount} assets\n`;
    }
    
    return summary;
  }
  
  private formatTokenBalancesForSummary(tokenBalances: TokenBalances): string {
    let summary = '';
    for (const [, balance] of Object.entries(tokenBalances)) {
      const name = balance.name || 'Unknown Token';
      const symbol = balance.symbol || 'UNK';
      const formatted = this.formatBalance(balance.amount, balance.decimals);
      summary += `🪙 **${name} (${symbol}):** ${formatted}\n`;
    }
    return summary;
  }
}

export default BalanceService;