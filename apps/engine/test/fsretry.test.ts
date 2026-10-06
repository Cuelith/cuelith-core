import { describe, expect, it } from "vitest";
import { renameWithRetry } from "../src/modules/fsretry.js";

const failure = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

describe("renameWithRetry", () => {
  it("riprova quando Windows tiene la cartella occupata e poi riesce", async () => {
    const calls: string[] = [];
    const waits: number[] = [];
    let n = 0;
    await renameWithRetry("a", "b", {
      rename: (from, to) => {
        calls.push(`${from}>${to}`);
        n += 1;
        return n < 3 ? Promise.reject(failure(n === 1 ? "EPERM" : "EBUSY")) : Promise.resolve();
      },
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    expect(calls).toEqual(["a>b", "a>b", "a>b"]);
    // L'attesa cresce a ogni tentativo.
    expect(waits).toEqual([60, 120]);
  });

  it("si ferma dopo i tentativi consentiti e rilancia l'ultimo errore", async () => {
    let n = 0;
    await expect(
      renameWithRetry("a", "b", {
        attempts: 4,
        rename: () => {
          n += 1;
          return Promise.reject(failure("EPERM"));
        },
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toMatchObject({ code: "EPERM" });
    expect(n).toBe(4);
  });

  it("un errore che non passa da solo (cartella mancante, disco pieno, errore senza codice) si segnala subito", async () => {
    for (const error of [failure("ENOENT"), failure("ENOSPC"), new Error("boh")]) {
      let n = 0;
      await expect(
        renameWithRetry("a", "b", {
          rename: () => {
            n += 1;
            return Promise.reject(error);
          },
          sleep: () => Promise.reject(new Error("non doveva aspettare")),
        }),
      ).rejects.toBe(error);
      expect(n).toBe(1);
    }
  });

  it("riesce al primo colpo senza aspettare", async () => {
    await renameWithRetry("a", "b", {
      rename: () => Promise.resolve(),
      sleep: () => Promise.reject(new Error("non doveva aspettare")),
    });
  });
});
