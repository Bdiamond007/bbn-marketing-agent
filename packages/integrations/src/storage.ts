export interface StoredObjectHead {
  key: string;
  contentType: string;
  bytes: number;
  sha256: string;
}

/** Stockage objet privé (S3). Aucune URL publique permanente. */
export interface ObjectStorage {
  putObject(key: string, body: Uint8Array, contentType: string): Promise<StoredObjectHead>;
  getObject(key: string): Promise<{ head: StoredObjectHead; body: Uint8Array } | null>;
  headObject(key: string): Promise<StoredObjectHead | null>;
  deleteObject(key: string): Promise<void>;
  /** URL signée de lecture à durée courte. */
  createSignedGetUrl(key: string, ttlSeconds: number): Promise<string>;
  /** URL signée d'envoi direct, bornée en taille et type. */
  createSignedPutUrl(key: string, opts: { contentType: string; maxBytes: number; ttlSeconds: number }): Promise<string>;
}

export const MAX_SIGNED_URL_TTL_SECONDS = 15 * 60;
