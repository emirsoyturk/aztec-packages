import { ContractDao, MerkleTreeId, NoteFilter, PublicKey } from '@aztec/circuit-types';
import { AztecAddress, BlockHeader, CompleteAddress } from '@aztec/circuits.js';
import { ContractArtifact } from '@aztec/foundation/abi';
import { Fr, Point } from '@aztec/foundation/fields';
import { AztecArray, AztecKVStore, AztecMap, AztecMultiMap, AztecSingleton } from '@aztec/kv-store';
import { contractArtifactFromBuffer, contractArtifactToBuffer } from '@aztec/types/abi';
import { ContractInstanceWithAddress, SerializableContractInstance } from '@aztec/types/contracts';

import { DeferredNoteDao } from './deferred_note_dao.js';
import { NoteDao } from './note_dao.js';
import { PxeDatabase } from './pxe_database.js';

/** Serialized structure of a block header */
type SynchronizedBlock = {
  /** The tree roots when the block was created */
  roots: Record<MerkleTreeId, string>;
  /** The hash of the global variables */
  globalVariablesHash: string;
  /** The block number */
  blockNumber: number;
};

/**
 * A PXE database backed by LMDB.
 */
export class KVPxeDatabase implements PxeDatabase {
  #synchronizedBlock: AztecSingleton<SynchronizedBlock>;
  #addresses: AztecArray<Buffer>;
  #addressIndex: AztecMap<string, number>;
  #authWitnesses: AztecMap<string, Buffer[]>;
  #capsules: AztecArray<Buffer[]>;
  #contracts: AztecMap<string, Buffer>;
  #notes: AztecArray<Buffer>;
  #nullifiedNotes: AztecMap<number, boolean>;
  #notesByContract: AztecMultiMap<string, number>;
  #notesByStorageSlot: AztecMultiMap<string, number>;
  #notesByTxHash: AztecMultiMap<string, number>;
  #notesByOwner: AztecMultiMap<string, number>;
  #deferredNotes: AztecArray<Buffer>;
  #deferredNotesByContract: AztecMultiMap<string, number>;
  #syncedBlockPerPublicKey: AztecMap<string, number>;
  #contractArtifacts: AztecMap<string, Buffer>;
  #contractInstances: AztecMap<string, Buffer>;
  #db: AztecKVStore;

  constructor(db: AztecKVStore) {
    this.#db = db;

    this.#addresses = db.openArray('addresses');
    this.#addressIndex = db.openMap('address_index');

    this.#authWitnesses = db.openMap('auth_witnesses');
    this.#capsules = db.openArray('capsules');
    this.#contracts = db.openMap('contracts');

    this.#contractArtifacts = db.openMap('contract_artifacts');
    this.#contractInstances = db.openMap('contracts_instances');

    this.#synchronizedBlock = db.openSingleton('block_header');
    this.#syncedBlockPerPublicKey = db.openMap('synced_block_per_public_key');

    this.#notes = db.openArray('notes');
    this.#nullifiedNotes = db.openMap('nullified_notes');

    this.#notesByContract = db.openMultiMap('notes_by_contract');
    this.#notesByStorageSlot = db.openMultiMap('notes_by_storage_slot');
    this.#notesByTxHash = db.openMultiMap('notes_by_tx_hash');
    this.#notesByOwner = db.openMultiMap('notes_by_owner');

    this.#deferredNotes = db.openArray('deferred_notes');
    this.#deferredNotesByContract = db.openMultiMap('deferred_notes_by_contract');
  }

  public async addContractArtifact(id: Fr, contract: ContractArtifact): Promise<void> {
    await this.#contractArtifacts.set(id.toString(), contractArtifactToBuffer(contract));
  }

  getContractArtifact(id: Fr): Promise<ContractArtifact | undefined> {
    const contract = this.#contractArtifacts.get(id.toString());
    // TODO(@spalladino): AztecMap lies and returns Uint8Arrays instead of Buffers, hence the extra Buffer.from.
    return Promise.resolve(contract && contractArtifactFromBuffer(Buffer.from(contract)));
  }

