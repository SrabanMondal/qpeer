/** UUID v4 for every entity id. */
export function newId(): string {
  return crypto.randomUUID();
}
