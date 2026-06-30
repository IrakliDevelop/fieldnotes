export interface SyncTransport {
  send(message: string): void;
  onMessage(handler: (message: string) => void): () => void;
  onReconnect?(handler: () => void): () => void; // OPTIONAL — fired after a successful re-open
  close(): void;
}
