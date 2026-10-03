/** Erreur d'intégration lisible (07 : « Les erreurs sont lisibles et rejouables »). */
export class IntegrationError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly retryable = true,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'IntegrationError';
  }
}
