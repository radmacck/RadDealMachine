/**
 * A replaceable in-process connector registry with no product-level connector
 * count cap. Source-specific access limits remain the adapter's responsibility.
 */
export class ConnectorRegistry<T extends { id: string }> {
  private readonly connectors = new Map<string, T>();

  register(connector: T): void {
    const id = connector.id.trim();
    if (!id || id !== connector.id) throw new Error("Connector ids must be non-empty and already trimmed.");
    if (this.connectors.has(id)) throw new Error(`A connector with id "${id}" is already registered.`);
    this.connectors.set(id, connector);
  }

  get(id: string): T | undefined {
    return this.connectors.get(id);
  }

  all(): T[] {
    return [...this.connectors.values()];
  }
}
