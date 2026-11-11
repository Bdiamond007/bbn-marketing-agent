export type QueueName = "generation" | "publishing" | "notifications" | "projections";

export interface QueueMessage<T = unknown> {
  id: string;
  body: T;
  receiptHandle: string;
  /** Nombre de livraisons, 1 à la première. Livraison au moins une fois : >1 possible. */
  receiveCount: number;
}

/** File livrée au moins une fois (SQS). Les consommateurs doivent être idempotents. */
export interface MessageQueue {
  send<T>(queue: QueueName, body: T, opts?: { delaySeconds?: number; deduplicationId?: string }): Promise<{ id: string }>;
  receive<T>(queue: QueueName, opts: { maxMessages: number; visibilityTimeoutSeconds: number }): Promise<QueueMessage<T>[]>;
  ack(queue: QueueName, receiptHandle: string): Promise<void>;
  changeVisibility(queue: QueueName, receiptHandle: string, visibilityTimeoutSeconds: number): Promise<void>;
}
