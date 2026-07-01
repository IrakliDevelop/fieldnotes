// A Redis connection able to PUBLISH.
export interface RedisPublisher {
  publish(channel: string, message: string): Promise<unknown> | unknown;
}

// A DEDICATED subscriber connection (node-redis v4: client.duplicate() connected; ioredis: a second client).
// A subscriber connection cannot also publish — that is why this is a separate seam.
export interface RedisSubscriber {
  subscribe(channel: string, listener: (message: string) => void): Promise<unknown> | unknown;
}
