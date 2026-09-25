import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SchemaObject } from 'ajv';
import { badRequest } from './errors.js';
import { dataDir } from './store.js';

export interface ContractRef { type: string; version: number }

function contractPath(type: string, version: number, root: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(type) || !Number.isSafeInteger(version) || version < 1) throw badRequest('Invalid contract key or version');
  return join(root, type, `v${version}.json`);
}

export const defaultContractsRoot = join(dataDir, 'contracts');

export async function listContracts(root = defaultContractsRoot): Promise<ContractRef[]> {
  const types = await readdir(root, { withFileTypes: true });
  const contracts = await Promise.all(types.filter(entry => entry.isDirectory()).map(async entry => {
    const versions = await readdir(join(root, entry.name));
    return versions.flatMap(file => {
      const match = /^v([1-9]\d*)\.json$/.exec(file);
      return match ? [{ type: entry.name, version: Number(match[1]) }] : [];
    });
  }));
  return contracts.flat().sort((a, b) => a.type.localeCompare(b.type) || a.version - b.version);
}

export async function getContract(type: string, version: number, root = defaultContractsRoot): Promise<SchemaObject | null> {
  try {
    return JSON.parse(await readFile(contractPath(type, version, root), 'utf8')) as SchemaObject;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function getContractMtime(type: string, version: number, root = defaultContractsRoot): Promise<number | null> {
  try {
    return (await stat(contractPath(type, version, root))).mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
