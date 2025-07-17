import 'dotenv/config';

// Polyfill for ReadableStream in older Node.js versions
if (typeof globalThis.ReadableStream === 'undefined') {
  const { ReadableStream } = require('stream/web');
  globalThis.ReadableStream = ReadableStream;
}
import SolanaClient from './solanaClient';
import TransactionParser from './transactionParser';
import BalanceService from './balanceService';
import DiscordBot from './discordBot';
import WalletMonitor from './walletMonitor';
import WalletStorage from './walletStorage';
import BalanceStorage from './balanceStorage';
import ExpectedPaymentStorageService from './expectedPaymentStorage';
import { EnvironmentConfig } from './types';

class WalletWatcherBot {
  private solanaClient!: SolanaClient;
  private transactionParser!: TransactionParser;
  private balanceService!: BalanceService;
  private discordBot!: DiscordBot;
  private walletMonitor!: WalletMonitor;
  private walletStorage!: WalletStorage;
  private balanceStorage!: BalanceStorage;
  private expectedPaymentStorage!: ExpectedPaymentStorageService;

  constructor() {
    this.validateEnvironment();
    // initializeComponents is now called in start() since it's async
  }

  private validateEnvironment(): void {
    const requiredEnvVars: (keyof EnvironmentConfig)[] = [
      'DISCORD_BOT_TOKEN',
      'SOLANA_RPC_URL'
    ];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
      }
    }

    console.log('Configuration validated.');
  }

  private async initializeComponents(): Promise<void> {
    // Initialize wallet storage
    this.walletStorage = new WalletStorage();
    await this.walletStorage.initialize();
    
    // Initialize balance storage
    this.balanceStorage = new BalanceStorage();
    await this.balanceStorage.initialize();
    
    // Initialize expected payment storage
    this.expectedPaymentStorage = new ExpectedPaymentStorageService();
    await this.expectedPaymentStorage.initialize();
    
    // Initialize Solana client
    this.solanaClient = new SolanaClient(process.env['SOLANA_RPC_URL']!);
    
    // Initialize transaction parser
    this.transactionParser = new TransactionParser(this.solanaClient);
    
    // Initialize balance service
    this.balanceService = new BalanceService(this.solanaClient, this.balanceStorage, this.walletStorage);
    
    // Initialize wallet monitor
    this.walletMonitor = new WalletMonitor(
      this.solanaClient,
      this.transactionParser,
      this.balanceService,
      null, // Discord bot will be set later
      this.walletStorage,
      this.expectedPaymentStorage
    );
    
    // Initialize Discord bot (needs wallet storage and wallet monitor)
    this.discordBot = new DiscordBot(
      process.env['DISCORD_BOT_TOKEN']!,
      this.walletStorage,
      this.walletMonitor,
      this.expectedPaymentStorage
    );
    
    // Set discord bot reference in wallet monitor
    this.walletMonitor.discordBot = this.discordBot;
  }

  async start(): Promise<void> {
    try {
      console.log('🤖 Starting Wallet Watcher Bot...');
      
      // Initialize components (now async)
      await this.initializeComponents();
      
      // Start Discord bot
      await this.discordBot.start();
      
      // Start wallet monitoring
      await this.walletMonitor.start();
      
      console.log('✅ Wallet Watcher Bot is now running!');
      console.log('Press Ctrl+C to stop the bot.');
      
    } catch (error) {
      console.error('❌ Failed to start Wallet Watcher Bot:', error);
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    console.log('🛑 Stopping Wallet Watcher Bot...');
    
    try {
      await this.walletMonitor.stop();
      await this.discordBot.stop();
      console.log('✅ Wallet Watcher Bot stopped successfully');
    } catch (error) {
      console.error('❌ Error stopping bot:', error);
    }
  }
}

// Extend global interface for the bot instance
declare global {
  var walletWatcherBot: WalletWatcherBot | undefined;
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  if (global.walletWatcherBot) {
    await global.walletWatcherBot.stop();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  if (global.walletWatcherBot) {
    await global.walletWatcherBot.stop();
  }
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the bot
async function main(): Promise<void> {
  const bot = new WalletWatcherBot();
  global.walletWatcherBot = bot;
  await bot.start();
}

if (require.main === module) {
  main().catch(console.error);
}

export default WalletWatcherBot;