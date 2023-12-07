import { ABIType } from './abi.js';

/**
 * Returns whether the ABI type is an Aztec or Ethereum Address defined in Aztec.nr.
 * @param abiType - Type to check.
 * @returns Boolean.
 */
export function isAddressStruct(abiType: ABIType) {
  return isEthAddressStruct(abiType) || isAztecAddressStruct(abiType);
}

/**
 * Returns whether the ABI type is an Ethereum Address defined in Aztec.nr.
 * @param abiType - Type to check.
 * @returns Boolean.
 */
export function isEthAddressStruct(abiType: ABIType) {
  return abiType.kind === 'struct' && abiType.path.endsWith('types::address::EthAddress');
}

/**
 * Returns whether the ABI type is an Aztec Address defined in Aztec.nr.
 * @param abiType - Type to check.
 * @returns Boolean.
 */
export function isAztecAddressStruct(abiType: ABIType) {
  return abiType.kind === 'struct' && abiType.path.endsWith('types::address::AztecAddress');
}

/**
 * Returns whether the ABI type is an Function Selector defined in Aztec.nr.
 * @param abiType - Type to check.
 * @returns Boolean.
 */
export function isFunctionSelectorStruct(abiType: ABIType) {
  return abiType.kind === 'struct' && abiType.path.endsWith('types::abis::function_selector::FunctionSelector');
}
