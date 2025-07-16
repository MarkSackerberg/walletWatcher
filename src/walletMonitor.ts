import * as cron from 'node-cron';
import { 
  IWalletMonitor, 
  ISolanaClient, 
  ITransactionParser, 
  IBalanceService, 
  IDiscordBot, 
  IWalletStorage, 
  IExpectedPaymentStorage,
  MonitorStatus 
} from './types';

export class WalletMonitor implements IWalletMonitor {
  private solanaClient: ISolanaClient;
  private transactionParser: ITransactionParser;
  private balanceService: IBalanceService;
  public discordBot: IDiscordBot | null;
  private walletStorage: IWalletStorage;
  private expectedPaymentStorage: IExpectedPaymentStorage;
  private isRunning: boolean;
  private cronJob: cron.ScheduledTask | null;
  private pollingInterval: number;

  constructor(
    solanaClient: ISolanaClient,
    transactionParser: ITransactionParser,
    balanceService: IBalanceService,
    discordBot: IDiscordBot | null,
    walletStorage: IWalletStorage,
    expectedPaymentStorage: IExpectedPaymentStorage
  ) {
    this.solanaClient = solanaClient;
    this.transactionParser = transactionParser;
    this.balanceService = balanceService;
    this.discordBot = discordBot;
    this.walletStorage = walletStorage;
    this.expectedPaymentStorage = expectedPaymentStorage;
    this.isRunning = false;
    this.cronJob = null;
    this.pollingInterval = parseInt(process.env['POLLING_INTERVAL'] || '300000');
  }

  async start(): Promise<void> {
    console.log('Starting wallet monitor...');
    this.isRunning = true;

    // Send startup notification
    if (this.discordBot) {
      await this.discordBot.sendStartupNotification();
    }

    // Clean up expired payments and old transaction messages
    await this.expectedPaymentStorage.cleanupExpiredPayments();
    await this.expectedPaymentStorage.cleanupOldTransactionMessages();

    // Start periodic monitoring
    this.startPeriodicCheck();
    
    const totalWallets = this.walletStorage.getTotalWalletCount();
    console.log(`Wallet monitor started. Checking ${totalWallets} wallets every ${this.pollingInterval/1000} seconds.`);
  }

  private startPeriodicCheck(): void {
    // Convert milliseconds to seconds for cron job
    const intervalSeconds = Math.max(1, Math.floor(this.pollingInterval / 1000));
    
    // Create cron expression for the interval
    let cronExpression: string;
    if (intervalSeconds < 60) {
      // For intervals less than 60 seconds, run every N seconds
      cronExpression = `*/${intervalSeconds} * * * * *`;
    } else {
      // For longer intervals, convert to minutes
      const intervalMinutes = Math.floor(intervalSeconds / 60);
      cronExpression = `*/${intervalMinutes} * * * *`;
    }

    console.log(`Setting up cron job with expression: ${cronExpression}`);
    
    this.cronJob = cron.schedule(cronExpression, async () => {
      if (this.isRunning) {
        await this.checkAllWallets();
      }
    });
  }

  private async checkAllWallets(): Promise<void> {
    const monitoredWallets = this.walletStorage.getAllWallets();
    // Removed excessive logging - don't log every check
    
    for (const walletAddress of monitoredWallets) {
      try {
        await this.checkWalletTransactions(walletAddress);
      } catch (error) {
        console.error(`Error checking wallet ${walletAddress}:`, error);
        if (this.discordBot) {
          await this.discordBot.sendErrorNotification(walletAddress, error as Error);
        }
      }
    }
  }

