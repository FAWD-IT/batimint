/** Erreurs applicatives : code stable (pour le front et le mobile) + message français clair avec une solution. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what = 'Cet élément') =>
  new AppError(
    404,
    'not_found',
    `${what} est introuvable. Il a peut-être été supprimé, ou vous n'y avez pas accès.`,
  );
export const forbidden = (
  message = "Votre rôle ne permet pas cette action. Demandez à l'administrateur de votre entreprise.",
) => new AppError(403, 'forbidden', message);
export const unauthorized = (message = 'Votre session a expiré. Reconnectez-vous pour continuer.') =>
  new AppError(401, 'unauthorized', message);
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);
export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new AppError(422, code, message, details);
