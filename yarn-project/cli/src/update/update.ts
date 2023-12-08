/* eslint-disable jsdoc/require-jsdoc */
import { DebugLogger, LogFn } from '@aztec/foundation/log';

import { relative, resolve } from 'path';
import { SemVer, lt, parse } from 'semver';

import { createCompatibleClient } from '../client.js';
import { GITHUB_TAG_PREFIX } from '../github.js';
import { DependencyChanges } from './common.js';
import { updateAztecNr } from './noir.js';
import { getNewestVersion, updateAztecDeps, updateLockfile } from './npm.js';

const AZTECJS_PACKAGE = '@aztec/aztec.js';
const UPDATE_DOCS_URL = 'https://docs.aztec.network/dev_docs/updating';

export async function update(
  projectPath: string,
  contracts: string[],
  pxeUrl: string,
  aztecVersion: string,
  log: LogFn,
  debugLog: DebugLogger,
): Promise<void> {
  const targetAztecVersion =
    aztecVersion === 'latest' ? await getNewestVersion(AZTECJS_PACKAGE, 'latest') : parse(aztecVersion);

  if (!targetAztecVersion) {
    throw new Error(`Invalid aztec version ${aztecVersion}`);
  }

  await compareSandboxVersion(targetAztecVersion, pxeUrl, log, debugLog);

  const projectDependencyChanges: DependencyChanges[] = [];
  try {
    const npmChanges = await updateAztecDeps(resolve(process.cwd(), projectPath), targetAztecVersion, log);
    if (npmChanges.dependencies.length > 0) {
      updateLockfile(projectPath, log);
    }

    projectDependencyChanges.push(npmChanges);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      log(`No package.json found in ${projectPath}. Skipping npm update...`);
    } else {
      throw err;
    }
  }

  for (const contract of contracts) {
    try {
      projectDependencyChanges.push(
        await updateAztecNr(
          resolve(process.cwd(), projectPath, contract),
          `${GITHUB_TAG_PREFIX}-v${targetAztecVersion.version}`,
          log,
        ),
      );
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        log(`No Nargo.toml found in ${relative(process.cwd(), contract)}. Skipping...`);
      } else {
        throw err;
      }
    }
  }

  projectDependencyChanges.forEach(changes => {
    printChanges(changes, log);
  });
}

function printChanges(changes: DependencyChanges, log: LogFn): void {
  log(`\nIn ${relative(process.cwd(), changes.file)}:`);
  if (changes.dependencies.length === 0) {
    log('  No changes');
  } else {
    changes.dependencies.forEach(({ name, from, to }) => {
      log(`  Updated ${name} from ${from} to ${to}`);
    });
  }
}

/**
 * Checks if the sandbox version is older than the target version and prints a warning if so.
 * If the sandbox is not running then it will print a warning message instead of throwing.
 *
 * @param targetAztecVersion - The version to update to
 * @param pxeUrl - URL of the PXE.
 * @param log - Logging function
 * @param debugLog - Logging function
 */
async function compareSandboxVersion(targetAztecVersion: SemVer, pxeUrl: string, log: LogFn, debugLog: DebugLogger) {
  try {
    const client = await createCompatibleClient(pxeUrl, debugLog);
    const nodeInfo = await client.getNodeInfo();
    const runningSandboxVersion = parse(nodeInfo.sandboxVersion);
    if (!runningSandboxVersion) {
      throw new Error();
    }

    if (lt(runningSandboxVersion, targetAztecVersion)) {
      log(`
Aztec Sandbox is older than version ${targetAztecVersion}. Follow update instructions at ${UPDATE_DOCS_URL}\n`);
    }
  } catch (err) {
    log(`Aztec Sandbox not running. Update to ${targetAztecVersion} by following instructions at ${UPDATE_DOCS_URL}\n`);
  }
}