  async checkWalletTransactions(walletAddress: string): Promise<void> {
    try {
      const newTransactions = await this.solanaClient.getNewTransactions(walletAddress);
      
      if (newTransactions.length === 0) {
        return;
      }

      console.log(`Found ${newTransactions.length} new transactions for wallet ${walletAddress}`);

      // Process transactions in reverse order (oldest first)
      const transactionsToProcess = newTransactions.reverse();
      
      for (const transaction of transactionsToProcess) {
        try {
          const transactionSummary = await this.transactionParser.getTransactionSummary(
            transaction.signature,
            walletAddress
          );

          if (transactionSummary && this.discordBot) {
            const balanceChangeSummary = await this.balanceService.getBalanceChangeSummary(
              walletAddress,
              transactionSummary
            );

            const success = await this.discordBot.sendTransactionNotification(
              walletAddress,
              transactionSummary,
              balanceChangeSummary
            );

            if (success) {
              console.log(`Notification sent for transaction ${transaction.signature}`);
            } else {
              console.error(`Failed to send notification for transaction ${transaction.signature}`);
            }

            // Check for expected payment matches
            await this.checkExpectedPaymentMatches(walletAddress, transactionSummary);

            // After processing transaction, check for balance changes using DAS
            try {
              const balanceComparisonSummary = await this.balanceService.getBalanceComparisonSummary(walletAddress);
              
              if (balanceComparisonSummary) {
                const balanceSuccess = await this.discordBot.sendBalanceChangeNotification(
                  walletAddress,
                  balanceComparisonSummary
                );
                
                if (balanceSuccess) {
                  console.log(`Balance change notification sent for wallet ${walletAddress}`);
                } else {
                  console.error(`Failed to send balance change notification for wallet ${walletAddress}`);
                }
              }
            } catch (error) {
              console.error(`Error checking balance changes for wallet ${walletAddress}:`, error);
            }
          } else {
            console.log(`Skipping transaction ${transaction.signature} - could not parse or not relevant`);
          }
        } catch (error) {
          console.error(`Error processing transaction ${transaction.signature}:`, error);
          console.error('Error details:', (error as Error).message);
          // Continue processing other transactions even if one fails
        }

        // Small delay between processing transactions to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(`Error checking transactions for wallet ${walletAddress}:`, error);
      throw error;
    }
  }

  async checkWalletOnce(walletAddress: string): Promise<void> {
    console.log(`Performing one-time check for wallet ${walletAddress}`);
    await this.checkWalletTransactions(walletAddress);
  }

  async stop(): Promise<void> {
    console.log('Stopping wallet monitor...');
    this.isRunning = false;
    
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    
    console.log('Wallet monitor stopped');
  }

  async addWallet(walletAddress: string): Promise<void> {
    console.log(`Added wallet ${walletAddress} to monitoring`);
    // The wallet is already added to storage, just log the addition
    // No need to restart cron job as it dynamically gets wallets from storage
  }

  async removeWallet(walletAddress: string): Promise<void> {
    console.log(`Removed wallet ${walletAddress} from monitoring`);
    // The wallet is already removed from storage, just log the removal
    // No need to restart cron job as it dynamically gets wallets from storage
  }

  private async checkExpectedPaymentMatches(walletAddress: string, transactionSummary: any): Promise<void> {
    try {
      // Check SOL payments
      if (transactionSummary.solChange > 0) {
        const match = this.expectedPaymentStorage.findMatchingExpectedPayment(
          walletAddress,
          transactionSummary.solChange
        );
        
        if (match && this.discordBot) {
          await this.handleExpectedPaymentMatch(match, transactionSummary);
        }
      }

      // Check token payments
      for (const [tokenMint, change] of Object.entries(transactionSummary.tokenChanges)) {
        if (typeof change === 'number' && change > 0) {
          const match = this.expectedPaymentStorage.findMatchingExpectedPayment(
            walletAddress,
            change,
            tokenMint
          );
          
          if (match && this.discordBot) {
            await this.handleExpectedPaymentMatch(match, transactionSummary);
          }
        }
      }
    } catch (error) {
      console.error('Error checking expected payment matches:', error);
    }
  }

  private async handleExpectedPaymentMatch(match: any, transactionSummary: any): Promise<void> {
    try {
      // Update expected payment status to received
      await this.expectedPaymentStorage.updateExpectedPaymentStatus(match.expectedPayment.id, 'received');
      
      // Create a payment note for the matched payment
      const paymentNote = {
        id: this.expectedPaymentStorage.generateId(),
        userId: match.expectedPayment.userId,
        walletAddress: match.expectedPayment.walletAddress,
        transactionSignature: transactionSummary.signature,
        note: `Expected payment: ${match.expectedPayment.note}`,
        dateCreated: new Date(),
        isExpectedPayment: true,
        expectedPaymentId: match.expectedPayment.id
      };
      
      await this.expectedPaymentStorage.addPaymentNote(paymentNote);
      
      // Send notification about the matched payment
      const tokenInfo = match.expectedPayment.tokenMint ? 
        ` (${match.expectedPayment.tokenMint.slice(0, 8)}...)` : ' SOL';
      
      let message = `🎯 **Expected Payment Received!**\n\n`;
      message += `💰 **Amount:** ${match.actualAmount}${tokenInfo}\n`;
      message += `📝 **Note:** ${match.expectedPayment.note}\n`;
      message += `🔗 **Transaction:** \`${transactionSummary.signature}\`\n`;
      message += `📊 **Status:** ${match.isExactMatch ? 'Exact Match' : 'Within Tolerance'}\n`;
      
      if (!match.isExactMatch) {
        message += `🎯 **Expected:** ${match.expectedPayment.expectedAmount}${tokenInfo}\n`;
        message += `📏 **Variance:** ${match.variance}${tokenInfo}\n`;
      }
      
      await this.discordBot.sendDirectMessage(match.expectedPayment.userId, message);
      
      console.log(`Expected payment matched for user ${match.expectedPayment.userId}: ${match.expectedPayment.note}`);
    } catch (error) {
      console.error('Error handling expected payment match:', error);
    }
  }

  getStatus(): MonitorStatus {
    return {
      isRunning: this.isRunning,
      monitoredWallets: this.walletStorage.getTotalWalletCount(),
      pollingInterval: this.pollingInterval
    };
  }
}

export default WalletMonitor;