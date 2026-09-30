/**
 * Fa salvare un file di testo all'operatore (es. un canto esportato). Sulla
 * postazione del motore si usa la finestra "Salva" del sistema; da browser
 * si scarica il file.
 */
export async function saveTextFile(name: string, content: string, mime: string): Promise<void> {
  const desktop = window.cuelithDesktop;
  if (desktop !== undefined) {
    await desktop.saveTextFile(name, content);
    return;
  }
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
