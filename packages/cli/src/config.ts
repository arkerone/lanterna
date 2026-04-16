import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

const CONFIG_FILENAMES = ['.lanterna.json', '.lanterna.config.json'] as const;

const ConfigSchema = z.object({
  detectors: z.array(z.string()).optional(),
});

export type LanternaConfig = z.infer<typeof ConfigSchema>;

export async function loadLanternaConfig(cwd: string): Promise<LanternaConfig | undefined> {
  for (const filename of CONFIG_FILENAMES) {
    const filepath = resolve(cwd, filename);
    let raw: string;
    try {
      raw = await readFile(filepath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse ${filename}: ${message}`);
    }

    const result = ConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Invalid ${filename}: ${result.error.message}`);
    }
    return result.data;
  }
  return undefined;
}
