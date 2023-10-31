import {
  CallContext,
  CircuitsWasm,
  ContractDeploymentData,
  FunctionData,
  FunctionSelector,
  HistoricBlockData,
  PublicCallRequest,
  ReadRequestMembershipWitness,
  TxContext,
} from '@aztec/circuits.js';
import { computeUniqueCommitment, siloCommitment } from '@aztec/circuits.js/abis';
import { Grumpkin } from '@aztec/circuits.js/barretenberg';
import { FunctionAbi, FunctionArtifact, countArgumentsSize } from '@aztec/foundation/abi';
import { AztecAddress } from '@aztec/foundation/aztec-address';
import { Fr, Point } from '@aztec/foundation/fields';
import { createDebugLogger } from '@aztec/foundation/log';
import { AuthWitness, FunctionL2Logs, L1NotePayload, Note, UnencryptedL2Log } from '@aztec/types';

import {
  NoteData,
  toACVMCallContext,
  toACVMContractDeploymentData,
  toACVMHistoricBlockData,
  toACVMWitness,
} from '../acvm/index.js';
import { SideEffectCounter } from '../common/index.js';
import { PackedArgsCache } from '../common/packed_args_cache.js';
import { DBOracle } from './db_oracle.js';
import { ExecutionNoteCache } from './execution_note_cache.js';
import { ExecutionResult, NoteAndSlot } from './execution_result.js';
import { pickNotes } from './pick_notes.js';
import { executePrivateFunction } from './private_execution.js';
import { ViewDataOracle } from './view_data_oracle.js';

/**
 * The execution context for a client tx simulation.
 */
export class ClientExecutionContext extends ViewDataOracle {
  /**
   * New notes created during this execution.
   * It's possible that a note in this list has been nullified (in the same or other executions) and doen't exist in the ExecutionNoteCache and the final proof data.
   * But we still include those notes in the execution result because their commitments are still in the public inputs of this execution.
   * This information is only for references (currently used for tests), and is not used for any sort of constrains.
   * Users can also use this to get a clearer idea of what's happened during a simulation.
   */
  private newNotes: NoteAndSlot[] = [];
  /**
   * Notes from previous transactions that are returned to the oracle call `getNotes` during this execution.
   * The mapping maps from the unique siloed note hash to the index for notes created in private executions.
   * It maps from siloed note hash to the index for notes created by public functions.
   *
   * They are not part of the ExecutionNoteCache and being forwarded to nested contexts via `extend()`
   * because these notes are meant to be maintained on a per-call basis
   * They should act as references for the read requests output by an app circuit via public inputs.
   */
  private gotNotes: Map<bigint, bigint> = new Map();
  private encryptedLogs: Buffer[] = [];
  private unencryptedLogs: UnencryptedL2Log[] = [];
  private nestedExecutions: ExecutionResult[] = [];
  private enqueuedPublicFunctionCalls: PublicCallRequest[] = [];

  constructor(
    protected readonly contractAddress: AztecAddress,
    private readonly argsHash: Fr,
    private readonly txContext: TxContext,
    private readonly callContext: CallContext,
    /** Data required to reconstruct the block hash, it contains historic roots. */
    protected readonly historicBlockData: HistoricBlockData,
    /** List of transient auth witnesses to be used during this simulation */
    protected readonly authWitnesses: AuthWitness[],
    private readonly packedArgsCache: PackedArgsCache,
    private readonly noteCache: ExecutionNoteCache,
    private readonly sideEffectCounter: SideEffectCounter,
    protected readonly db: DBOracle,
    private readonly curve: Grumpkin,
    protected log = createDebugLogger('aztec:simulator:client_execution_context'),
  ) {
    super(contractAddress, historicBlockData, authWitnesses, db, undefined, log);
  }

  // We still need this function until we can get user-defined ordering of structs for fn arguments
  // TODO When that is sorted out on noir side, we can use instead the utilities in serialize.ts
  /**
   * Writes the function inputs to the initial witness.
   * @param abi - The function ABI.
   * @returns The initial witness.
   */
  public getInitialWitness(abi: FunctionAbi) {
    const contractDeploymentData = this.txContext.contractDeploymentData;

    const argumentsSize = countArgumentsSize(abi);

    const args = this.packedArgsCache.unpack(this.argsHash);

    if (args.length !== argumentsSize) {
      throw new Error('Invalid arguments size');
    }

    const fields = [
      ...toACVMCallContext(this.callContext),
      ...toACVMHistoricBlockData(this.historicBlockData),
      ...toACVMContractDeploymentData(contractDeploymentData),

      this.txContext.chainId,
      this.txContext.version,

      ...args,
    ];

    return toACVMWitness(1, fields);
  }

