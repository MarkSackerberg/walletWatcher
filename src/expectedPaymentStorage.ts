import { promises as fs } from 'fs';
import path from 'path';
import { 
  IExpectedPaymentStorage, 
  ExpectedPayment, 
  PaymentNote, 
  ExpectedPaymentMatch, 
  ExpectedPaymentStorage,
  RecentTransactionMessage
} from './types';

export class ExpectedPaymentStorageService implements IExpectedPaymentStorage {
  private filePath: string;
  private expectedPayments: Map<string, ExpectedPayment>;
  private paymentNotes: Map<string, PaymentNote>;
  private recentTransactionMessages: Map<string, RecentTransactionMessage>;

  constructor(filePath: string = 'expectedPayments.json') {
    this.filePath = path.resolve(filePath);
    this.expectedPayments = new Map();
    this.paymentNotes = new Map();
    this.recentTransactionMessages = new Map();
  }

  async initialize(): Promise<void> {
    try {
      await this.loadFromFile();
    } catch (error) {
      console.log('No existing expected payments found, starting with empty storage');
      this.expectedPayments = new Map();
      this.paymentNotes = new Map();
      this.recentTransactionMessages = new Map();
    }
  }

  private async loadFromFile(): Promise<void> {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      const parsed: ExpectedPaymentStorage = JSON.parse(data);
      
      // Convert data back to Maps
      this.expectedPayments = new Map();
      if (parsed.expectedPayments) {
        for (const [id, payment] of parsed.expectedPayments) {
          // Convert date strings back to Date objects
          const paymentWithDates: ExpectedPayment = {
            ...payment,
            dateCreated: new Date(payment.dateCreated),
            dueDate: payment.dueDate ? new Date(payment.dueDate) : undefined,
            tokenMint: payment.tokenMint ?? undefined,
            tolerance: payment.tolerance ?? undefined
          };
          this.expectedPayments.set(id, paymentWithDates);
        }
      }
      
      this.paymentNotes = new Map();
      if (parsed.paymentNotes) {
        for (const [id, note] of parsed.paymentNotes) {
          // Convert date strings back to Date objects
          const noteWithDates = {
            ...note,
            dateCreated: new Date(note.dateCreated)
          };
          this.paymentNotes.set(id, noteWithDates);
        }
      }
      
      this.recentTransactionMessages = new Map();
      if (parsed.recentTransactionMessages) {
        for (const [id, message] of parsed.recentTransactionMessages) {
          // Convert date strings back to Date objects
          const messageWithDates = {
            ...message,
            timestamp: new Date(message.timestamp)
          };
          this.recentTransactionMessages.set(id, messageWithDates);
        }
      }
      
      console.log(`Loaded ${this.expectedPayments.size} expected payments, ${this.paymentNotes.size} payment notes, and ${this.recentTransactionMessages.size} recent transaction messages`);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error('Error loading expected payments:', error);
      }
      throw error;
    }
  }

  private async saveToFile(): Promise<void> {
    try {
      const data: ExpectedPaymentStorage = {
        expectedPayments: Array.from(this.expectedPayments.entries()),
        paymentNotes: Array.from(this.paymentNotes.entries()),
        recentTransactionMessages: Array.from(this.recentTransactionMessages.entries()),
        lastUpdated: new Date().toISOString()
      };
      
      await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error saving expected payments:', error);
      throw error;
    }
  }

  async addExpectedPayment(expectedPayment: ExpectedPayment): Promise<void> {
    this.expectedPayments.set(expectedPayment.id, expectedPayment);
    await this.saveToFile();
    console.log(`Added expected payment ${expectedPayment.id} for user ${expectedPayment.userId}`);
  }

  async removeExpectedPayment(userId: string, paymentId: string): Promise<void> {
    const payment = this.expectedPayments.get(paymentId);
    if (payment && payment.userId === userId) {
      this.expectedPayments.delete(paymentId);
      await this.saveToFile();
      console.log(`Removed expected payment ${paymentId} for user ${userId}`);
    } else {
      throw new Error('Expected payment not found or user not authorized');
    }
  }

  getExpectedPayments(userId: string): ExpectedPayment[] {
    return Array.from(this.expectedPayments.values()).filter(payment => payment.userId === userId);
  }

  getExpectedPaymentById(paymentId: string): ExpectedPayment | null {
    return this.expectedPayments.get(paymentId) || null;
  }

  async updateExpectedPaymentStatus(paymentId: string, status: 'pending' | 'received' | 'expired'): Promise<void> {
    const payment = this.expectedPayments.get(paymentId);
    if (payment) {
      payment.status = status;
      await this.saveToFile();
      console.log(`Updated expected payment ${paymentId} status to ${status}`);
    } else {
      throw new Error('Expected payment not found');
    }
  }

  async addPaymentNote(paymentNote: PaymentNote): Promise<void> {
    this.paymentNotes.set(paymentNote.id, paymentNote);
    await this.saveToFile();
    console.log(`Added payment note ${paymentNote.id} for user ${paymentNote.userId}`);
  }

  getPaymentNotes(userId: string): PaymentNote[] {
    return Array.from(this.paymentNotes.values()).filter(note => note.userId === userId);
  }

  getPaymentNoteByTransaction(transactionSignature: string): PaymentNote | null {
    return Array.from(this.paymentNotes.values()).find(note => note.transactionSignature === transactionSignature) || null;
  }

  findMatchingExpectedPayment(walletAddress: string, amount: number, tokenMint?: string): ExpectedPaymentMatch | null {
    // Find pending expected payments for this wallet
    const pendingPayments = Array.from(this.expectedPayments.values()).filter(payment => 
      payment.walletAddress === walletAddress && 
      payment.status === 'pending' &&
      payment.tokenMint === tokenMint
    );

    // Look for exact matches first
    for (const payment of pendingPayments) {
      if (payment.expectedAmount === amount) {
        return {
          expectedPayment: payment,
          actualAmount: amount,
          variance: 0,
          isExactMatch: true,
          isWithinTolerance: true
        };
      }
    }

    // Look for matches within tolerance
    for (const payment of pendingPayments) {
      if (payment.tolerance && payment.tolerance > 0) {
        const variance = Math.abs(payment.expectedAmount - amount);
        if (variance <= payment.tolerance) {
          return {
            expectedPayment: payment,
            actualAmount: amount,
            variance: variance,
            isExactMatch: false,
            isWithinTolerance: true
          };
        }
      }
    }

    // No matches found
    return null;
  }

  async cleanupExpiredPayments(): Promise<void> {
    const now = new Date();
    let removedCount = 0;

    for (const [, payment] of this.expectedPayments.entries()) {
      if (payment.dueDate && payment.dueDate < now && payment.status === 'pending') {
        payment.status = 'expired';
        removedCount++;
      }
    }

    if (removedCount > 0) {
      await this.saveToFile();
      console.log(`Marked ${removedCount} expected payments as expired`);
    }
  }

  async addRecentTransactionMessage(message: RecentTransactionMessage): Promise<void> {
    // Store message with userId as key for easy lookup
    this.recentTransactionMessages.set(message.userId, message);
    await this.saveToFile();
    console.log(`Added recent transaction message for user ${message.userId}: ${message.transactionSignature}`);
  }

  getRecentTransactionByUser(userId: string): RecentTransactionMessage | null {
    return this.recentTransactionMessages.get(userId) || null;
  }

  async cleanupOldTransactionMessages(): Promise<void> {
    const now = new Date();
    const maxAge = 30 * 60 * 1000; // 30 minutes
    let removedCount = 0;

    for (const [userId, message] of this.recentTransactionMessages.entries()) {
      if (now.getTime() - message.timestamp.getTime() > maxAge) {
        this.recentTransactionMessages.delete(userId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      await this.saveToFile();
      console.log(`Cleaned up ${removedCount} old transaction messages`);
    }
  }

  // Helper method to generate unique IDs
  generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }
}

export default ExpectedPaymentStorageService;