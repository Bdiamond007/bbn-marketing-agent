import type { MalwareScanner, ScanResult } from "../scanner";
import { ScenarioScript, SimulatedProviderError } from "../scenario";

/** Fichier de test antivirus standard (EICAR) : reconnu comme infecté, sans danger réel. */
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

export class FakeMalwareScanner implements MalwareScanner {
  readonly scenarios = new ScenarioScript<"auto" | "unavailable">("auto");
  async scan(bytes: Uint8Array): Promise<ScanResult> {
    if (this.scenarios.take() === "unavailable") throw new SimulatedProviderError("scanner.scan");
    return Buffer.from(bytes).includes(EICAR) ? { clean: false, signature: "EICAR-Test-File" } : { clean: true };
  }
}
export const EICAR_TEST_STRING = EICAR;
