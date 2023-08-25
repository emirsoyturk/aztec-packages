import createDebug from "debug";

createDebug.enable("*");
const debug = createDebug("simple_test");

async function runTest(acir: Uint8Array, witness: Uint8Array) {
  const { newBarretenbergApiAsync, RawBuffer, Crs } = await import(
    "@aztec/bb.js"
  );
  const CIRCUIT_SIZE = 2 ** 19;

  debug("starting test...");
  const api = await newBarretenbergApiAsync();

  // Important to init slab allocator as first thing, to ensure maximum memory efficiency.
  await api.commonInitSlabAllocator(CIRCUIT_SIZE);

  // Plus 1 needed!
  const crs = await Crs.new(CIRCUIT_SIZE + 1);
  await api.srsInitSrs(
    new RawBuffer(crs.getG1Data()),
    crs.numPoints,
    new RawBuffer(crs.getG2Data())
  );

  const iterations = 1;
  let totalTime = 0;
  for (let i = 0; i < iterations; ++i) {
    const start = new Date().getTime();
    debug(`iteration ${i} starting...`);
    await api.examplesSimpleCreateAndVerifyProof();
    totalTime += new Date().getTime() - start;
  }

  await api.destroy();

  debug(`avg iteration time: ${totalTime / iterations}ms`);
  debug("test complete.");
}

document.addEventListener("DOMContentLoaded", function () {
  const button = document.createElement("button");
  button.innerText = "Run Test";
  button.addEventListener("click", () =>
    runTest(new Uint8Array(), new Uint8Array())
  );
  document.body.appendChild(button);
});
