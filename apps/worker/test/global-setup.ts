import { prepareTestDatabase } from '@batimint/db/testing';
import { loadDotEnv } from '../src/env';

export default async function setup(): Promise<void> {
  loadDotEnv();
  await prepareTestDatabase();
}
