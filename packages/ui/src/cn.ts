import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Classes conditionnelles ; en cas de conflit Tailwind, la dernière l'emporte (surcharge par className). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
