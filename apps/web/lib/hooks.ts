'use client';

import { useToast } from '@batimint/ui';
import { type QueryKey, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { api, type ApiOptions } from './api';
import { useErrorMessage } from './use-error-message';

/** Lecture d'une ressource de l'API ; la clé commence par le « sujet » temps réel. */
export function useApi<T>(key: QueryKey, path: string | null, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<T>(path!, { signal }),
    enabled: path !== null && (options.enabled ?? true),
  });
}

/**
 * Mutation avec retours standard : toast de succès, message d'erreur clair, invalidation.
 */
export function useApiMutation<TVars, TResult = unknown>(
  request: (vars: TVars) => { path: string } & ApiOptions,
  options: {
    invalidate?: QueryKey[];
    successMessage?: string | ((result: TResult, vars: TVars) => string);
    onSuccess?: (result: TResult, vars: TVars) => void;
    silentError?: boolean;
  } = {},
) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const tc = useTranslations('common');
  return useMutation({
    mutationFn: async (vars: TVars) => {
      const { path, ...rest } = request(vars);
      return api<TResult>(path, rest);
    },
    onSuccess: (result, vars) => {
      for (const key of options.invalidate ?? []) void queryClient.invalidateQueries({ queryKey: key });
      const msg =
        typeof options.successMessage === 'function'
          ? options.successMessage(result, vars)
          : options.successMessage;
      if (msg) toast.show({ title: msg, tone: 'good' });
      options.onSuccess?.(result, vars);
    },
    onError: (err) => {
      if (!options.silentError)
        toast.show({ title: tc('errorTitle'), description: errorMessage(err), tone: 'crit' });
    },
  });
}
