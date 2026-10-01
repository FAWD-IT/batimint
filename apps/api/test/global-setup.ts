import { prepareTestDatabase, truncateAll } from '@batimint/db/testing';
import { loadDotEnv } from '../src/lib/env';

export default async function setup(): Promise<void> {
  loadDotEnv();
  const urls = await prepareTestDatabase('api');
  await truncateAll(urls.ownerUrl);
}
