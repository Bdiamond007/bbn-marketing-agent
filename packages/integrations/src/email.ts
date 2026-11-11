export type Locale = "fr-CA" | "en-CA";

export interface EmailMessage {
  to: string;
  locale: Locale;
  templateKey: string;
  templateVersion: number;
  subject: string;
  text: string;
  /** Clé de déduplication : un même envoi logique n'est émis qu'une fois. */
  idempotencyKey: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<{ messageId: string; deduplicated: boolean }>;
}
