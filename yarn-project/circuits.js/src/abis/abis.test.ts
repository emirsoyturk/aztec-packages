import { randomBytes } from 'crypto';
import { fr, makeAztecAddress, makeTxRequest, makeVerificationKey } from '../tests/factories.js';
import { CircuitsWasm } from '../wasm/circuits_wasm.js';
import {
  computeContractAddress,
  computeContractLeaf,
  computeFunctionLeaf,
  computeFunctionSelector,
  computeFunctionTreeRoot,
  hashConstructor,
  hashTxRequest,
  hashVK,
} from './abis.js';
import { Fr, FunctionData, NullifierLeafPreimage } from '../index.js';

describe('abis wasm bindings', () => {
  let wasm: CircuitsWasm;
  beforeEach(async () => {
    wasm = await CircuitsWasm.new();
  });
  it('hashes a tx request', async () => {
    const txRequest = makeTxRequest();
    const hash = await hashTxRequest(wasm, txRequest);
    expect(hash).toMatchSnapshot();
  });

  it('computes a function selector', async () => {
    const funcSig = 'transfer(address,uint256)';
    const res = await computeFunctionSelector(wasm, funcSig);
    expect(res).toMatchSnapshot();
  });

  it('hashes VK', async () => {
    const vk = makeVerificationKey();
    const res = await hashVK(wasm, vk.toBuffer());
    expect(res).toMatchSnapshot();
  });

  it('computes a function leaf', async () => {
    const leaf = Buffer.alloc(32);
    const res = await computeFunctionLeaf(wasm, leaf);
    expect(res).toMatchSnapshot();
  });

  it('computes function tree root', async () => {
    const res = await computeFunctionTreeRoot(wasm, [
      Buffer.alloc(32),
      Buffer.alloc(32),
      Buffer.alloc(32),
      Buffer.alloc(32),
    ]);
    expect(res).toMatchSnapshot();
  });

  it('hash constructor info', async () => {
    const functionData = new FunctionData(Buffer.alloc(4), true, true);
    const args = [new Fr(0n), new Fr(1n)];
    const vkHash = Buffer.alloc(32);
    const res = await hashConstructor(wasm, functionData, args, vkHash);
    expect(res).toMatchSnapshot();
  });

  it('computes a contract address', async () => {
    const deployerAddr = makeAztecAddress(1);
    const contractAddrSalt = randomBytes(32);
    const treeRoot = randomBytes(32);
    const constructorHash = randomBytes(32);
    const res = await computeContractAddress(wasm, deployerAddr, contractAddrSalt, treeRoot, constructorHash);
    expect(res).toMatchSnapshot();
  });

  it('computes contract leaf', async () => {
    const leafPreImage = new NullifierLeafPreimage(fr(2), fr(2 + 0x100), 2 + 0x200);
    const res = await computeContractLeaf(wasm, leafPreImage);
    expect(res).toMatchSnapshot();
  });
});
