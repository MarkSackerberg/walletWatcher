# Solana Wallet Watcher Discord Bot

A TypeScript Discord bot that monitors Solana wallet transactions and sends real-time notifications via Discord DMs using Metaplex UMI and the Digital Asset Standard (DAS) API.

## Features

- **Real-time Transaction Monitoring**: Continuously monitors user-added Solana wallets for new transactions
- **Discord Slash Commands**: Add/remove wallets dynamically using Discord slash commands
- **Per-User Notifications**: Each user receives notifications only for their own wallets
- **Balance Change Analysis**: Parses transactions to identify SOL and token balance changes
- **DAS Integration**: Enhanced token and NFT detection using Metaplex Digital Asset Standard API
- **Balance Change Tracking**: Compares current vs previous balances after each transaction
- **Discord Notifications**: Sends detailed transaction summaries via Discord DMs
- **Current Balance Tracking**: Shows updated wallet balances after each transaction
- **NFT Support**: Tracks NFT collections using Metaplex DAS API with add/remove detection
- **Token Metadata**: Enriches token information with names and symbols
- **Error Handling**: Robust error handling with notification system
- **Graceful Shutdown**: Proper cleanup on process termination

## Setup

### Prerequisites

- Node.js (v16 or higher)
- Discord Bot Token
- Solana RPC URL

### Installation

1. Clone or download the project
2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```

4. Configure your environment variables in `.env`:
   ```env
   DISCORD_BOT_TOKEN=your_discord_bot_token_here
   SOLANA_RPC_URL=your_solana_rpc_url_here
   POLLING_INTERVAL=30000
   ```

### Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application and bot
3. Copy the bot token to your `.env` file
4. Invite the bot to your server or ensure it can send DMs to your user

### Discord Bot Permissions

The bot needs these permissions:
- **Send Messages**: To send DMs to users
- **Use Slash Commands**: To register and respond to slash commands
- **Read Message History**: To interact with commands

## Usage

### Start the Bot

**Production (compiled TypeScript):**
```bash
npm start
```

**Development (direct TypeScript execution):**
```bash
npm run dev
```

**Development with auto-restart:**
```bash
npm run watch
```

**Build TypeScript:**
```bash
npm run build
```

### Configuration Options

- `POLLING_INTERVAL`: How often to check for new transactions (in milliseconds)
- `SOLANA_RPC_URL`: Your Solana RPC endpoint (can be public or private)

## Bot Behavior

### Adding Wallets

Users can add wallets to monitor using Discord slash commands:
- `/add-wallet <address>` - Add a Solana wallet to your monitoring list
- `/remove-wallet <address>` - Remove a wallet from your monitoring list
- `/list-wallets` - List all your monitored wallets
- `/wallet-stats` - Show statistics about your wallets

### Transaction Monitoring

The bot will:
1. Check each user's monitored wallets for new transactions every `POLLING_INTERVAL` milliseconds
2. Parse new transactions to identify balance changes
3. Send a Discord DM to the wallet owner with transaction details and current balances
4. Use DAS API to fetch comprehensive balance data (including enhanced token metadata)
5. Compare current balances with previous state and send additional balance change notifications
6. Track transaction history to avoid duplicate notifications
7. Monitor NFT additions and removals using DAS integration

### Notification Format

**Transaction Notifications** include:
- **Transaction signature** and timestamp
- **Transaction type** (Received SOL, Sent SOL, Token Swap, etc.)
- **Balance changes** for SOL and tokens
- **Transaction fees**
- **Current wallet balances** (SOL, tokens, NFT count)
- **Token metadata** (names and symbols)

**Balance Change Notifications** include:
- **SOL balance changes** compared to previous state
- **Token balance changes** with before/after amounts
- **NFT additions/removals** with asset details
- **Current total balances** across all assets
- **DAS-enhanced metadata** for better token identification

### Error Handling

The bot includes comprehensive error handling:
- Network connectivity issues
- Invalid wallet addresses
- RPC failures
- Discord API errors
- Graceful shutdown on process termination

## File Structure

```
walletWatcher/
├── src/
│   ├── index.ts              # Main application entry point
│   ├── types.ts              # TypeScript interfaces and type definitions
│   ├── solanaClient.ts       # Solana RPC and UMI client with DAS integration
│   ├── transactionParser.ts  # Transaction parsing logic
│   ├── balanceService.ts     # Balance fetching, formatting, and comparison
│   ├── discordBot.ts         # Discord bot with slash commands
│   ├── walletMonitor.ts      # Wallet monitoring orchestration
│   ├── walletStorage.ts      # User-wallet mapping storage
│   └── balanceStorage.ts     # Balance history and comparison logic
├── dist/                     # Compiled JavaScript output
├── walletMappings.json       # Persistent storage for user-wallet mappings
├── previousBalances.json     # Persistent storage for balance history
├── tsconfig.json             # TypeScript configuration
├── .env.example              # Environment configuration template
├── .gitignore               # Git ignore file
├── package.json             # Dependencies and scripts
└── README.md               # This file
```

## Dependencies

### Runtime Dependencies
- **discord.js**: Discord API client
- **@metaplex-foundation/umi**: Metaplex UMI framework
- **@metaplex-foundation/digital-asset-standard-api**: DAS API client
- **@solana/web3.js**: Solana web3 client
- **dotenv**: Environment variable management
- **node-cron**: Scheduling system

### Development Dependencies
- **typescript**: TypeScript compiler
- **ts-node**: Direct TypeScript execution for development
- **@types/node**: Node.js type definitions
- **@types/node-cron**: node-cron type definitions
- **nodemon**: Auto-restart for development

## Troubleshooting

### Common Issues

1. **Bot not starting**: Check that all environment variables are properly set
2. **No notifications**: Verify the bot can send DMs to the target user
3. **RPC errors**: Ensure your Solana RPC URL is valid and accessible
4. **Token metadata missing**: Some tokens may not have metadata available

### Logs

The bot provides detailed console logging for:
- Startup process
- Transaction detection
- Notification sending
- Error conditions

## Security

- Never commit your `.env` file to version control
- Use environment variables for all sensitive configuration
- Consider using a private RPC endpoint for better reliability
- Rotate your Discord bot token regularly

## License

MIT License - see LICENSE file for details