  /**
   * This function will populate readRequestPartialWitnesses which
   * here is just used to flag reads as "transient" for new notes created during this execution
   * or to flag non-transient reads with their leafIndex.
   * The KernelProver will use this to fully populate witnesses and provide hints to
   * the kernel regarding which commitments each transient read request corresponds to.
   * @param readRequests - Note hashed of the notes being read.
   * @returns An array of partially filled in read request membership witnesses.
   */
  public getReadRequestPartialWitnesses(readRequests: Fr[]) {
    return readRequests
      .filter(r => !r.isZero())
      .map(r => {
        const index = this.gotNotes.get(r.value);
        return index !== undefined
          ? ReadRequestMembershipWitness.empty(index)
          : ReadRequestMembershipWitness.emptyTransient();
      });
  }

  /**
   * Get the data for the newly created notes.
   * @param innerNoteHashes - Inner note hashes for the notes.
   */
  public getNewNotes(): NoteAndSlot[] {
    return this.newNotes;
  }

  /**
   * Return the encrypted logs emitted during this execution.
   */
  public getEncryptedLogs() {
    return new FunctionL2Logs(this.encryptedLogs);
  }

  /**
   * Return the encrypted logs emitted during this execution.
   */
  public getUnencryptedLogs() {
    return new FunctionL2Logs(this.unencryptedLogs.map(log => log.toBuffer()));
  }

  /**
   * Return the nested execution results during this execution.
   */
  public getNestedExecutions() {
    return this.nestedExecutions;
  }

  /**
   * Return the enqueued public function calls during this execution.
   */
  public getEnqueuedPublicFunctionCalls() {
    return this.enqueuedPublicFunctionCalls;
  }

  /**
   * Pack the given arguments.
   * @param args - Arguments to pack
   */
  public packArguments(args: Fr[]): Promise<Fr> {
    return this.packedArgsCache.pack(args);
  }

  /**
   * Gets some notes for a storage slot.
   *
   * @remarks
   * Check for pending notes with matching slot.
   * Real notes coming from DB will have a leafIndex which
   * represents their index in the note hash tree.
   *
   * @param storageSlot - The storage slot.
   * @param numSelects - The number of valid selects in selectBy and selectValues.
   * @param selectBy - An array of indices of the fields to selects.
   * @param selectValues - The values to match.
   * @param sortBy - An array of indices of the fields to sort.
   * @param sortOrder - The order of the corresponding index in sortBy. (1: DESC, 2: ASC, 0: Do nothing)
   * @param limit - The number of notes to retrieve per query.
   * @param offset - The starting index for pagination.
   * @returns Array of note data.
   */
  public async getNotes(
    storageSlot: Fr,
    numSelects: number,
    selectBy: number[],
    selectValues: Fr[],
    sortBy: number[],
    sortOrder: number[],
    limit: number,
    offset: number,
  ): Promise<NoteData[]> {
    // Nullified pending notes are already removed from the list.
    const pendingNotes = this.noteCache.getNotes(this.contractAddress, storageSlot);

    const pendingNullifiers = this.noteCache.getNullifiers(this.contractAddress);
    const dbNotes = await this.db.getNotes(this.contractAddress, storageSlot);
    const dbNotesFiltered = dbNotes.filter(n => !pendingNullifiers.has((n.siloedNullifier as Fr).value));

    const notes = pickNotes<NoteData>([...dbNotesFiltered, ...pendingNotes], {
      selects: selectBy.slice(0, numSelects).map((index, i) => ({ index, value: selectValues[i] })),
      sorts: sortBy.map((index, i) => ({ index, order: sortOrder[i] })),
      limit,
      offset,
    });

    this.log(
      `Returning ${notes.length} notes for ${this.contractAddress} at ${storageSlot}: ${notes
        .map(n => `${n.nonce.toString()}:[${n.note.items.map(i => i.toString()).join(',')}]`)
        .join(', ')}`,
    );

    const wasm = await CircuitsWasm.get();
    notes.forEach(n => {
      if (n.index !== undefined) {
        const siloedNoteHash = siloCommitment(wasm, n.contractAddress, n.innerNoteHash);
        const uniqueSiloedNoteHash = computeUniqueCommitment(wasm, n.nonce, siloedNoteHash);
        // TODO(https://github.com/AztecProtocol/aztec-packages/issues/1386)
        // Should always be uniqueSiloedNoteHash when publicly created notes include nonces.
        const noteHashForReadRequest = n.nonce.isZero() ? siloedNoteHash : uniqueSiloedNoteHash;
        this.gotNotes.set(noteHashForReadRequest.value, n.index);
      }
    });

    return notes;
  }

