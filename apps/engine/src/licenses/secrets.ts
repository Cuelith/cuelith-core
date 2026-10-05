/**
 * Custodia dei segreti dell'installazione (chiave del computer, chiavi di
 * licenza). Il motore non conosce Electron: chi lo avvia gli passa una
 * custodia vera (nel desktop: `safeStorage`, cioè la cifratura del sistema
 * operativo legata all'utente del computer: DPAPI su Windows, Portachiavi su
 * macOS, libsecret su Linux). Senza custodia le licenze non si attivano e
 * non si salva nulla in chiaro: mai un ripiego meno sicuro.
 */
export interface SecretStore {
  /** Vero se il sistema sa davvero cifrare (su Linux serve un portachiavi). */
  isAvailable(): boolean;
  /** Cifra un testo: il risultato si può scrivere su disco. */
  encrypt(plain: string): Uint8Array;
  /** Decifra quanto prodotto da `encrypt` su questo computer e per questo utente; lancia se non riesce. */
  decrypt(data: Uint8Array): string;
}
