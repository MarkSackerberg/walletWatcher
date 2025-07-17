import { PublicKey } from '@solana/web3.js';

// Wallet and User Management Types
export interface UserWalletMapping {
  userId: string;
  wallets: Set<string>;
}

export interface WalletUserMapping {
  walletAddress: string;
  userId: string;
}

export interface WalletMappingData {
  userWallets: [string, string[]][];
  walletUsers: [string, string][];
}

export interface UserStats {
  userId: string;
  walletCount: number;
  wallets: WalletInfo[];
}

export interface WalletInfo {
  address: string;
  shortAddress: string;
}

// Balance and Transaction Types
export interface TokenBalance {
  amount: number;
  decimals: number;
  name?: string;
  symbol?: string;
}

export interface TokenBalances {
  [mint: string]: TokenBalance;
}

export interface NFTAsset {
  id: string;
  name: string;
  collection?: string | null;
  image?: string | null;
}

export interface WalletBalances {
  solBalance: number;
  tokenBalances: TokenBalances;
  nftCount: number;
  nftAssets: NFTAsset[];
  totalAssets?: number;
}

export interface StoredBalances extends WalletBalances {
  timestamp: string;
}

export interface BalanceData {
  balances: [string, StoredBalances][];
  lastUpdated: string;
}

// Transaction Types
export interface TransactionSummary {
  signature: string;
  timestamp: Date;
  success: boolean;
  solChange: number;
  tokenChanges: { [mint: string]: number };
  fee: number;
  transactionType: string;
}

export interface BalanceChanges {
  solChange: number;
  tokenChanges: { [mint: string]: number };
  success: boolean;
  fee: number;
  signature: string;
  blockTime: number;
}

// Balance Comparison Types
export interface TokenChangeData {
  change: number;
  previousAmount: number;
  currentAmount: number;
  decimals: number;
}

export interface NFTChanges {
  added: NFTAsset[];
  removed: NFTAsset[];
}

export interface BalanceComparison {
  isFirstCheck: boolean;
  solChange: number;
  tokenChanges: { [mint: string]: TokenChangeData };
  nftChanges: NFTChanges;
  previousTimestamp?: string;
}

// DAS API Types
export interface DASTokenBalance {
  amount: number;
  decimals: number;
  name: string;
  symbol: string;
}

export interface DASTokenBalances {
  [mint: string]: DASTokenBalance;
}

export interface DASBalanceData {
  tokenBalances: DASTokenBalances;
  nftAssets: NFTAsset[];
  totalAssets: number;
}

// Token Metadata Types
export interface TokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
}

// Monitor Status Types
export interface MonitorStatus {
  isRunning: boolean;
  monitoredWallets: number;
  pollingInterval: number;
}

// Discord Types
export interface SlashCommandOption {
  name: string;
  description: string;
  required: boolean;
}

// Error Types
export interface WalletError extends Error {
  walletAddress?: string;
  userId?: string;
}

// Expected Payments Types
export interface ExpectedPayment {
  id: string;
  userId: string;
  walletAddress: string;
  expectedAmount: number;
  tokenMint?: string | undefined; // undefined for SOL payments
  note: string;
  dateCreated: Date;
  dueDate?: Date | undefined;
  status: 'pending' | 'received' | 'expired';
  tolerance?: number | undefined; // Allow +/- this amount variance
}

export interface PaymentNote {
  id: string;
  userId: string;
  walletAddress: string;
  transactionSignature: string;
  note: string;
  dateCreated: Date;
  isExpectedPayment: boolean;
  expectedPaymentId?: string;
}

export interface ExpectedPaymentMatch {
  expectedPayment: ExpectedPayment;
  actualAmount: number;
  variance: number;
  isExactMatch: boolean;
  isWithinTolerance: boolean;
}

export interface RecentTransactionMessage {
  userId: string;
  transactionSignature: string;
  messageId: string;
  timestamp: Date;
  walletAddress: string;
}

export interface ExpectedPaymentStorage {
  expectedPayments: [string, ExpectedPayment][];
  paymentNotes: [string, PaymentNote][];
  recentTransactionMessages: [string, RecentTransactionMessage][];
  lastUpdated: string;
}

// Environment Types
export interface EnvironmentConfig {
  DISCORD_BOT_TOKEN: string;
  SOLANA_RPC_URL: string;
  POLLING_INTERVAL?: string;
}

// Solana Transaction Types (extended from web3.js)
export interface ParsedTransaction {
  transaction: {
    message: {
      accountKeys: PublicKey[];
      staticAccountKeys?: PublicKey[];
    };
    signatures: string[];
  };
  meta: {
    err: any;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: Array<{
      accountIndex: number;
      mint: string;
      owner: string;
      uiTokenAmount: {
        amount: string;
        decimals: number;
        uiAmount: number;
      };
    }>;
    postTokenBalances?: Array<{
      accountIndex: number;
      mint: string;
      owner: string;
      uiTokenAmount: {
        amount: string;
        decimals: number;
        uiAmount: number;
      };
    }>;
  };
  blockTime?: number;
}

