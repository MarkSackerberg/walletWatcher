import { 
  Client, 
  GatewayIntentBits, 
  SlashCommandBuilder, 
  REST, 
  Routes, 
  ChatInputCommandInteraction 
} from 'discord.js';
import { 
  IDiscordBot, 
  IWalletStorage, 
  IWalletMonitor, 
  IExpectedPaymentStorage,
  TransactionSummary,
  ExpectedPayment,
  PaymentNote
} from './types';

export class DiscordBot implements IDiscordBot {
  private token: string;
  private walletStorage: IWalletStorage;
  private walletMonitor: IWalletMonitor;
  private expectedPaymentStorage: IExpectedPaymentStorage;
  private client: Client;
  private isReady: boolean;

  constructor(token: string, walletStorage: IWalletStorage, walletMonitor: IWalletMonitor, expectedPaymentStorage: IExpectedPaymentStorage) {
    this.token = token;
    this.walletStorage = walletStorage;
    this.walletMonitor = walletMonitor;
    this.expectedPaymentStorage = expectedPaymentStorage;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.DirectMessages
      ]
    });
    
    this.isReady = false;
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.once('ready', async () => {
      console.log(`Discord bot logged in as ${this.client.user?.tag}!`);
      await this.registerSlashCommands();
      this.isReady = true;
    });

    this.client.on('error', (error) => {
      console.error('Discord client error:', error);
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      await this.handleSlashCommand(interaction);
    });

    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      if (message.channel.type !== 1) return; // Only DMs
      await this.handleDirectMessage(message);
    });
  }

  async start(): Promise<void> {
    try {
      await this.client.login(this.token);
      
      // Wait for the bot to be ready
      while (!this.isReady) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      console.log('Discord bot is ready to send messages!');
    } catch (error) {
      console.error('Failed to start Discord bot:', error);
      throw error;
    }
  }

  async sendDirectMessage(userId: string, message: string): Promise<boolean> {
    if (!this.isReady) {
      console.error('Discord bot is not ready yet');
      return false;
    }

    try {
      const user = await this.client.users.fetch(userId);
      if (!user) {
        console.error(`User with ID ${userId} not found`);
        return false;
      }

      await user.send(message);
      console.log(`Successfully sent DM to ${user.tag}`);
      return true;
    } catch (error) {
      console.error('Failed to send direct message:', error);
      return false;
    }
  }

  async sendDirectMessageWithResponse(userId: string, message: string): Promise<any> {
    if (!this.isReady) {
      console.error('Discord bot is not ready yet');
      return null;
    }

    try {
      const user = await this.client.users.fetch(userId);
      if (!user) {
        console.error(`User with ID ${userId} not found`);
        return null;
      }

      const sentMessage = await user.send(message);
      console.log(`Successfully sent DM to ${user.tag}`);
      return sentMessage;
    } catch (error) {
      console.error('Failed to send direct message:', error);
      return null;
    }
  }

  private async trackTransactionMessage(userId: string, transactionSignature: string, messageId: string, walletAddress: string): Promise<void> {
    try {
      const recentMessage = {
        userId,
        transactionSignature,
        messageId,
        timestamp: new Date(),
        walletAddress
      };
      
      await this.expectedPaymentStorage.addRecentTransactionMessage(recentMessage);
      console.log(`Tracked transaction message for user ${userId}: ${transactionSignature}`);
    } catch (error) {
      console.error('Error tracking transaction message:', error);
    }
  }

  private async handleDirectMessage(message: any): Promise<void> {
    try {
      const userId = message.author.id;
      const content = message.content.trim();
      
      // Check if this is a reply to a recent transaction message
      const recentTransaction = this.expectedPaymentStorage.getRecentTransactionByUser(userId);
      
      if (recentTransaction) {
        // Check if the message is a reply or just a regular message mentioning the transaction
        if (content.length > 0 && content.length <= 500) {
          // Add this as a payment note
          const paymentNote = {
            id: this.expectedPaymentStorage.generateId(),
            userId,
            walletAddress: recentTransaction.walletAddress,
            transactionSignature: recentTransaction.transactionSignature,
            note: content,
            dateCreated: new Date(),
            isExpectedPayment: false
          };
          
          await this.expectedPaymentStorage.addPaymentNote(paymentNote);
          
          // Send confirmation
          const shortSig = `${recentTransaction.transactionSignature.slice(0, 8)}...${recentTransaction.transactionSignature.slice(-8)}`;
          await message.reply(`✅ **Note added to transaction ${shortSig}**\n\n📝 *"${content}"*`);
          
          console.log(`Added note to transaction ${recentTransaction.transactionSignature} for user ${userId}`);
        } else {
          await message.reply('❌ Note too long! Please keep notes under 500 characters.');
        }
      } else {
        // No recent transaction to reply to
        await message.reply('ℹ️ No recent transaction to add a note to. Notes can be added by replying to transaction alerts within 30 minutes, or use `/add-payment-note` with a transaction signature.');
      }
    } catch (error) {
      console.error('Error handling direct message:', error);
      await message.reply('❌ Error processing your message. Please try again.');
    }
  }

  async sendTransactionNotification(walletAddress: string, transactionSummary: TransactionSummary, balanceChangeSummary: string): Promise<boolean> {
    const userId = this.walletStorage.getWalletOwner(walletAddress);
    if (!userId) {
      console.error(`No owner found for wallet ${walletAddress}`);
      return false;
    }

    const message = `🚨 **New Transaction Detected!**\n\n${balanceChangeSummary}\n\n💬 *Reply to this message to add a note about this transaction*`;
    
    // Split message if it's too long (Discord has a 2000 character limit)
    if (message.length > 2000) {
      const chunks = this.splitMessage(message, 2000);
      let lastMessageId: string | null = null;
      
      for (const chunk of chunks) {
        const sentMessage = await this.sendDirectMessageWithResponse(userId, chunk);
        if (!sentMessage) {
          return false;
        }
        lastMessageId = sentMessage.id;
        // Small delay between chunks to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Track the last message for reply handling
      if (lastMessageId) {
        await this.trackTransactionMessage(userId, transactionSummary.signature, lastMessageId, walletAddress);
      }
      return true;
    } else {
      const sentMessage = await this.sendDirectMessageWithResponse(userId, message);
      if (sentMessage) {
        await this.trackTransactionMessage(userId, transactionSummary.signature, sentMessage.id, walletAddress);
        return true;
      }
      return false;
    }
  }

  private splitMessage(message: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let currentChunk = '';
    const lines = message.split('\n');
    
    for (const line of lines) {
      if (currentChunk.length + line.length + 1 <= maxLength) {
        currentChunk += (currentChunk ? '\n' : '') + line;
      } else {
        if (currentChunk) {
          chunks.push(currentChunk);
        }
        currentChunk = line;
      }
    }
    
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    
    return chunks;
  }

  async sendErrorNotification(walletAddress: string, error: Error): Promise<boolean> {
    const userId = this.walletStorage.getWalletOwner(walletAddress);
    if (!userId) {
      console.error(`No owner found for wallet ${walletAddress}`);
      return false;
    }

    const walletName = this.walletStorage.getWalletName(walletAddress);
    const displayName = walletName || `${walletAddress.slice(0, 8)}...${walletAddress.slice(-8)}`;
    const message = `⚠️ **Error monitoring wallet ${displayName}**\n\n\`\`\`${error.message}\`\`\``;
    return await this.sendDirectMessage(userId, message);
  }

  async sendBalanceChangeNotification(walletAddress: string, balanceComparisonSummary: string): Promise<boolean> {
    const userId = this.walletStorage.getWalletOwner(walletAddress);
    if (!userId) {
      console.error(`No owner found for wallet ${walletAddress}`);
      return false;
    }

    const message = balanceComparisonSummary;
    
    // Split message if it's too long (Discord has a 2000 character limit)
    if (message.length > 2000) {
      const chunks = this.splitMessage(message, 2000);
      for (const chunk of chunks) {
        const success = await this.sendDirectMessage(userId, chunk);
        if (!success) {
          return false;
        }
        // Small delay between chunks to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return true;
    } else {
      return await this.sendDirectMessage(userId, message);
    }
  }

  async sendStartupNotification(): Promise<void> {
    const users = this.walletStorage.getAllUsers();
    const totalWallets = this.walletStorage.getTotalWalletCount();
    
    console.log(`🤖 Bot started! Monitoring ${totalWallets} wallets for ${users.length} users.`);
    
    // Don't send Discord messages on startup - just log
  }

  private async registerSlashCommands(): Promise<void> {
    const commands = [
      new SlashCommandBuilder()
        .setName('add-wallet')
        .setDescription('Add a Solana wallet to monitor')
        .addStringOption(option =>
          option.setName('address')
            .setDescription('The Solana wallet address to monitor')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('name')
            .setDescription('A friendly name for this wallet (optional)')
            .setRequired(false)
        ),
      new SlashCommandBuilder()
        .setName('remove-wallet')
        .setDescription('Remove a Solana wallet from monitoring')
        .addStringOption(option =>
          option.setName('address')
            .setDescription('The Solana wallet address to remove')
            .setRequired(true)
        ),
      new SlashCommandBuilder()
        .setName('list-wallets')
        .setDescription('List all your monitored wallets'),
      new SlashCommandBuilder()
        .setName('wallet-stats')
        .setDescription('Show statistics about your monitored wallets'),
      new SlashCommandBuilder()
        .setName('expect-payment')
        .setDescription('Add an expected payment to track')
        .addStringOption(option =>
          option.setName('wallet')
            .setDescription('Wallet address to expect payment on')
            .setRequired(true)
        )
        .addNumberOption(option =>
          option.setName('amount')
            .setDescription('Expected payment amount')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('note')
            .setDescription('Note about what this payment is for')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('token')
            .setDescription('Token mint address (leave empty for SOL)')
            .setRequired(false)
        )
        .addNumberOption(option =>
          option.setName('tolerance')
            .setDescription('Acceptable variance in payment amount')
            .setRequired(false)
        )
        .addStringOption(option =>
          option.setName('due-date')
            .setDescription('Due date (YYYY-MM-DD format)')
            .setRequired(false)
        ),
      new SlashCommandBuilder()
        .setName('list-expected-payments')
        .setDescription('List all your expected payments'),
      new SlashCommandBuilder()
        .setName('remove-expected-payment')
        .setDescription('Remove an expected payment')
        .addStringOption(option =>
          option.setName('payment-id')
            .setDescription('ID of the expected payment to remove')
            .setRequired(true)
        ),
      new SlashCommandBuilder()
        .setName('add-payment-note')
        .setDescription('Add a note to a received payment')
        .addStringOption(option =>
          option.setName('transaction')
            .setDescription('Transaction signature')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('note')
            .setDescription('Note about what this payment was for')
            .setRequired(true)
        ),
      new SlashCommandBuilder()
        .setName('list-payment-notes')
        .setDescription('List all your payment notes')
        .addStringOption(option =>
          option.setName('search')
            .setDescription('Search notes by content')
            .setRequired(false)
        )
        .addStringOption(option =>
          option.setName('wallet')
            .setDescription('Filter by wallet address')
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option.setName('limit')
            .setDescription('Number of notes to show (default: 10)')
            .setRequired(false)
        ),
      new SlashCommandBuilder()
        .setName('get-transaction-note')
        .setDescription('Get the note for a specific transaction')
        .addStringOption(option =>
          option.setName('transaction')
            .setDescription('Transaction signature')
            .setRequired(true)
        )
    ];

    const rest = new REST({ version: '10' }).setToken(this.token);

    try {
      console.log('Started refreshing application (/) commands.');

      // Register global commands (can take up to 1 hour to propagate)
      await rest.put(
        Routes.applicationCommands(this.client.user!.id),
        { body: commands },
      );

      console.log('Successfully reloaded global application (/) commands.');
      
      // Also register to all guilds for immediate updates during development
      const guilds = this.client.guilds.cache;
      if (guilds.size > 0) {
        console.log(`Registering commands to ${guilds.size} guilds for immediate updates...`);
        for (const [guildId, guild] of guilds) {
          try {
            await rest.put(
              Routes.applicationGuildCommands(this.client.user!.id, guildId),
              { body: commands },
            );
            console.log(`Commands registered to guild: ${guild.name}`);
          } catch (guildError) {
            console.error(`Failed to register commands to guild ${guild.name}:`, guildError);
          }
        }
      }
      
      // Log the registered commands for debugging
      console.log('Registered commands:', commands.map(cmd => cmd.name));
    } catch (error) {
      console.error('Error refreshing slash commands:', error);
    }
  }

  private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const { commandName } = interaction;

    try {
      switch (commandName) {
        case 'add-wallet':
          await this.handleAddWallet(interaction);
          break;
        case 'remove-wallet':
          await this.handleRemoveWallet(interaction);
          break;
        case 'list-wallets':
          await this.handleListWallets(interaction);
          break;
        case 'wallet-stats':
          await this.handleWalletStats(interaction);
          break;
        case 'expect-payment':
          await this.handleExpectPayment(interaction);
          break;
        case 'list-expected-payments':
          await this.handleListExpectedPayments(interaction);
          break;
        case 'remove-expected-payment':
          await this.handleRemoveExpectedPayment(interaction);
          break;
        case 'add-payment-note':
          await this.handleAddPaymentNote(interaction);
          break;
        case 'list-payment-notes':
          await this.handleListPaymentNotes(interaction);
          break;
        case 'get-transaction-note':
          await this.handleGetTransactionNote(interaction);
          break;
        default:
          await interaction.reply('Unknown command!');
      }
    } catch (error) {
      console.error(`Error handling command ${commandName}:`, error);
      await interaction.reply('An error occurred while processing your command.');
    }
  }

  private async handleAddWallet(interaction: ChatInputCommandInteraction): Promise<void> {
    const walletAddress = interaction.options.getString('address', true);
    const walletName = interaction.options.getString('name');
    const userId = interaction.user.id;

    if (!this.walletStorage.isValidSolanaAddress(walletAddress)) {
      await interaction.reply('❌ Invalid Solana wallet address! Please provide a valid address.');
      return;
    }

    if (this.walletStorage.hasWallet(walletAddress)) {
      const existingOwner = this.walletStorage.getWalletOwner(walletAddress);
      if (existingOwner === userId) {
        await interaction.reply('⚠️ You are already monitoring this wallet!');
      } else {
        await interaction.reply('❌ This wallet is already being monitored by another user!');
      }
      return;
    }

    try {
      await this.walletStorage.addWallet(userId, walletAddress, walletName || undefined);
      await this.walletMonitor.addWallet(walletAddress);
      
      const displayName = walletName || `${walletAddress.slice(0, 8)}...${walletAddress.slice(-8)}`;
      await interaction.reply(`✅ Successfully added wallet **${displayName}** to your monitoring list!`);
    } catch (error) {
      console.error('Error adding wallet:', error);
      await interaction.reply('❌ Failed to add wallet. Please try again.');
    }
  }

  private async handleRemoveWallet(interaction: ChatInputCommandInteraction): Promise<void> {
    const walletAddress = interaction.options.getString('address', true);
    const userId = interaction.user.id;

    if (!this.walletStorage.hasWallet(walletAddress)) {
      await interaction.reply('❌ This wallet is not being monitored!');
      return;
    }

    const walletOwner = this.walletStorage.getWalletOwner(walletAddress);
    if (walletOwner !== userId) {
      await interaction.reply('❌ You can only remove wallets that you added!');
      return;
    }

    try {
      const walletName = this.walletStorage.getWalletName(walletAddress);
      await this.walletStorage.removeWallet(userId, walletAddress);
      await this.walletMonitor.removeWallet(walletAddress);
      
      const displayName = walletName || `${walletAddress.slice(0, 8)}...${walletAddress.slice(-8)}`;
      await interaction.reply(`✅ Successfully removed wallet **${displayName}** from your monitoring list!`);
    } catch (error) {
      console.error('Error removing wallet:', error);
      await interaction.reply('❌ Failed to remove wallet. Please try again.');
    }
  }

  private async handleListWallets(interaction: ChatInputCommandInteraction): Promise<void> {
    const userId = interaction.user.id;
    const userWallets = this.walletStorage.getUserWallets(userId);

    if (userWallets.length === 0) {
      await interaction.reply('📭 You are not monitoring any wallets yet! Use `/add-wallet` to add one.');
      return;
    }

    const walletList = userWallets.map((wallet, index) => {
      const name = this.walletStorage.getWalletName(wallet);
      const display = name || `${wallet.slice(0, 8)}...${wallet.slice(-8)}`;
      return `${index + 1}. **${display}**${name ? ` (\`${wallet.slice(0, 8)}...${wallet.slice(-8)}\`)` : ''}`;
    }).join('\n');

    const message = `🔍 **Your Monitored Wallets** (${userWallets.length}):\n\n${walletList}`;
    await interaction.reply(message);
  }

  private async handleWalletStats(interaction: ChatInputCommandInteraction): Promise<void> {
    const userId = interaction.user.id;
    const stats = await this.walletStorage.getUserStats(userId);

    if (stats.walletCount === 0) {
      await interaction.reply('📊 You are not monitoring any wallets yet! Use `/add-wallet` to add one.');
      return;
    }

    const message = `📊 **Your Wallet Statistics**\n\n` +
      `🔢 **Total Wallets:** ${stats.walletCount}\n` +
      `🆔 **Your Discord ID:** ${userId}\n\n` +
      `📝 **Wallet Details:**\n` +
      stats.wallets.map((wallet, index) => {
        const display = wallet.name || wallet.shortAddress;
        return `${index + 1}. **${display}**${wallet.name ? ` (${wallet.shortAddress})` : ''}`;
      }).join('\n');

    await interaction.reply(message);
  }

  private async handleExpectPayment(interaction: ChatInputCommandInteraction): Promise<void> {
    const userId = interaction.user.id;
    const walletAddress = interaction.options.getString('wallet', true);
    const amount = interaction.options.getNumber('amount', true);
    const note = interaction.options.getString('note', true);
    const tokenMint = interaction.options.getString('token');
    const tolerance = interaction.options.getNumber('tolerance') || 0;
    const dueDateStr = interaction.options.getString('due-date');

    // Validate wallet address
    if (!this.walletStorage.isValidSolanaAddress(walletAddress)) {
      await interaction.reply('❌ Invalid Solana wallet address!');
      return;
    }

    // Check if user owns this wallet
    const walletOwner = this.walletStorage.getWalletOwner(walletAddress);
    if (walletOwner !== userId) {
      await interaction.reply('❌ You can only expect payments on wallets you own! Use `/add-wallet` first.');
      return;
    }

    // Parse due date if provided
    let dueDate: Date | undefined;
    if (dueDateStr) {
      dueDate = new Date(dueDateStr);
      if (isNaN(dueDate.getTime())) {
        await interaction.reply('❌ Invalid due date format! Use YYYY-MM-DD format.');
        return;
      }
    }

    // Create expected payment
    const expectedPayment: ExpectedPayment = {
      id: this.expectedPaymentStorage.generateId(),
      userId,
      walletAddress,
      expectedAmount: amount,
      tokenMint: tokenMint ?? undefined,
      note,
      dateCreated: new Date(),
      dueDate: dueDate ?? undefined,
      status: 'pending',
      tolerance: tolerance ?? undefined
    };

    try {
      await this.expectedPaymentStorage.addExpectedPayment(expectedPayment);
      const tokenInfo = tokenMint ? ` (${tokenMint.slice(0, 8)}...)` : ' SOL';
      const walletName = this.walletStorage.getWalletName(walletAddress);
      const displayWallet = walletName || `${walletAddress.slice(0, 8)}...${walletAddress.slice(-8)}`;
      await interaction.reply(`✅ Expected payment added!\n\n**ID:** ${expectedPayment.id}\n**Amount:** ${amount}${tokenInfo}\n**Note:** ${note}\n**Wallet:** **${displayWallet}**${tolerance > 0 ? `\n**Tolerance:** ±${tolerance}` : ''}${dueDate ? `\n**Due:** ${dueDate.toDateString()}` : ''}`);
    } catch (error) {
      console.error('Error adding expected payment:', error);
      await interaction.reply('❌ Failed to add expected payment. Please try again.');
    }
  }

  private async handleListExpectedPayments(interaction: ChatInputCommandInteraction): Promise<void> {
    const userId = interaction.user.id;
    const expectedPayments = this.expectedPaymentStorage.getExpectedPayments(userId);

    if (expectedPayments.length === 0) {
      await interaction.reply('📭 You have no expected payments! Use `/expect-payment` to add one.');
      return;
    }

    const pendingPayments = expectedPayments.filter(p => p.status === 'pending');
    const receivedPayments = expectedPayments.filter(p => p.status === 'received');
    const expiredPayments = expectedPayments.filter(p => p.status === 'expired');

    let message = `💰 **Your Expected Payments**\n\n`;

    if (pendingPayments.length > 0) {
      message += `**🟡 Pending (${pendingPayments.length}):**\n`;
      for (const payment of pendingPayments.slice(0, 10)) {
        const tokenInfo = payment.tokenMint ? ` (${payment.tokenMint.slice(0, 8)}...)` : ' SOL';
        const dueInfo = payment.dueDate ? ` | Due: ${payment.dueDate.toDateString()}` : '';
        message += `• **${payment.id}** - ${payment.expectedAmount}${tokenInfo} - ${payment.note}${dueInfo}\n`;
      }
      message += '\n';
    }

    if (receivedPayments.length > 0) {
      message += `**✅ Received (${receivedPayments.length}):**\n`;
      for (const payment of receivedPayments.slice(0, 5)) {
        const tokenInfo = payment.tokenMint ? ` (${payment.tokenMint.slice(0, 8)}...)` : ' SOL';
        message += `• **${payment.id}** - ${payment.expectedAmount}${tokenInfo} - ${payment.note}\n`;
      }
      message += '\n';
    }

    if (expiredPayments.length > 0) {
      message += `**⏰ Expired (${expiredPayments.length}):**\n`;
      for (const payment of expiredPayments.slice(0, 5)) {
        const tokenInfo = payment.tokenMint ? ` (${payment.tokenMint.slice(0, 8)}...)` : ' SOL';
        message += `• **${payment.id}** - ${payment.expectedAmount}${tokenInfo} - ${payment.note}\n`;
      }
    }

    await interaction.reply(message);
  }

  private async handleRemoveExpectedPayment(interaction: ChatInputCommandInteraction): Promise<void> {
    const userId = interaction.user.id;
    const paymentId = interaction.options.getString('payment-id', true);

    try {
      await this.expectedPaymentStorage.removeExpectedPayment(userId, paymentId);
      await interaction.reply(`✅ Expected payment **${paymentId}** has been removed.`);
    } catch (error) {
      console.error('Error removing expected payment:', error);
      await interaction.reply('❌ Expected payment not found or you are not authorized to remove it.');
    }
  }

  private async handleAddPaymentNote(interaction: ChatInputCommandInteraction): Promise<void> {
    const userId = interaction.user.id;
    const transactionSignature = interaction.options.getString('transaction', true);
    const note = interaction.options.getString('note', true);

    // Check if a note already exists for this transaction
    const existingNote = this.expectedPaymentStorage.getPaymentNoteByTransaction(transactionSignature);
    if (existingNote) {
      await interaction.reply('❌ A note already exists for this transaction. Each transaction can only have one note.');
      return;
    }

    // Create payment note
    const paymentNote: PaymentNote = {
      id: this.expectedPaymentStorage.generateId(),
      userId,
      walletAddress: '', // Will be filled when we have wallet validation
      transactionSignature,
      note,
      dateCreated: new Date(),
      isExpectedPayment: false
    };

    try {
      await this.expectedPaymentStorage.addPaymentNote(paymentNote);
      await interaction.reply(`✅ Payment note added!\n\n**Transaction:** \`${transactionSignature.slice(0, 8)}...${transactionSignature.slice(-8)}\`\n**Note:** ${note}`);
    } catch (error) {
      console.error('Error adding payment note:', error);
      await interaction.reply('❌ Failed to add payment note. Please try again.');
    }
  }

  private async handleListPaymentNotes(interaction: ChatInputCommandInteraction): Promise<void> {
    const userId = interaction.user.id;
    const searchTerm = interaction.options.getString('search');
    const walletFilter = interaction.options.getString('wallet');
    const limit = interaction.options.getInteger('limit') || 10;
    
    let paymentNotes = this.expectedPaymentStorage.getPaymentNotes(userId);

    if (paymentNotes.length === 0) {
      await interaction.reply('📭 You have no payment notes! Use `/add-payment-note` to add notes to received payments or reply to transaction alerts.');
      return;
    }

    // Apply filters
    if (searchTerm) {
      paymentNotes = paymentNotes.filter(note => 
        note.note.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (walletFilter) {
      paymentNotes = paymentNotes.filter(note => 
        note.walletAddress.toLowerCase().includes(walletFilter.toLowerCase())
      );
    }

    // Sort by date (newest first)
    paymentNotes.sort((a, b) => b.dateCreated.getTime() - a.dateCreated.getTime());

    if (paymentNotes.length === 0) {
      await interaction.reply(`📭 No payment notes found matching your criteria.${searchTerm ? ` (Search: "${searchTerm}")` : ''}${walletFilter ? ` (Wallet: "${walletFilter}")` : ''}`);
      return;
    }

    const totalNotes = paymentNotes.length;
    const notesToShow = paymentNotes.slice(0, limit);

    let message = `📝 **Your Payment Notes**`;
    if (searchTerm || walletFilter) {
      message += ` (Filtered)`;
    }
    message += `\n*Showing ${notesToShow.length} of ${totalNotes} notes*\n\n`;

    for (const note of notesToShow) {
      const shortSig = `${note.transactionSignature.slice(0, 8)}...${note.transactionSignature.slice(-8)}`;
      const shortWallet = note.walletAddress ? `${note.walletAddress.slice(0, 4)}...${note.walletAddress.slice(-4)}` : 'Unknown';
      const date = note.dateCreated.toLocaleDateString();
      const time = note.dateCreated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const expectedFlag = note.isExpectedPayment ? ' 🎯' : '';
      const replyFlag = note.note.startsWith('Expected payment:') ? '' : ' 💬';
      
      message += `**${shortSig}** ${expectedFlag}${replyFlag}\n`;
      message += `📅 ${date} ${time} | 👛 ${shortWallet}\n`;
      message += `📝 *"${note.note}"*\n\n`;
    }

    if (totalNotes > limit) {
      message += `*...and ${totalNotes - limit} more notes. Use \`limit:${totalNotes}\` to see all.*`;
    }

    if (searchTerm || walletFilter) {
      message += `\n\n🔍 **Filters Applied:**`;
      if (searchTerm) message += `\n• Search: "${searchTerm}"`;
      if (walletFilter) message += `\n• Wallet: "${walletFilter}"`;
    }

    await interaction.reply(message);
  }

  private async handleGetTransactionNote(interaction: ChatInputCommandInteraction): Promise<void> {
    const userId = interaction.user.id;
    const transactionSignature = interaction.options.getString('transaction', true);
    
    const paymentNote = this.expectedPaymentStorage.getPaymentNoteByTransaction(transactionSignature);
    
    if (!paymentNote) {
      await interaction.reply(`❌ No note found for transaction \`${transactionSignature.slice(0, 8)}...${transactionSignature.slice(-8)}\`\n\nUse \`/add-payment-note\` to add a note to this transaction.`);
      return;
    }
    
    if (paymentNote.userId !== userId) {
      await interaction.reply(`❌ You don't have permission to view this note.`);
      return;
    }
    
    const shortSig = `${transactionSignature.slice(0, 8)}...${transactionSignature.slice(-8)}`;
    const shortWallet = paymentNote.walletAddress ? `${paymentNote.walletAddress.slice(0, 6)}...${paymentNote.walletAddress.slice(-6)}` : 'Unknown';
    const date = paymentNote.dateCreated.toLocaleDateString();
    const time = paymentNote.dateCreated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const expectedFlag = paymentNote.isExpectedPayment ? ' 🎯 Expected Payment' : '';
    const replyFlag = paymentNote.note.startsWith('Expected payment:') ? '' : ' 💬 Reply Note';
    
    let message = `📝 **Transaction Note**${expectedFlag}${replyFlag}\n\n`;
    message += `🔗 **Transaction:** \`${shortSig}\`\n`;
    message += `👛 **Wallet:** \`${shortWallet}\`\n`;
    message += `📅 **Date:** ${date} ${time}\n\n`;
    message += `💬 **Note:**\n*"${paymentNote.note}"*`;
    
    if (paymentNote.expectedPaymentId) {
      const expectedPayment = this.expectedPaymentStorage.getExpectedPaymentById(paymentNote.expectedPaymentId);
      if (expectedPayment) {
        message += `\n\n🎯 **Expected Payment ID:** ${expectedPayment.id}`;
      }
    }
    
    await interaction.reply(message);
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
      console.log('Discord bot stopped');
    }
  }
}

export default DiscordBot;