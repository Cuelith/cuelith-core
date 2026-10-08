import { z } from "zod";

// Stili dei template di look del nucleo (cap. 07 e 22). Il campo `style` di
// un Look e' generico nel protocollo; qui ogni template del nucleo dichiara
// cosa ci si aspetta, cosi' motore e renderer validano la stessa forma.

const Color = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const Transition = z.strictObject({
  type: z.enum(["cut", "fade"]),
  durationMs: z.number().int().min(0).max(10_000),
});

// Tutto cio' che segue "margin" e' facoltativo: uno stile scritto prima (o senza) questi campi
// resta valido e si disegna come sempre (decisione 0015).
export const TextStyleSchema = z.strictObject({
  font: z.enum(["display", "body", "mono"]),
  /** Dimensione del testo in pixel su un'uscita alta 1080 pixel; scala con l'uscita. */
  size: z.number().min(8).max(400),
  color: Color,
  align: z.enum(["left", "center", "right"]),
  /** Margine interno come frazione del lato piu' corto dell'uscita. */
  margin: z.number().min(0).max(0.4),
  /** Interlinea come multiplo della dimensione (predefinita 1,25). */
  lineHeight: z.number().min(0.8).max(2.5).optional(),
  weight: z.enum(["normal", "bold"]).optional(),
  uppercase: z.boolean().optional(),
  /**
   * Adattamento automatico: se una slide non entra, il testo si rimpicciolisce fino a
   * "min" volte la dimensione (la stessa per tutte le slide dello stesso elemento).
   * Assente = nessun adattamento.
   */
  fit: z.strictObject({ min: z.number().min(0.3).max(1) }).optional(),
  /** Bordo delle lettere: spessore in pixel su un'uscita alta 1080 pixel (scala con l'uscita). */
  outline: z.strictObject({ width: z.number().min(0).max(20), color: Color }).optional(),
  /** Ombra: distanza e sfumatura in pixel su un'uscita alta 1080 pixel. */
  shadow: z
    .strictObject({
      offset: z.number().min(0).max(30),
      blur: z.number().min(0).max(30),
      color: Color,
    })
    .optional(),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

export { TextOverrideSchema, type TextOverride } from "@cuelith/protocol";

/**
 * Stile globale scelto per un look (decisione 0015): una copia dello stile salvato
 * dall'utente, cosi' lo show si vede uguale anche su un computer dove quello stile non esiste.
 * Finche' c'e', sostituisce del tutto le modifiche dell'editor.
 */
export const GlobalTextSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  text: TextStyleSchema,
});
export type GlobalText = z.infer<typeof GlobalTextSchema>;

/**
 * Sfondo del look Sala (decisione 0003): colore, immagine predefinita
 * dell'archivio media (la usano le slide senza sfondo proprio) e velo scuro
 * sopra le immagini perche' il testo resti leggibile (0 = nessuno).
 */
const Background = z.strictObject({
  color: Color,
  image: z
    .string()
    .regex(/^media:[a-f0-9]{64}\.[a-z0-9]{1,5}$/)
    .optional(),
  dim: z.number().min(0).max(0.9).optional(),
});

export const FullscreenStyleSchema = z.strictObject({
  background: Background,
  text: TextStyleSchema,
  globalText: GlobalTextSchema.optional(),
  transition: Transition,
});
export type FullscreenStyle = z.infer<typeof FullscreenStyleSchema>;

export const StageStyleSchema = z.strictObject({
  background: z.strictObject({ color: Color }),
  text: TextStyleSchema,
  globalText: GlobalTextSchema.optional(),
  /** Mostra la slide successiva sotto quella in onda. */
  showNext: z.boolean(),
  /** Mostra l'orologio in un angolo. */
  showClock: z.boolean(),
  transition: Transition,
});
export type StageStyle = z.infer<typeof StageStyleSchema>;

export const CORE_LOOK_TEMPLATES = {
  "core.fullscreen": FullscreenStyleSchema,
  "core.stage": StageStyleSchema,
} as const;
export type CoreLookTemplate = keyof typeof CORE_LOOK_TEMPLATES;

export function isCoreLookTemplate(template: string): template is CoreLookTemplate {
  return Object.hasOwn(CORE_LOOK_TEMPLATES, template);
}
