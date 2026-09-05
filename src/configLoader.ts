import * as ts from 'typescript';
import * as path from 'path';

export interface ResolvedTsConfig {
  baseUrl: string;
  paths: Record<string, string[]>;
  configPath: string;
}

/**
 * Loads tsconfig.json (following `extends`) and resolves `paths`/`baseUrl`
 * to an absolute directory, matching how TypeScript itself resolves them.
 */
export function loadTsConfig(
  explicitPath: string | undefined,
  searchFrom: string
): ResolvedTsConfig | null {
  const configPath = explicitPath
    ? path.resolve(explicitPath)
    : ts.findConfigFile(searchFrom, ts.sys.fileExists, 'tsconfig.json');

  if (!configPath) return null;

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) return null;

  const configDir = path.dirname(configPath);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, configDir);
  const baseUrl = parsed.options.baseUrl
    ? path.resolve(configDir, parsed.options.baseUrl)
    : configDir;

  return {
    baseUrl,
    paths: (parsed.options.paths as Record<string, string[]>) || {},
    configPath
  };
}
