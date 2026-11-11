/** Analyse antivirus des fichiers téléversés (en quarantaine). Live : à brancher (ClamAV, GuardDuty…) en E22/E23. */
export type ScanResult = { clean: true } | { clean: false; signature: string };

export interface MalwareScanner {
  scan(bytes: Uint8Array): Promise<ScanResult>;
}
