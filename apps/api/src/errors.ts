export class ClientError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404) {
    super(message);
  }
}

export const badRequest = (message: string) => new ClientError(message, 400);
export const notFound = (message: string) => new ClientError(message, 404);
