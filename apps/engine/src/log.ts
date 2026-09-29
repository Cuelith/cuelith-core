export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

const write =
  (fn: (...args: unknown[]) => void) =>
  (message: string, data?: unknown): void => {
    if (data === undefined) fn(`[cuelith] ${message}`);
    else fn(`[cuelith] ${message}`, data);
  };

export const consoleLogger: Logger = {
  debug: write(console.debug),
  info: write(console.info),
  warn: write(console.warn),
  error: write(console.error),
};

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