// Component Interface Types
export interface ISolanaClient {
  getRecentTransactions(walletAddress: string, limit?: number): Promise<any[]>;
  getNewTransactions(walletAddress: string): Promise<any[]>;
  getTransactionDetails(signature: string): Promise<ParsedTransaction | null>;
  getWalletBalance(walletAddress: string): Promise<number>;
  getTokenBalances(walletAddress: string): Promise<TokenBalances>;
  getAssetsByOwner(walletAddress: string): Promise<any>;
  getDasTokenBalances(walletAddress: string): Promise<DASBalanceData>;
}

export interface IWalletStorage {
  initialize(): Promise<void>;
  addWallet(userId: string, walletAddress: string): Promise<void>;
  removeWallet(userId: string, walletAddress: string): Promise<void>;
  getUserWallets(userId: string): string[];
  getWalletOwner(walletAddress: string): string | undefined;
  getAllWallets(): string[];
  getAllUsers(): string[];
  getUserWalletCount(userId: string): number;
  getTotalWalletCount(): number;
  hasWallet(walletAddress: string): boolean;
  isValidSolanaAddress(address: string): boolean;
  getUserStats(userId: string): Promise<UserStats>;
}

export interface IBalanceStorage {
  initialize(): Promise<void>;
  updateWalletBalances(walletAddress: string, balances: WalletBalances): Promise<void>;
  getPreviousBalances(walletAddress: string): StoredBalances | null;
  compareBalances(walletAddress: string, currentBalances: WalletBalances): BalanceComparison;
  hasSignificantChanges(comparison: BalanceComparison): boolean;
  formatBalanceChange(amount: number, decimals?: number): string;
  formatSolChange(change: number): string | null;
}

export interface ITransactionParser {
  parseBalanceChanges(transaction: ParsedTransaction, walletAddress: string): Promise<BalanceChanges>;
  getTransactionSummary(signature: string, walletAddress: string): Promise<TransactionSummary | null>;
  determineTransactionType(balanceChanges: BalanceChanges): string;
  formatBalanceChange(amount: number, decimals?: number): string;
}

export interface IBalanceService {
  getCurrentBalances(walletAddress: string): Promise<WalletBalances>;
  getTokenMetadata(mintAddress: string): Promise<TokenMetadata>;
  getBalanceChangeSummary(walletAddress: string, transactionSummary: TransactionSummary): Promise<string>;
  getBalanceComparisonSummary(walletAddress: string): Promise<string | null>;
  formatBalance(amount: number, decimals?: number): string;
}

export interface IDiscordBot {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendDirectMessage(userId: string, message: string): Promise<boolean>;
  sendTransactionNotification(walletAddress: string, transactionSummary: TransactionSummary, balanceChangeSummary: string): Promise<boolean>;
  sendBalanceChangeNotification(walletAddress: string, balanceComparisonSummary: string): Promise<boolean>;
  sendErrorNotification(walletAddress: string, error: Error): Promise<boolean>;
  sendStartupNotification(): Promise<void>;
}

export interface IWalletMonitor {
  start(): Promise<void>;
  stop(): Promise<void>;
  addWallet(walletAddress: string): Promise<void>;
  removeWallet(walletAddress: string): Promise<void>;
  checkWalletTransactions(walletAddress: string): Promise<void>;
  getStatus(): MonitorStatus;
}

export interface IExpectedPaymentStorage {
  initialize(): Promise<void>;
  addExpectedPayment(expectedPayment: ExpectedPayment): Promise<void>;
  removeExpectedPayment(userId: string, paymentId: string): Promise<void>;
  getExpectedPayments(userId: string): ExpectedPayment[];
  getExpectedPaymentById(paymentId: string): ExpectedPayment | null;
  updateExpectedPaymentStatus(paymentId: string, status: 'pending' | 'received' | 'expired'): Promise<void>;
  addPaymentNote(paymentNote: PaymentNote): Promise<void>;
  getPaymentNotes(userId: string): PaymentNote[];
  getPaymentNoteByTransaction(transactionSignature: string): PaymentNote | null;
  findMatchingExpectedPayment(walletAddress: string, amount: number, tokenMint?: string): ExpectedPaymentMatch | null;
  cleanupExpiredPayments(): Promise<void>;
  generateId(): string;
  addRecentTransactionMessage(message: RecentTransactionMessage): Promise<void>;
  getRecentTransactionByUser(userId: string): RecentTransactionMessage | null;
  cleanupOldTransactionMessages(): Promise<void>;
}