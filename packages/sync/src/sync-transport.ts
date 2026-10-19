export interface SyncTransport {
  send(message: string): void;
  onMessage(handler: (message: string) => void): () => void;
  onReconnect?(handler: () => void): () => void; // OPTIONAL — fired after a successful re-open
  onClose?(handler: () => void): () => void; // OPTIONAL — fired on every unintended socket close
  close(): void;
}
