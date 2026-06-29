export interface SyncTransport {
  send(message: string): void;
  onMessage(handler: (message: string) => void): () => void;
  close(): void;
}
