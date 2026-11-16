const stamp = (): string => new Date().toISOString();

export const log = {
  info: (...args: unknown[]): void => console.log(stamp(), ...args),
  warn: (...args: unknown[]): void => console.warn(stamp(), 'WARN', ...args),
  error: (...args: unknown[]): void => console.error(stamp(), 'ERROR', ...args),
};

export const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
