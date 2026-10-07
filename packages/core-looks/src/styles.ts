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
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

/**
 * Modifiche dell'editor per un solo elemento (decisione 0015): solo cio' che l'utente ha
 * toccato. La dimensione e' una scala sullo stile in uso, non un numero assoluto.
 */
export const TextOverrideSchema = z.strictObject({
  scale: z.number().min(0.5).max(2).optional(),
  font: TextStyleSchema.shape.font.optional(),
  color: Color.optional(),
  align: TextStyleSchema.shape.align.optional(),
  lineHeight: z.number().min(0.8).max(2.5).optional(),
  weight: z.enum(["normal", "bold"]).optional(),
  uppercase: z.boolean().optional(),
});
export type TextOverride = z.infer<typeof TextOverrideSchema>;

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
  transition: Transition,
});
export type FullscreenStyle = z.infer<typeof FullscreenStyleSchema>;

export const StageStyleSchema = z.strictObject({
  background: z.strictObject({ color: Color }),
  text: TextStyleSchema,
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
