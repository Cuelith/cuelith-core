import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import {
  ErrorCode,
  ItemSchema,
  newId,
  RpcError,
  slideSequence,
  type Item,
  type Library,
  type LibraryItemSummary,
  type MediaInfo,
} from "@cuelith/protocol";
import { ftsQuery, searchableBody } from "./search.js";

const SCHEMA_VERSION = 2;

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE items_fts USING fts5(
    id UNINDEXED, title, body, authors, tags,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TABLE libraries (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    position INTEGER NOT NULL
  );
  CREATE TABLE entries (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    number TEXT
  );
  CREATE INDEX entries_library ON entries(library_id, position);
  CREATE INDEX entries_item ON entries(item_id);
  CREATE TABLE media (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  // 2: librerie organizzate (decisione 0004): categoria, sigla unica, preferita.
  `
  ALTER TABLE libraries ADD COLUMN category TEXT;
  ALTER TABLE libraries ADD COLUMN code TEXT;
  ALTER TABLE libraries ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
  CREATE UNIQUE INDEX libraries_code ON libraries(code) WHERE code IS NOT NULL;
  `,
];

type Row = Record<string, SQLOutputValue>;

/** Valore di una colonna come testo (le colonne lette qui sono TEXT o INTEGER). */
function text(value: SQLOutputValue | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return typeof value === "string" ? value : value.toString();
}
const str = (row: Row, key: string): string => text(row[key]) ?? "";
const optStr = (row: Row, key: string): string | undefined => text(row[key]);

const notFound = (key: string) => new RpcError(ErrorCode.NotFound, key);

export interface ItemQuery {
  readonly libraryId?: string | undefined;
  readonly query?: string | undefined;
  readonly tag?: string | undefined;
  readonly type?: string | undefined;
  readonly offset?: number | undefined;
  readonly limit?: number | undefined;
}

/**
 * Archivio degli elementi e librerie (decisione 0001), in un database SQLite
 * nella cartella dati. Gli elementi stanno una volta sola nell'archivio; le
 * librerie sono elenchi ordinati di riferimenti, con un numero facoltativo.
 * Ricerca a testo pieno senza accenti ("citta" trova "Città").
 */
export class LibraryStore {
  readonly #db: DatabaseSync;

  constructor(file: string) {
    this.#db = new DatabaseSync(file);
    this.#db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;",
    );
    this.#migrate();
  }

  close(): void {
    if (this.#db.isOpen) this.#db.close();
  }

  #migrate(): void {
    const row = this.#db.prepare("PRAGMA user_version").get() as Row | undefined;
    const version = Number(row?.["user_version"] ?? 0);
    if (version > SCHEMA_VERSION) {
      throw new Error("archivio creato da una versione piu' recente di Cuelith");
    }
    this.#transaction(() => {
      for (let v = version; v < SCHEMA_VERSION; v++) this.#db.exec(MIGRATIONS[v] ?? "");
      this.#db.exec(`PRAGMA user_version = ${String(SCHEMA_VERSION)}`);
    });
  }

  #transaction<T>(fn: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #all(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.#db.prepare(sql).all(...params);
  }

  #get(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.#db.prepare(sql).get(...params);
  }

  #run(sql: string, ...params: SQLInputValue[]): number {
    return Number(this.#db.prepare(sql).run(...params).changes);
  }

  // ---------- librerie ----------

  libraries(): Library[] {
    return this.#all(
      `SELECT l.id, l.name, l.description, l.color, l.category, l.code, l.favorite,
              COUNT(e.id) AS count
       FROM libraries l LEFT JOIN entries e ON e.library_id = l.id
       GROUP BY l.id ORDER BY l.position`,
    ).map((row) => {
      const description = optStr(row, "description");
      const color = optStr(row, "color");
      const category = optStr(row, "category");
      const code = optStr(row, "code");
      return {
        id: str(row, "id"),
        name: str(row, "name"),
        ...(description === undefined ? {} : { description }),
        ...(color === undefined ? {} : { color }),
        ...(category === undefined ? {} : { category }),
        ...(code === undefined ? {} : { code }),
        favorite: Number(row["favorite"]) === 1,
        count: Number(row["count"]),
      };
    });
  }

  /** Una sigla appartiene a una sola libreria: "INN 245" deve portare in un posto solo. */
  #checkCode(code: string | null | undefined, exceptId?: string): void {
    if (code === null || code === undefined) return;
    const other = this.#get("SELECT id FROM libraries WHERE code = ?", code);
    if (other !== undefined && str(other, "id") !== exceptId) {
      throw new RpcError(ErrorCode.InvalidParameters, "core.error.libraryCodeInUse");
    }
  }

  createLibrary(fields: {
    name: string;
    description?: string | undefined;
    color?: string | undefined;
    category?: string | undefined;
    code?: string | undefined;
  }): string {
    return this.#transaction(() => {
      this.#checkCode(fields.code);
      const id = newId();
      const next = Number(this.#get("SELECT COUNT(*) AS n FROM libraries")?.["n"] ?? 0);
      this.#run(
        `INSERT INTO libraries (id, name, description, color, category, code, favorite, position)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
        id,
        fields.name,
        fields.description ?? null,
        fields.color ?? null,
        fields.category ?? null,
        fields.code ?? null,
        next,
      );
      return id;
    });
  }

  updateLibrary(
    id: string,
    patch: {
      name?: string | undefined;
      description?: string | null | undefined;
      color?: string | null | undefined;
      category?: string | null | undefined;
      code?: string | null | undefined;
      favorite?: boolean | undefined;
    },
  ): void {
    this.#transaction(() => {
      this.#requireLibrary(id);
      this.#checkCode(patch.code, id);
      const columns = ["name", "description", "color", "category", "code"] as const;
      for (const column of columns) {
        const value = patch[column];
        if (value !== undefined) {
          this.#run(`UPDATE libraries SET ${column} = ? WHERE id = ?`, value, id);
        }
      }
      if (patch.favorite !== undefined) {
        this.#run("UPDATE libraries SET favorite = ? WHERE id = ?", patch.favorite ? 1 : 0, id);
      }
    });
  }

  /** Libreria con questa sigla (senza badare a maiuscole), se c'e'. */
  libraryByCode(code: string): string | undefined {
    const row = this.#get("SELECT id FROM libraries WHERE code = ?", code.toUpperCase());
    return row === undefined ? undefined : str(row, "id");
  }

  deleteLibrary(id: string): void {
    this.#transaction(() => {
      this.#requireLibrary(id);
      this.#run("DELETE FROM libraries WHERE id = ?", id);
      this.#renumber(
        "SELECT id FROM libraries ORDER BY position",
        "UPDATE libraries SET position = ? WHERE id = ?",
      );
    });
  }

  moveLibrary(id: string, toIndex: number): void {
    this.#transaction(() => {
      this.#requireLibrary(id);
      const ids = this.#all("SELECT id FROM libraries ORDER BY position").map((r) => str(r, "id"));
      this.#reorder(ids, id, toIndex, "UPDATE libraries SET position = ? WHERE id = ?");
    });
  }

  #requireLibrary(id: string): void {
    if (this.#get("SELECT 1 AS x FROM libraries WHERE id = ?", id) === undefined) {
      throw notFound("core.error.libraryNotFound");
    }
  }

  #reorder(ids: string[], id: string, toIndex: number, update: string): void {
    if (toIndex >= ids.length)
      throw new RpcError(ErrorCode.InvalidParameters, "core.error.indexOutOfRange");
    const from = ids.indexOf(id);
    ids.splice(from, 1);
    ids.splice(toIndex, 0, id);
    ids.forEach((value, index) => this.#run(update, index, value));
  }

  #renumber(select: string, update: string, ...params: SQLInputValue[]): void {
    this.#all(select, ...params).forEach((row, index) => this.#run(update, index, str(row, "id")));
  }

  // ---------- voci delle librerie ----------

  addEntry(libraryId: string, itemId: string, index?: number, number?: string): string {
    return this.#transaction(() => {
      this.#requireLibrary(libraryId);
      this.#requireItem(itemId);
      const ids = this.#all(
        "SELECT id FROM entries WHERE library_id = ? ORDER BY position",
        libraryId,
      ).map((r) => str(r, "id"));
      const at = index ?? ids.length;
      if (at > ids.length)
        throw new RpcError(ErrorCode.InvalidParameters, "core.error.indexOutOfRange");
      const id = newId();
      this.#run(
        "INSERT INTO entries (id, library_id, item_id, position, number) VALUES (?, ?, ?, ?, ?)",
        id,
        libraryId,
        itemId,
        ids.length,
        number ?? null,
      );
      if (at < ids.length)
        this.#reorder([...ids, id], id, at, "UPDATE entries SET position = ? WHERE id = ?");
      return id;
    });
  }

  #entryLibrary(entryId: string): string {
    const row = this.#get("SELECT library_id FROM entries WHERE id = ?", entryId);
    if (row === undefined) throw notFound("core.error.entryNotFound");
    return str(row, "library_id");
  }

  updateEntry(entryId: string, number: string | null): void {
    this.#entryLibrary(entryId);
    this.#run("UPDATE entries SET number = ? WHERE id = ?", number, entryId);
  }

  removeEntry(entryId: string): void {
    this.#transaction(() => {
      const libraryId = this.#entryLibrary(entryId);
      this.#run("DELETE FROM entries WHERE id = ?", entryId);
      this.#renumber(
        "SELECT id FROM entries WHERE library_id = ? ORDER BY position",
        "UPDATE entries SET position = ? WHERE id = ?",
        libraryId,
      );
    });
  }

  moveEntry(entryId: string, toIndex: number): void {
    this.#transaction(() => {
      const libraryId = this.#entryLibrary(entryId);
      const ids = this.#all(
        "SELECT id FROM entries WHERE library_id = ? ORDER BY position",
        libraryId,
      ).map((r) => str(r, "id"));
      this.#reorder(ids, entryId, toIndex, "UPDATE entries SET position = ? WHERE id = ?");
    });
  }

  // ---------- elementi ----------

  #requireItem(id: string): void {
    if (this.#get("SELECT 1 AS x FROM items WHERE id = ?", id) === undefined) {
      throw notFound("core.error.libraryItemNotFound");
    }
  }

  getItem(id: string): { item: Item; updatedAt: string } {
    const row = this.#get("SELECT data, updated_at FROM items WHERE id = ?", id);
    if (row === undefined) throw notFound("core.error.libraryItemNotFound");
    return {
      item: ItemSchema.parse(JSON.parse(str(row, "data"))),
      updatedAt: str(row, "updated_at"),
    };
  }

  /** Crea o sostituisce; restituisce la data di aggiornamento. */
  saveItem(item: Item, libraryId?: string): string {
    const { libraryRef: _ref, ...stored } = item;
    const updatedAt = new Date().toISOString();
    this.#transaction(() => {
      const exists = this.#get("SELECT 1 AS x FROM items WHERE id = ?", item.id) !== undefined;
      if (libraryId !== undefined) this.#requireLibrary(libraryId);
      if (exists) {
        this.#run(
          "UPDATE items SET title = ?, data = ?, updated_at = ? WHERE id = ?",
          item.title,
          JSON.stringify(stored),
          updatedAt,
          item.id,
        );
        this.#run("DELETE FROM items_fts WHERE id = ?", item.id);
      } else {
        this.#run(
          "INSERT INTO items (id, title, data, updated_at) VALUES (?, ?, ?, ?)",
          item.id,
          item.title,
          JSON.stringify(stored),
          updatedAt,
        );
      }
      this.#run(
        "INSERT INTO items_fts (id, title, body, authors, tags) VALUES (?, ?, ?, ?, ?)",
        item.id,
        [item.title, ...(item.credits?.altTitles ?? [])].join("\n"),
        searchableBody(item.slides),
        (item.credits?.authors ?? []).map((a) => a.name).join("\n"),
        (item.tags ?? []).join("\n"),
      );
      if (!exists && libraryId !== undefined) {
        const next = Number(
          this.#get("SELECT COUNT(*) AS n FROM entries WHERE library_id = ?", libraryId)?.["n"] ??
            0,
        );
        this.#run(
          "INSERT INTO entries (id, library_id, item_id, position, number) VALUES (?, ?, ?, ?, NULL)",
          newId(),
          libraryId,
          item.id,
          next,
        );
      }
    });
    return updatedAt;
  }

  deleteItem(id: string): void {
    this.#transaction(() => {
      this.#requireItem(id);
      const libraries = this.#all(
        "SELECT DISTINCT library_id FROM entries WHERE item_id = ?",
        id,
      ).map((r) => str(r, "library_id"));
      this.#run("DELETE FROM items WHERE id = ?", id);
      this.#run("DELETE FROM items_fts WHERE id = ?", id);
      for (const libraryId of libraries) {
        this.#renumber(
          "SELECT id FROM entries WHERE library_id = ? ORDER BY position",
          "UPDATE entries SET position = ? WHERE id = ?",
          libraryId,
        );
      }
    });
  }

  /**
   * "INN 245" o "inn luce": se la prima parola e' la sigla di una libreria si
   * cerca dentro quella (per numero o testo). Solo nella ricerca in tutto l'archivio.
   */
  #byCode(query: ItemQuery): ItemQuery {
    if (query.libraryId !== undefined || query.query === undefined) return query;
    const match = /^\s*([A-Za-z0-9]{1,8})\s+(.+)$/.exec(query.query);
    if (match === null) return query;
    const [, code = "", rest = ""] = match;
    const libraryId = this.libraryByCode(code);
    return libraryId === undefined ? query : { ...query, libraryId, query: rest };
  }

  items(request: ItemQuery): { items: LibraryItemSummary[]; total: number } {
    const query = this.#byCode(request);
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    const inLibrary = query.libraryId !== undefined;
    if (inLibrary) {
      this.#requireLibrary(query.libraryId ?? "");
      where.push("e.library_id = ?");
      params.push(query.libraryId ?? "");
    }
    const match = query.query === undefined ? undefined : ftsQuery(query.query);
    if (match !== undefined) {
      // In una libreria si cerca anche per numero (innario): "123" trova il brano 123.
      if (inLibrary) {
        where.push("(i.id IN (SELECT id FROM items_fts WHERE items_fts MATCH ?) OR e.number = ?)");
        params.push(match, (query.query ?? "").trim());
      } else {
        where.push("i.id IN (SELECT id FROM items_fts WHERE items_fts MATCH ?)");
        params.push(match);
      }
    }
    if (query.type !== undefined) {
      where.push("json_extract(i.data, '$.type') = ?");
      params.push(query.type);
    }
    if (query.tag !== undefined) {
      where.push(
        "EXISTS (SELECT 1 FROM json_each(i.data, '$.tags') t WHERE lower(t.value) = lower(?))",
      );
      params.push(query.tag);
    }
    const from = inLibrary ? "entries e JOIN items i ON i.id = e.item_id" : "items i";
    const clause = where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`;
    const total = Number(
      this.#get(`SELECT COUNT(*) AS n FROM ${from} ${clause}`, ...params)?.["n"] ?? 0,
    );
    const order = inLibrary ? "e.position" : "i.title COLLATE NOCASE, i.id";
    const columns = inLibrary
      ? "i.id, i.data, i.updated_at, e.id AS entry_id, e.number"
      : "i.id, i.data, i.updated_at";
    const rows = this.#all(
      `SELECT ${columns} FROM ${from} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
      ...params,
      query.limit ?? 200,
      query.offset ?? 0,
    );
    const memberships = this.#memberships(rows.map((row) => str(row, "id")));
    return {
      items: rows.map((row) => {
        const summary = this.#summary(row);
        return { ...summary, libraries: memberships.get(summary.id) ?? [] };
      }),
      total,
    };
  }

  /** Per ogni elemento: in quali librerie sta, con sigla e numero (una sola query). */
  #memberships(ids: readonly string[]): Map<string, LibraryItemSummary["libraries"]> {
    const result = new Map<string, LibraryItemSummary["libraries"]>();
    if (ids.length === 0) return result;
    const rows = this.#all(
      `SELECT e.item_id, l.id, l.name, l.code, e.number
       FROM entries e JOIN libraries l ON l.id = e.library_id
       WHERE e.item_id IN (${ids.map(() => "?").join(", ")})
       ORDER BY l.position, e.position`,
      ...ids,
    );
    for (const row of rows) {
      const itemId = str(row, "item_id");
      const code = optStr(row, "code");
      const number = optStr(row, "number");
      const list = result.get(itemId) ?? [];
      list.push({
        libraryId: str(row, "id"),
        name: str(row, "name"),
        ...(code === undefined ? {} : { code }),
        ...(number === undefined ? {} : { number }),
      });
      result.set(itemId, list);
    }
    return result;
  }

  #summary(row: Row): Omit<LibraryItemSummary, "libraries"> {
    const item = ItemSchema.parse(JSON.parse(str(row, "data")));
    const entryId = optStr(row, "entry_id");
    const number = optStr(row, "number");
    return {
      id: item.id,
      type: item.type,
      title: item.title,
      authors: (item.credits?.authors ?? []).map((a) => a.name),
      tags: item.tags ?? [],
      slideCount: slideSequence(item).length,
      hasAttachments: (item.attachments?.length ?? 0) > 0,
      updatedAt: str(row, "updated_at"),
      ...(item.derivedFrom === undefined ? {} : { derivedFrom: item.derivedFrom }),
      ...(entryId === undefined ? {} : { entryId }),
      ...(number === undefined ? {} : { number }),
    };
  }

  tags(): { tag: string; count: number }[] {
    return this.#all(
      `SELECT t.value AS tag, COUNT(*) AS count
       FROM items i, json_each(i.data, '$.tags') t
       GROUP BY lower(t.value) ORDER BY lower(t.value)`,
    ).map((row) => ({ tag: str(row, "tag"), count: Number(row["count"]) }));
  }

  // ---------- media ----------

  addMedia(info: MediaInfo): void {
    this.#run(
      "INSERT OR IGNORE INTO media (id, name, kind, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      info.id,
      info.name,
      info.kind,
      info.mime,
      info.size,
      new Date().toISOString(),
    );
  }

  hasMedia(id: string): boolean {
    return this.#get("SELECT 1 AS x FROM media WHERE id = ?", id) !== undefined;
  }
}