  /**
   * Fetches a path to prove existence of a commitment in the db, given its contract side commitment (before silo).
   * @param nonce - The nonce of the note.
   * @param innerNoteHash - The inner note hash of the note.
   * @returns 1 if (persistent or transient) note hash exists, 0 otherwise. Value is in ACVMField form.
   */
  public async checkNoteHashExists(nonce: Fr, innerNoteHash: Fr): Promise<boolean> {
    if (nonce.isZero()) {
      // If nonce is 0, we are looking for a new note created in this transaction.
      const exists = this.noteCache.checkNoteExists(this.contractAddress, innerNoteHash);
      if (exists) {
        return true;
      }
      // TODO(https://github.com/AztecProtocol/aztec-packages/issues/1386)
      // Currently it can also be a note created from public if nonce is 0.
      // If we can't find a matching new note, keep looking for the match from the notes created in previous transactions.
    }

    // If nonce is zero, SHOULD only be able to reach this point if note was publicly created
    const wasm = await CircuitsWasm.get();
    let noteHashToLookUp = siloCommitment(wasm, this.contractAddress, innerNoteHash);
    if (!nonce.isZero()) {
      noteHashToLookUp = computeUniqueCommitment(wasm, nonce, noteHashToLookUp);
    }

    const index = await this.db.findCommitmentIndex(noteHashToLookUp.toBuffer());
    const exists = index !== undefined;
    if (exists) {
      this.gotNotes.set(noteHashToLookUp.value, index);
    }
    return exists;
  }

  /**
   * Keep track of the new note created during execution.
   * It can be used in subsequent calls (or transactions when chaining txs is possible).
   * @param contractAddress - The contract address.
   * @param storageSlot - The storage slot.
   * @param noteItems - The items to be included in a Note.
   * @param innerNoteHash - The inner note hash of the new note.
   * @returns
   */
  public notifyCreatedNote(storageSlot: Fr, noteItems: Fr[], innerNoteHash: Fr) {
    const note = new Note(noteItems);
    this.noteCache.addNewNote({
      contractAddress: this.contractAddress,
      storageSlot,
      nonce: Fr.ZERO, // Nonce cannot be known during private execution.
      note,
      siloedNullifier: undefined, // Siloed nullifier cannot be known for newly created note.
      innerNoteHash,
    });
    this.newNotes.push({
      storageSlot,
      note,
    });
  }

  /**
   * Adding a siloed nullifier into the current set of all pending nullifiers created
   * within the current transaction/execution.
   * @param innerNullifier - The pending nullifier to add in the list (not yet siloed by contract address).
   * @param innerNoteHash - The inner note hash of the new note.
   */
  public async notifyNullifiedNote(innerNullifier: Fr, innerNoteHash: Fr) {
    await this.noteCache.nullifyNote(this.contractAddress, innerNullifier, innerNoteHash);
  }

  /**
   * Encrypt a note and emit it as a log.
   * @param contractAddress - The contract address of the note.
   * @param storageSlot - The storage slot the note is at.
   * @param publicKey - The public key of the account that can decrypt the log.
   * @param log - The log contents.
   */
  public emitEncryptedLog(contractAddress: AztecAddress, storageSlot: Fr, publicKey: Point, log: Fr[]) {
    const note = new Note(log);
    const l1NotePayload = new L1NotePayload(note, contractAddress, storageSlot);
    const encryptedNote = l1NotePayload.toEncryptedBuffer(publicKey, this.curve);
    this.encryptedLogs.push(encryptedNote);
  }

