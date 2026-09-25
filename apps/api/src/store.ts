import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { badRequest, notFound } from './errors.js';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
export type ModelKind = 'processes' | 'decisions';

function modelPath(kind: ModelKind, key: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) throw badRequest('Invalid model key');
  return join(dataDir, kind, `${key}.${kind === 'processes' ? 'bpmn' : 'json'}`);
}

export async function listModels(kind: ModelKind): Promise<string[]> {
  const extension = kind === 'processes' ? '.bpmn' : '.json';
  return (await readdir(join(dataDir, kind))).filter(name => name.endsWith(extension)).map(name => name.slice(0, -extension.length));
}

export async function getModel(kind: ModelKind, key: string): Promise<string> {
  try {
    return await readFile(modelPath(kind, key), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw notFound(`${kind} model ${key} was not found`);
    throw error;
  }
}

export async function saveModel(kind: ModelKind, key: string, source: string): Promise<void> {
  await getModel(kind, key);
  await writeFile(modelPath(kind, key), source, 'utf8');
}
