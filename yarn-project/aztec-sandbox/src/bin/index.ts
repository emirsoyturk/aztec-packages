#!/usr/bin/env -S node --no-warnings
import { startHttpRpcServer } from '@aztec/aztec-rpc';
import { deployInitialSandboxAccounts } from '@aztec/aztec.js';
import { createDebugLogger } from '@aztec/foundation/log';
import { fileURLToPath } from '@aztec/foundation/url';
import NoirVersion from '@aztec/noir-compiler/noir-version';

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';

import { setupFileDebugLog } from '../logging.js';
import { createP2PSandbox, createSandbox } from '../sandbox.js';
import { github, splash } from '../splash.js';

const { SERVER_PORT = 8080 } = process.env;

const logger = createDebugLogger('aztec:sandbox');

/**
 * Creates the sandbox from provided config and deploys any initial L1 and L2 contracts
 * @param isP2PSandbox - Flag indicating if this sandbox is to connect to a P2P network
 */
async function createAndDeploySandbox(isP2PSandbox: boolean) {
  if (!isP2PSandbox) {
    const { l1Contracts, rpcServer, stop } = await createSandbox();
    logger.info('Setting up test accounts...');
    const accounts = await deployInitialSandboxAccounts(rpcServer);
    return {
      l1Contracts,
      rpcServer,
      stop,
      accounts,
    };
  }
  const { l1Contracts, rpcServer, stop } = await createP2PSandbox();
  return {
    l1Contracts,
    rpcServer,
    stop,
    accounts: [],
  };
}

/**
 * Create and start a new Aztec RCP HTTP Server
 */
async function main() {
  const logPath = setupFileDebugLog();
  const packageJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../package.json');
  const version = JSON.parse(readFileSync(packageJsonPath).toString()).version;

  logger.info(`Setting up Aztec Sandbox v${version} (nargo ${NoirVersion.tag}), please stand by...`);

  const { rpcServer, stop, accounts } = await createAndDeploySandbox(false);

  const shutdown = async () => {
    logger.info('Shutting down...');
    await stop();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  startHttpRpcServer(rpcServer, SERVER_PORT);
  logger.info(`Aztec Sandbox JSON-RPC Server listening on port ${SERVER_PORT}`);
  logger.info(`Debug logs will be written to ${logPath}`);
  const accountStrings = [`Initial Accounts:\n\n`];

  const registeredAccounts = await rpcServer.getRegisteredAccounts();
  for (const account of accounts) {
    const completeAddress = await account.account.getCompleteAddress();
    if (registeredAccounts.find(a => a.equals(completeAddress))) {
      accountStrings.push(` Address: ${completeAddress.address.toString()}\n`);
      accountStrings.push(` Partial Address: ${completeAddress.partialAddress.toString()}\n`);
      accountStrings.push(` Private Key: ${account.privateKey.toString()}\n`);
      accountStrings.push(` Public Key: ${completeAddress.publicKey.toString()}\n\n`);
    }
  }
  logger.info(
    `${splash}\n${github}\n\n`
      .concat(...accountStrings)
      .concat(`Aztec Sandbox v${version} (nargo ${NoirVersion.tag}) is now ready for use!`),
  );
}

main().catch(err => {
  logger.error(err);
  process.exit(1);
});