  /**
   * Emit an unencrypted log.
   * @param log - The unencrypted log to be emitted.
   */
  public emitUnencryptedLog(log: UnencryptedL2Log) {
    this.unencryptedLogs.push(log);
    this.log(`Emitted unencrypted log: "${log.toHumanReadable()}"`);
  }

  /**
   * Calls a private function as a nested execution.
   * @param targetContractAddress - The address of the contract to call.
   * @param functionSelector - The function selector of the function to call.
   * @param argsHash - The packed arguments to pass to the function.
   * @returns The execution result.
   */
  async callPrivateFunction(targetContractAddress: AztecAddress, functionSelector: FunctionSelector, argsHash: Fr) {
    this.log(
      `Calling private function ${targetContractAddress}:${functionSelector} from ${this.callContext.storageContractAddress}`,
    );

    const targetArtifact = await this.db.getFunctionArtifact(targetContractAddress, functionSelector);
    const targetFunctionData = FunctionData.fromAbi(targetArtifact);

    const derivedTxContext = new TxContext(
      false,
      false,
      false,
      ContractDeploymentData.empty(),
      this.txContext.chainId,
      this.txContext.version,
    );

    const derivedCallContext = await this.deriveCallContext(targetContractAddress, targetArtifact, false, false);

    const context = new ClientExecutionContext(
      targetContractAddress,
      argsHash,
      derivedTxContext,
      derivedCallContext,
      this.historicBlockData,
      this.authWitnesses,
      this.packedArgsCache,
      this.noteCache,
      this.sideEffectCounter,
      this.db,
      this.curve,
    );

    const childExecutionResult = await executePrivateFunction(
      context,
      targetArtifact,
      targetContractAddress,
      targetFunctionData,
    );

    this.nestedExecutions.push(childExecutionResult);

    return childExecutionResult.callStackItem;
  }

  /**
   * Creates a PublicCallStackItem object representing the request to call a public function. No function
   * is actually called, since that must happen on the sequencer side. All the fields related to the result
   * of the execution are empty.
   * @param targetContractAddress - The address of the contract to call.
   * @param functionSelector - The function selector of the function to call.
   * @param argsHash - The packed arguments to pass to the function.
   * @returns The public call stack item with the request information.
   */
  public async enqueuePublicFunctionCall(
    targetContractAddress: AztecAddress,
    functionSelector: FunctionSelector,
    argsHash: Fr,
  ): Promise<PublicCallRequest> {
    const targetArtifact = await this.db.getFunctionArtifact(targetContractAddress, functionSelector);
    const derivedCallContext = await this.deriveCallContext(targetContractAddress, targetArtifact, false, false);
    const args = this.packedArgsCache.unpack(argsHash);
    const sideEffectCounter = this.sideEffectCounter.count();
    const enqueuedRequest = PublicCallRequest.from({
      args,
      callContext: derivedCallContext,
      functionData: FunctionData.fromAbi(targetArtifact),
      contractAddress: targetContractAddress,
      sideEffectCounter,
    });

    // TODO($846): if enqueued public calls are associated with global
    // side-effect counter, that will leak info about how many other private
    // side-effects occurred in the TX. Ultimately the private kernel should
    // just output everything in the proper order without any counters.
    this.log(
      `Enqueued call to public function (with side-effect counter #${sideEffectCounter}) ${targetContractAddress}:${functionSelector}`,
    );

    this.enqueuedPublicFunctionCalls.push(enqueuedRequest);

    return enqueuedRequest;
  }

  /**
   * Derives the call context for a nested execution.
   * @param targetContractAddress - The address of the contract being called.
   * @param targetArtifact - The artifact of the function being called.
   * @param isDelegateCall - Whether the call is a delegate call.
   * @param isStaticCall - Whether the call is a static call.
   * @returns The derived call context.
   */
  private async deriveCallContext(
    targetContractAddress: AztecAddress,
    targetArtifact: FunctionArtifact,
    isDelegateCall = false,
    isStaticCall = false,
  ) {
    const portalContractAddress = await this.db.getPortalContractAddress(targetContractAddress);
    return new CallContext(
      this.contractAddress,
      targetContractAddress,
      portalContractAddress,
      FunctionSelector.fromNameAndParameters(targetArtifact.name, targetArtifact.parameters),
      isDelegateCall,
      isStaticCall,
      false,
    );
  }
}
