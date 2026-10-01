import { loadEnv } from '../scripts/env';
import { prepareTestDatabase } from '../src/testing';

export default async function setup(): Promise<void> {
  loadEnv();
  await prepareTestDatabase();
}