  async addContractInstance(contract: ContractInstanceWithAddress): Promise<void> {
    await this.#contractInstances.set(
      contract.address.toString(),
      new SerializableContractInstance(contract).toBuffer(),
    );
  }

  getContractInstance(address: AztecAddress): Promise<ContractInstanceWithAddress | undefined> {
    const contract = this.#contractInstances.get(address.toString());
    return Promise.resolve(contract && SerializableContractInstance.fromBuffer(contract).withAddress(address));
  }

  async addAuthWitness(messageHash: Fr, witness: Fr[]): Promise<void> {
    await this.#authWitnesses.set(
      messageHash.toString(),
      witness.map(w => w.toBuffer()),
    );
  }

  getAuthWitness(messageHash: Fr): Promise<Fr[] | undefined> {
    const witness = this.#authWitnesses.get(messageHash.toString());
    return Promise.resolve(witness?.map(w => Fr.fromBuffer(w)));
  }

  async addCapsule(capsule: Fr[]): Promise<void> {
    await this.#capsules.push(capsule.map(c => c.toBuffer()));
  }

  async popCapsule(): Promise<Fr[] | undefined> {
    const val = await this.#capsules.pop();
    return val?.map(b => Fr.fromBuffer(b));
  }

  async addNote(note: NoteDao): Promise<void> {
    await this.addNotes([note]);
  }

  async addNotes(notes: NoteDao[]): Promise<void> {
    const newLength = await this.#notes.push(...notes.map(note => note.toBuffer()));
    for (const [index, note] of notes.entries()) {
      const noteId = newLength - notes.length + index;
      await Promise.all([
        this.#notesByContract.set(note.contractAddress.toString(), noteId),
        this.#notesByStorageSlot.set(note.storageSlot.toString(), noteId),
        this.#notesByTxHash.set(note.txHash.toString(), noteId),
        this.#notesByOwner.set(note.publicKey.toString(), noteId),
      ]);
    }
  }

  async addDeferredNotes(deferredNotes: DeferredNoteDao[]): Promise<void> {
    const newLength = await this.#deferredNotes.push(...deferredNotes.map(note => note.toBuffer()));
    for (const [index, note] of deferredNotes.entries()) {
      const noteId = newLength - deferredNotes.length + index;
      await this.#deferredNotesByContract.set(note.contractAddress.toString(), noteId);
    }
  }

  getDeferredNotesByContract(contractAddress: AztecAddress): Promise<DeferredNoteDao[]> {
    const noteIds = this.#deferredNotesByContract.getValues(contractAddress.toString());
    const notes: DeferredNoteDao[] = [];
    for (const noteId of noteIds) {
      const serializedNote = this.#deferredNotes.at(noteId);
      if (!serializedNote) {
        continue;
      }

      const note = DeferredNoteDao.fromBuffer(serializedNote);
      notes.push(note);
    }

    return Promise.resolve(notes);
  }

  /**
   * Removes all deferred notes for a given contract address.
   * @param contractAddress - the contract address to remove deferred notes for
   * @returns an array of the removed deferred notes
   *
   * @remarks We only remove indices from the deferred notes by contract map, but not the actual deferred notes.
   * This is safe because our only getter for deferred notes is by contract address.
   * If we should add a more general getter, we will need a delete vector for deferred notes as well,
   * analogous to this.#nullifiedNotes.
   */
  removeDeferredNotesByContract(contractAddress: AztecAddress): Promise<DeferredNoteDao[]> {
    return this.#db.transaction(() => {
      const deferredNotes: DeferredNoteDao[] = [];
      const indices = this.#deferredNotesByContract.getValues(contractAddress.toString());

      for (const index of indices) {
        const deferredNoteBuffer = this.#deferredNotes.at(index);
        if (!deferredNoteBuffer) {
          continue;
        } else {
          deferredNotes.push(DeferredNoteDao.fromBuffer(deferredNoteBuffer));
        }

        void this.#deferredNotesByContract.deleteValue(contractAddress.toString(), index);
      }

      return deferredNotes;
    });
  }

  *#getAllNonNullifiedNotes(): IterableIterator<NoteDao> {
    for (const [index, serialized] of this.#notes.entries()) {
      if (this.#nullifiedNotes.has(index)) {
        continue;
      }

      yield NoteDao.fromBuffer(serialized);
    }
  }

  async getNotes(filter: NoteFilter): Promise<NoteDao[]> {
    const publicKey: PublicKey | undefined = filter.owner
      ? (await this.getCompleteAddress(filter.owner))?.publicKey
      : undefined;

    const initialNoteIds = publicKey
      ? this.#notesByOwner.getValues(publicKey.toString())
      : filter.txHash
      ? this.#notesByTxHash.getValues(filter.txHash.toString())
      : filter.contractAddress
      ? this.#notesByContract.getValues(filter.contractAddress.toString())
      : filter.storageSlot
      ? this.#notesByStorageSlot.getValues(filter.storageSlot.toString())
      : undefined;

    if (!initialNoteIds) {
      return Array.from(this.#getAllNonNullifiedNotes());
    }

    const result: NoteDao[] = [];
    for (const noteId of initialNoteIds) {
      const serializedNote = this.#notes.at(noteId);
      if (!serializedNote) {
        continue;
      }

      const note = NoteDao.fromBuffer(serializedNote);
      if (filter.contractAddress && !note.contractAddress.equals(filter.contractAddress)) {
        continue;
      }

      if (filter.txHash && !note.txHash.equals(filter.txHash)) {
        continue;
      }

      if (filter.storageSlot && !note.storageSlot.equals(filter.storageSlot!)) {
        continue;
      }

      if (publicKey && !note.publicKey.equals(publicKey)) {
        continue;
      }

      result.push(note);
    }

    return result;
  }

  removeNullifiedNotes(nullifiers: Fr[], account: PublicKey): Promise<NoteDao[]> {
    if (nullifiers.length === 0) {
      return Promise.resolve([]);
    }
    const nullifierSet = new Set(nullifiers.map(n => n.toString()));
    return this.#db.transaction(() => {
      const notesIds = this.#notesByOwner.getValues(account.toString());
      const nullifiedNotes: NoteDao[] = [];

      for (const noteId of notesIds) {
        const note = NoteDao.fromBuffer(this.#notes.at(noteId)!);
        if (nullifierSet.has(note.siloedNullifier.toString())) {
          nullifiedNotes.push(note);

          void this.#nullifiedNotes.set(noteId, true);
          void this.#notesByOwner.deleteValue(account.toString(), noteId);
          void this.#notesByTxHash.deleteValue(note.txHash.toString(), noteId);
          void this.#notesByContract.deleteValue(note.contractAddress.toString(), noteId);
          void this.#notesByStorageSlot.deleteValue(note.storageSlot.toString(), noteId);
        }
      }

      return nullifiedNotes;
    });
  }

  getTreeRoots(): Record<MerkleTreeId, Fr> {
    const roots = this.#synchronizedBlock.get()?.roots;
    if (!roots) {
      throw new Error(`Tree roots not set`);
    }

    return {
      [MerkleTreeId.ARCHIVE]: Fr.fromString(roots[MerkleTreeId.ARCHIVE]),
      [MerkleTreeId.CONTRACT_TREE]: Fr.fromString(roots[MerkleTreeId.CONTRACT_TREE].toString()),
      [MerkleTreeId.L1_TO_L2_MESSAGE_TREE]: Fr.fromString(roots[MerkleTreeId.L1_TO_L2_MESSAGE_TREE].toString()),
      [MerkleTreeId.NOTE_HASH_TREE]: Fr.fromString(roots[MerkleTreeId.NOTE_HASH_TREE].toString()),
      [MerkleTreeId.PUBLIC_DATA_TREE]: Fr.fromString(roots[MerkleTreeId.PUBLIC_DATA_TREE].toString()),
      [MerkleTreeId.NULLIFIER_TREE]: Fr.fromString(roots[MerkleTreeId.NULLIFIER_TREE].toString()),
    };
  }

  async setBlockData(blockNumber: number, blockHeader: BlockHeader): Promise<void> {
    await this.#synchronizedBlock.set({
      blockNumber,
      globalVariablesHash: blockHeader.globalVariablesHash.toString(),
      roots: {
        [MerkleTreeId.NOTE_HASH_TREE]: blockHeader.noteHashTreeRoot.toString(),
        [MerkleTreeId.NULLIFIER_TREE]: blockHeader.nullifierTreeRoot.toString(),
        [MerkleTreeId.CONTRACT_TREE]: blockHeader.contractTreeRoot.toString(),
        [MerkleTreeId.L1_TO_L2_MESSAGE_TREE]: blockHeader.l1ToL2MessageTreeRoot.toString(),
        [MerkleTreeId.ARCHIVE]: blockHeader.archiveRoot.toString(),
        [MerkleTreeId.PUBLIC_DATA_TREE]: blockHeader.publicDataTreeRoot.toString(),
      },
    });
  }

  getBlockNumber(): number | undefined {
    return this.#synchronizedBlock.get()?.blockNumber;
  }

  getBlockHeader(): BlockHeader {
    const value = this.#synchronizedBlock.get();
    if (!value) {
      throw new Error(`Block header not set`);
    }

    const blockHeader = new BlockHeader(
      Fr.fromString(value.roots[MerkleTreeId.NOTE_HASH_TREE]),
      Fr.fromString(value.roots[MerkleTreeId.NULLIFIER_TREE]),
      Fr.fromString(value.roots[MerkleTreeId.CONTRACT_TREE]),
      Fr.fromString(value.roots[MerkleTreeId.L1_TO_L2_MESSAGE_TREE]),
      Fr.fromString(value.roots[MerkleTreeId.ARCHIVE]),
      Fr.ZERO, // todo: private kernel vk tree root
      Fr.fromString(value.roots[MerkleTreeId.PUBLIC_DATA_TREE]),
      Fr.fromString(value.globalVariablesHash),
    );

    return blockHeader;
  }

  addCompleteAddress(completeAddress: CompleteAddress): Promise<boolean> {
    return this.#db.transaction(() => {
      const addressString = completeAddress.address.toString();
      const buffer = completeAddress.toBuffer();
      const existing = this.#addressIndex.get(addressString);
      if (typeof existing === 'undefined') {
        const index = this.#addresses.length;
        void this.#addresses.push(buffer);
        void this.#addressIndex.set(addressString, index);

        return true;
      } else {
        const existingBuffer = this.#addresses.at(existing);

        if (existingBuffer?.equals(buffer)) {
          return false;
        }

        throw new Error(
          `Complete address with aztec address ${addressString} but different public key or partial key already exists in memory database`,
        );
      }
    });
  }

  getCompleteAddress(address: AztecAddress): Promise<CompleteAddress | undefined> {
    const index = this.#addressIndex.get(address.toString());
    if (typeof index === 'undefined') {
      return Promise.resolve(undefined);
    }

    const value = this.#addresses.at(index);
    return Promise.resolve(value ? CompleteAddress.fromBuffer(value) : undefined);
  }

  getCompleteAddresses(): Promise<CompleteAddress[]> {
    return Promise.resolve(Array.from(this.#addresses).map(v => CompleteAddress.fromBuffer(v)));
  }

  getSynchedBlockNumberForPublicKey(publicKey: Point): number | undefined {
    return this.#syncedBlockPerPublicKey.get(publicKey.toString());
  }

  setSynchedBlockNumberForPublicKey(publicKey: Point, blockNumber: number): Promise<boolean> {
    return this.#syncedBlockPerPublicKey.set(publicKey.toString(), blockNumber);
  }

  estimateSize(): number {
    const notesSize = Array.from(this.#getAllNonNullifiedNotes()).reduce((sum, note) => sum + note.getSize(), 0);
    const authWitsSize = Array.from(this.#authWitnesses.values()).reduce(
      (sum, value) => sum + value.length * Fr.SIZE_IN_BYTES,
      0,
    );
    const addressesSize = this.#addresses.length * CompleteAddress.SIZE_IN_BYTES;
    const treeRootsSize = Object.keys(MerkleTreeId).length * Fr.SIZE_IN_BYTES;

    return notesSize + treeRootsSize + authWitsSize + addressesSize;
  }

  async addContract(contract: ContractDao): Promise<void> {
    await this.#contracts.set(contract.completeAddress.address.toString(), contract.toBuffer());
  }

  getContract(address: AztecAddress): Promise<ContractDao | undefined> {
    const contract = this.#contracts.get(address.toString());
    return Promise.resolve(contract ? ContractDao.fromBuffer(contract) : undefined);
  }

  getContracts(): Promise<ContractDao[]> {
    return Promise.resolve(Array.from(this.#contracts.values()).map(c => ContractDao.fromBuffer(c)));
  }
}
