# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm start` - Build and start the production wallet watcher bot
- `npm run dev` - Start the bot in development mode using ts-node
- `npm run build` - Compile TypeScript to JavaScript in dist/ directory
- `npm run type-check` - Check TypeScript types without emitting files
- `npm run watch` - Start development mode with auto-restart using nodemon
- `npm install` or `pnpm install` - Install project dependencies

## Environment Setup

The bot requires a `.env` file with these variables:
- `DISCORD_BOT_TOKEN` - Discord bot token from Discord Developer Portal
- `SOLANA_RPC_URL` - Solana RPC endpoint URL
- `POLLING_INTERVAL` - How often to check for new transactions (milliseconds, default: 30000)

Wallets are now managed dynamically via Discord slash commands, not environment variables.

Copy `.env.example` to `.env` and configure values.

## Code Architecture

The bot follows a modular TypeScript architecture with clear separation of concerns and strong typing:

### Core Components
- **`src/index.ts`** - Main entry point and orchestration class (`WalletWatcherBot`)
- **`src/types.ts`** - TypeScript interfaces and type definitions
- **`src/walletMonitor.ts`** - Handles periodic wallet monitoring using cron jobs
- **`src/solanaClient.ts`** - Solana RPC client with UMI integration for DAS API
- **`src/transactionParser.ts`** - Parses transaction data and balance changes
- **`src/balanceService.ts`** - Fetches current balances and formats transaction summaries
- **`src/discordBot.ts`** - Discord bot with slash commands for wallet management
- **`src/walletStorage.ts`** - JSON-based storage for user-wallet mappings
- **`src/balanceStorage.ts`** - JSON-based storage for balance history and comparison

### Key Patterns
- **Dependency Injection**: Components are injected into each other through constructors
- **Error Handling**: Each component has comprehensive error handling with Discord notifications
- **Graceful Shutdown**: SIGINT/SIGTERM handlers ensure clean shutdown
- **Transaction Tracking**: Uses `lastCheckedSignatures` Map to track processed transactions per wallet
- **Rate Limiting**: Built-in delays between transaction processing and Discord messages
- **Dynamic Wallet Management**: Wallets can be added/removed via Discord slash commands
- **Per-User Notifications**: Each user receives notifications only for their own wallets
- **TypeScript**: Full type safety with interfaces for all components
- **Build System**: TypeScript compilation to `dist/` directory
- **DAS Integration**: Enhanced token detection using Metaplex Digital Asset Standard API
- **Balance Change Tracking**: Compares current balances with previous state using DAS
- **NFT Tracking**: Monitors NFT additions and removals in wallets

### Data Flow
1. Users add wallets via Discord slash commands (`/add-wallet`)
2. `WalletStorage` persists user-wallet mappings in JSON file
3. `WalletMonitor` runs on cron schedule, checking all stored wallets
4. `SolanaClient` fetches new transactions for each monitored wallet
5. `TransactionParser` analyzes transaction data for balance changes
6. `BalanceService` fetches current balances using both RPC and DAS
7. `DiscordBot` sends transaction notifications to the wallet owner via DM
8. `BalanceStorage` compares current vs previous balances using DAS data
9. `DiscordBot` sends additional balance change notifications if significant changes detected

## Dependencies

- **Solana**: `@solana/web3.js` for basic RPC, `@metaplex-foundation/umi` ecosystem for DAS API
- **Discord**: `discord.js` v14 for bot functionality
- **Scheduling**: `node-cron` for periodic wallet checks
- **Environment**: `dotenv` for configuration

## Slash Commands

- `/add-wallet <address>` - Add a Solana wallet to monitor
- `/remove-wallet <address>` - Remove a wallet from monitoring
- `/list-wallets` - List all your monitored wallets
- `/wallet-stats` - Show statistics about your wallets

## Storage

- User-wallet mappings are stored in `walletMappings.json`
- Balance history is stored in `previousBalances.json`
- Files are automatically created on first run
- Supports multiple users with multiple wallets each
- Each wallet can only be monitored by one user
- Balance comparison includes SOL, tokens, and NFTs

## Balance Change Detection

- **Two-tier notification system**: Transaction notifications + balance change notifications
- **DAS Integration**: Uses Metaplex Digital Asset Standard for comprehensive token detection
- **Balance Comparison**: Compares current vs previous balances after each transaction
- **NFT Tracking**: Detects NFT additions and removals using DAS
- **Token Metadata**: Enhanced metadata from DAS including names and symbols
- **Significant Changes Only**: Only sends balance notifications when meaningful changes occur

## Important Notes

- The bot monitors for **new** transactions only, not historical ones
- Transaction parsing handles both SOL and SPL token changes
- NFT tracking is supported via Metaplex DAS API
- Discord messages are automatically split if they exceed 2000 characters
- All token metadata is fetched dynamically for enhanced notifications
- Each user receives notifications only for their own wallets
- Wallets must be valid Solana addresses (validated on addition)
- Balance changes are tracked persistently across bot restarts