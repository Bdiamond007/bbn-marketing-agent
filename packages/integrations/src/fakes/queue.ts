import type { Clock } from "@bbn/domain";
import type { MessageQueue, QueueMessage, QueueName } from "../queue";
import { SequentialIds } from "./util";

interface Entry {
  id: string;
  body: unknown;
  visibleAt: number;
  receiveCount: number;
  receiptHandle: string | null;
  deduplicationId: string | undefined;
}

/**
 * File simulée à sémantique « au moins une fois » :
 * - message non acquitté redevient visible après le délai de visibilité ;
 * - au-delà de maxReceiveCount, déplacé en DLQ ;
 * - `duplicateNext()` force une double livraison pour tester l'idempotence.
 */
export class FakeMessageQueue implements MessageQueue {
  private readonly queues = new Map<QueueName, Entry[]>();
  private readonly dlq = new Map<QueueName, Entry[]>();
  private readonly dedupe = new Map<string, string>();
  private readonly ids = new SequentialIds("msg");
  private readonly handles = new SequentialIds("rh");
  private duplicates = 0;

  constructor(private readonly clock: Clock, private readonly maxReceiveCount = 5) {}

  async send<T>(queue: QueueName, body: T, opts?: { delaySeconds?: number; deduplicationId?: string }) {
    if (opts?.deduplicationId) {
      const k = `${queue}:${opts.deduplicationId}`;
      const existing = this.dedupe.get(k);
      if (existing) return { id: existing };
    }
    const id = this.ids.next();
    if (opts?.deduplicationId) this.dedupe.set(`${queue}:${opts.deduplicationId}`, id);
    this.list(queue).push({
      id,
      body: structuredClone(body),
      visibleAt: this.clock.now().getTime() + (opts?.delaySeconds ?? 0) * 1000,
      receiveCount: 0,
      receiptHandle: null,
      deduplicationId: opts?.deduplicationId,
    });
    return { id };
  }

  async receive<T>(queue: QueueName, opts: { maxMessages: number; visibilityTimeoutSeconds: number }): Promise<QueueMessage<T>[]> {
    const now = this.clock.now().getTime();
    const out: QueueMessage<T>[] = [];
    const list = this.list(queue);
    for (const e of [...list]) {
      if (out.length >= opts.maxMessages) break;
      if (e.visibleAt > now) continue;
      if (e.receiveCount >= this.maxReceiveCount) {
        list.splice(list.indexOf(e), 1);
        this.dlqList(queue).push(e);
        continue;
      }
      e.receiveCount += 1;
      e.receiptHandle = this.handles.next();
      e.visibleAt = now + opts.visibilityTimeoutSeconds * 1000;
      out.push({ id: e.id, body: structuredClone(e.body) as T, receiptHandle: e.receiptHandle, receiveCount: e.receiveCount });
      if (this.duplicates > 0) {
        this.duplicates -= 1;
        e.receiveCount += 1;
        const dupHandle = this.handles.next();
        out.push({ id: e.id, body: structuredClone(e.body) as T, receiptHandle: dupHandle, receiveCount: e.receiveCount });
        e.receiptHandle = dupHandle;
      }
    }
    return out;
  }

  async ack(queue: QueueName, receiptHandle: string): Promise<void> {
    const list = this.list(queue);
    const i = list.findIndex((e) => e.receiptHandle === receiptHandle);
    // Accusé d'un handle périmé : ignoré (comportement SQS : le message reste à retraiter).
    if (i >= 0) list.splice(i, 1);
  }

  async changeVisibility(queue: QueueName, receiptHandle: string, visibilityTimeoutSeconds: number): Promise<void> {
    const e = this.list(queue).find((x) => x.receiptHandle === receiptHandle);
    if (e) e.visibleAt = this.clock.now().getTime() + visibilityTimeoutSeconds * 1000;
  }

  /** Force la double livraison des n prochains messages reçus. */
  duplicateNext(n = 1): void {
    this.duplicates += n;
  }
  depth(queue: QueueName): number {
    return this.list(queue).length;
  }
  deadLetters(queue: QueueName): unknown[] {
    return this.dlqList(queue).map((e) => structuredClone(e.body));
  }

  private list(q: QueueName): Entry[] {
    let l = this.queues.get(q);
    if (!l) this.queues.set(q, (l = []));
    return l;
  }
  private dlqList(q: QueueName): Entry[] {
    let l = this.dlq.get(q);
    if (!l) this.dlq.set(q, (l = []));
    return l;
  }
}
