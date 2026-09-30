/** Evento per aprire una scheda da fuori (dal dock o da un pannello di un modulo). */
export const SHOW_TAB_EVENT = "cuelith:show-tab";

export function showTab(panelId: string): void {
  window.dispatchEvent(new CustomEvent(SHOW_TAB_EVENT, { detail: panelId }));
}
