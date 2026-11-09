import { accessSync, constants, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { EnvReader, Environment } from './env.ts';

const pathSetting = 'CHECKSUM_BINARY_PATH';
const argsSetting = 'CHECKSUM_BINARY_ARGS';
const algorithmsSetting = 'CHECKSUM_BINARY_ALGORITHMS';
const versionSetting = 'CHECKSUM_BINARY_VERSION';
const envPrefix = 'CHECKSUM_ENV_';

const isExecutableFile = (path: string) => {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** A JSON array of strings, so an argument with a space needs no quoting: no shell runs the binary. */
const readArgs = (read: EnvReader) => {
  const value = read.text(argsSetting);
  if (value === undefined) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((each) => typeof each === 'string')) {
      return parsed;
    }
  } catch {
    // Reported below, as for JSON that is not an array of strings.
  }
  read.report(`${argsSetting} must be a JSON array of strings, such as ["--algo", "{algorithm}"], not ${value}`);
  return [];
};

const readBinaryEnv = (read: EnvReader, env: Environment) => {
  const binaryEnv: Record<string, string> = {};
  for (const name of Object.keys(env).filter((each) => each.startsWith(envPrefix))) {
    const value = read.text(name);
    const binaryName = name.slice(envPrefix.length);
    if (binaryName === '') {
      read.report(`${envPrefix} must be followed by the name of a variable for the binary`);
    } else if (value !== undefined) {
      binaryEnv[binaryName] = value;
    }
  }
  return binaryEnv;
};

/**
 * Reads which checksum generator to use: the binary at CHECKSUM_BINARY_PATH, or the stand-in when it is unset (Q-07).
 * A binary that cannot be run is a problem at startup, rather than a failed checksum in every probe. A setting for the
 * binary without one is a problem too, so a mistake does not pass unnoticed.
 */
const readChecksumGenerator = (read: EnvReader, env: Environment) => {
  const path = read.text(pathSetting);
  const args = readArgs(read);
  const algorithms = (read.text(algorithmsSetting) ?? '').split(',').flatMap((each) => each.trim() || []);
  const version = read.text(versionSetting);
  const binaryEnv = readBinaryEnv(read, env);

  if (path === undefined) {
    const binaryOnly = [
      ...(args.length > 0 ? [argsSetting] : []),
      ...(algorithms.length > 0 ? [algorithmsSetting] : []),
      ...(version === undefined ? [] : [versionSetting]),
      ...Object.keys(binaryEnv).map((name) => `${envPrefix}${name}`),
    ];
    for (const name of binaryOnly) {
      read.report(`${name} applies only with ${pathSetting}`);
    }
    return { kind: 'stand-in' } as const;
  }

  if (!isAbsolute(path)) {
    read.report(`${pathSetting} must be an absolute path, not "${path}"`);
  } else if (!isExecutableFile(path)) {
    read.report(`${pathSetting} must be an executable file, and "${path}" is not`);
  }
  if (algorithms.length === 0) {
    read.report(`${algorithmsSetting} must list the algorithms the binary supports, such as sha256,md5`);
  }
  return { kind: 'binary', path, args, algorithms, version: version ?? 'unknown', env: binaryEnv } as const;
};

export { readChecksumGenerator };
