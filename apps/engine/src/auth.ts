import { randomBytes, timingSafeEqual } from "node:crypto";
import type { BuiltinRoleId, ClientKind } from "@cuelith/protocol";

export interface TokenGrant {
  readonly role: BuiltinRoleId;
  readonly kind: ClientKind;
  readonly local: boolean;
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Credenziali delle postazioni. Le due locali (postazione e finestre di
 * uscita sullo stesso computer) nascono a ogni avvio e arrivano alle
 * finestre Electron dal processo principale, mai via rete.
 */
export class Tokens {
  readonly station = randomToken();
  readonly renderer = randomToken();

  resolve(token: string): TokenGrant | undefined {
    if (sameToken(token, this.station)) return { role: "director", kind: "client", local: true };
    if (sameToken(token, this.renderer)) return { role: "viewer", kind: "renderer", local: true };
    return undefined;
  }
}
