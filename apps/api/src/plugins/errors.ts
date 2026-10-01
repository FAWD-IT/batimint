import { IllegalTransitionError } from '@batimint/domain';
import { IntegrationError } from '@batimint/integrations';
import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors';

export const errorsPlugin = fp(async (app: FastifyInstance) => {
  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).send({ error: { code: 'route_not_found', message: 'Adresse inconnue.', requestId: req.id } });
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    const requestId = req.id;
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({
        error: {
          code: 'validation_error',
          message: 'Certains champs sont invalides. Corrigez-les puis réessayez.',
          details: err.validation.map((v) => ({ path: v.instancePath, message: v.message })),
          requestId,
        },
      });
    }
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details, requestId } });
    }
    if (err instanceof IllegalTransitionError) {
      return reply.status(409).send({
        error: { code: 'illegal_transition', message: "Cette action n'est pas possible dans l'état actuel du document.", details: { from: err.from, to: err.to }, requestId },
      });
    }
    if (err instanceof IntegrationError) {
      req.log.warn({ err }, 'erreur d’intégration');
      return reply.status(502).send({ error: { code: 'integration_error', message: err.message, details: { provider: err.provider, retryable: err.retryable }, requestId } });
    }
    if (isResponseSerializationError(err)) {
      req.log.error({ err }, 'réponse non conforme au contrat');
      return reply.status(500).send({ error: { code: 'internal_error', message: 'Une erreur inattendue est survenue. Réessayez dans un instant.', requestId } });
    }
    const prismaCode = (err as { code?: string }).code;
    if (prismaCode === 'P2025') {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Élément introuvable.', requestId } });
    }
    if (prismaCode === 'P2002') {
      return reply.status(409).send({ error: { code: 'duplicate', message: 'Cet élément existe déjà.', requestId } });
    }
    if (err.statusCode === 429) {
      return reply.status(429).send({ error: { code: 'rate_limited', message: 'Trop de tentatives. Patientez une minute puis réessayez.', requestId } });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: { code: err.code ?? 'bad_request', message: err.message, requestId } });
    }
    req.log.error({ err }, 'erreur interne');
    return reply.status(500).send({ error: { code: 'internal_error', message: 'Une erreur inattendue est survenue. Réessayez dans un instant.', requestId } });
  });
});
