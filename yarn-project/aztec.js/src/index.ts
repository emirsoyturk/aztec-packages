/**
 * This is our public api.
 * Do NOT "export * from ..." here.
 * Everything here should be explicit, to ensure we can clearly see everything we're exposing to the world.
 * If it's exposed, people will use it, and then we can't remove/change the api without breaking client code.
 * At the time of writing we overexpose things that should only be internal.
 *
 * TODO: Review and narrow scope of public api.
 * We should also consider exposing subsections of the api via package.json exports, like we do with foundation.
 * This can allow consumers to import much smaller parts of the library to incur less overhead.
 * It will also allow web bundlers do perform intelligent chunking of bundles etc.
 * Some work as been done on this within the api folder, providing the alternative import style of e.g.:
 * ```typescript
 *   import { TxHash } from '@aztec.js/tx_hash'
 *   import { type ContractArtifact, type FunctionArtifact, FunctionSelector } from '@aztec/aztec.js/abi';
 *   import { AztecAddress } from '@aztec/aztec.js/aztec_address';
 *   import { EthAddress } from '@aztec/aztec.js/eth_address';
 * ```
 */
export {
  WaitOpts,
  ContractFunctionInteraction,
  Contract,
  ContractBase,
  ContractMethod,
  SentTx,
  BatchCall,
} from './contract/index.js';

export { ContractDeployer, DeployMethod, DeploySentTx } from './contract_deployer/index.js';

export {
  generatePublicKey,
  FieldLike,
  EthAddressLike,
  computeMessageSecretHash,
  CheatCodes,
  AztecAddressLike,
  isContractDeployed,
  EthCheatCodes,
  computeAuthWitMessageHash,
} from './utils/index.js';

export { createPXEClient } from './pxe_client.js';

export {
  CompleteAddress,
  getSchnorrAccount,
  AccountContract,
  AccountManager,
  getUnsafeSchnorrAccount,
  EcdsaAccountContract,
  createAccounts,
  SchnorrAccountContract,
  SingleKeyAccountContract,
  createAccount,
  AuthWitnessProvider,
  BaseAccountContract,
} from './account/index.js';

export { waitForSandbox, getSandboxAccountsWallets, deployInitialSandboxAccounts } from './sandbox/index.js';

export { AccountWalletWithPrivateKey, AccountWallet, Wallet, SignerlessWallet } from './wallet/index.js';

// TODO https://github.com/AztecProtocol/aztec-packages/issues/2632 --> FunctionSelector might not need to be exposed
// here once the issue is resolved.
export {
  AztecAddress,
  EthAddress,
  Fr,
  Fq,
  FunctionSelector,
  GlobalVariables,
  GrumpkinScalar,
  Point,
  getContractDeploymentInfo,
} from '@aztec/circuits.js';

export { Grumpkin, Schnorr } from '@aztec/circuits.js/barretenberg';

export {
  AuthWitness,
  AztecNode,
  ContractData,
  DeployedContract,
  ExtendedContractData,
  ExtendedNote,
  FunctionCall,
  GrumpkinPrivateKey,
  INITIAL_L2_BLOCK_NUM,
  L2Actor,
  L2Block,
  L2BlockL2Logs,
  LogFilter,
  LogId,
  LogType,
  MerkleTreeId,
  NodeInfo,
  Note,
  PXE,
  PackedArguments,
  PartialAddress,
  PublicKey,
  SyncStatus,
  Tx,
  TxExecutionRequest,
  TxHash,
  TxReceipt,
  TxStatus,
  UnencryptedL2Log,
  createAztecNodeClient,
  emptyFunctionCall,
  merkleTreeIds,
  mockTx,
} from '@aztec/types';


// TODO: These kinds of things have no place on our public api.
// External devs will almost certainly have their own methods of doing these things.
// If we want to use them in our own "aztec.js consuming code", import them from foundation as needed.
export { ContractArtifact, FunctionArtifact, encodeArguments } from '@aztec/foundation/abi';
export { sha256, init } from '@aztec/foundation/crypto';
export { DebugLogger, createDebugLogger, onLog } from '@aztec/foundation/log';
export { retry, retryUntil } from '@aztec/foundation/retry';
export { sleep } from '@aztec/foundation/sleep';
export { elapsed } from '@aztec/foundation/timer';
export { fileURLToPath } from '@aztec/foundation/url';
export { to2Fields, toBigInt } from '@aztec/foundation/serialize';
export { toBigIntBE } from '@aztec/foundation/bigint-buffer';
export { makeFetch } from '@aztec/foundation/json-rpc/client';

export {
  DeployL1Contracts,
  L1ContractArtifactsForDeployment,
  deployL1Contract,
  deployL1Contracts,
} from '@aztec/ethereum';

export { FieldsOf } from '@aztec/foundation/types';
