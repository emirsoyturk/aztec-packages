#include "transcript.hpp"
#include "barretenberg/ecc/curves/bn254/g1.hpp"
#include "barretenberg/honk/composer/ultra_composer.hpp"
#include "barretenberg/numeric/bitop/get_msb.hpp"
#include "barretenberg/polynomials/univariate.hpp"
#include "barretenberg/proof_system/flavor/flavor.hpp"
#include <gtest/gtest.h>

using namespace proof_system::honk;

class UltraTranscriptTests : public ::testing::Test {
  public:
    static void SetUpTestSuite() { barretenberg::srs::init_crs_factory("../srs_db/ignition"); }

    using Flavor = proof_system::honk::flavor::Ultra;
    using FF = Flavor::FF;

    /**
     * @brief Construct a manifest for a Ultra Honk proof
     *
     * @details This is where we define the "Manifest" for a Ultra Honk proof. The tests in this suite are
     * intented to warn the developer if the Prover/Verifier has deviated from this manifest, however, the
     * Transcript class is not otherwise contrained to follow the manifest.
     *
     * @note Entries in the manifest consist of a name string and a size (bytes), NOT actual data.
     *
     * @return TranscriptManifest
     */
    TranscriptManifest construct_ultra_honk_manifest(size_t circuit_size)
    {
        TranscriptManifest manifest_expected;

        auto log_n = numeric::get_msb(circuit_size);

        size_t MAX_PARTIAL_RELATION_LENGTH = Flavor::BATCHED_RELATION_PARTIAL_LENGTH;
        size_t size_FF = sizeof(FF);
        size_t size_G = 2 * size_FF;
        size_t size_uni = MAX_PARTIAL_RELATION_LENGTH * size_FF;
        size_t size_evals = (Flavor::NUM_ALL_ENTITIES)*size_FF;
        size_t size_uint32 = 4;
        size_t size_uint64 = 8;

        size_t round = 0;
        manifest_expected.add_entry(round, "circuit_size", size_uint32);
        manifest_expected.add_entry(round, "public_input_size", size_uint32);
        manifest_expected.add_entry(round, "pub_inputs_offset", size_uint32);
        manifest_expected.add_entry(round, "public_input_0", size_FF);
        manifest_expected.add_entry(round, "W_L", size_G);
        manifest_expected.add_entry(round, "W_R", size_G);
        manifest_expected.add_entry(round, "W_O", size_G);
        manifest_expected.add_challenge(round, "eta");

        round++;
        manifest_expected.add_entry(round, "SORTED_ACCUM", size_G);
        manifest_expected.add_entry(round, "W_4", size_G);
        manifest_expected.add_challenge(round, "beta", "gamma");

        round++;
        manifest_expected.add_entry(round, "Z_PERM", size_G);
        manifest_expected.add_entry(round, "Z_LOOKUP", size_G);
        manifest_expected.add_challenge(round, "Sumcheck:alpha", "Sumcheck:zeta");

        for (size_t i = 0; i < log_n; ++i) {
            round++;
            std::string idx = std::to_string(i);
            manifest_expected.add_entry(round, "Sumcheck:univariate_" + idx, size_uni);
            std::string label = "Sumcheck:u_" + idx;
            manifest_expected.add_challenge(round, label);
        }

        round++;
        manifest_expected.add_entry(round, "Sumcheck:evaluations", size_evals);
        manifest_expected.add_challenge(round, "rho");

        round++;
        for (size_t i = 0; i < log_n; ++i) {
            std::string idx = std::to_string(i);
            manifest_expected.add_entry(round, "ZM:C_q_" + idx, size_G);
        }
        manifest_expected.add_challenge(round, "ZM:y");

        round++;
        manifest_expected.add_entry(round, "ZM:C_q", size_G);
        manifest_expected.add_challenge(round, "ZM:x", "ZM:z");

        round++;
        // TODO(Mara): Make testing more flavor agnostic so we can test this with all flavors
        if constexpr (proof_system::IsGrumpkinFlavor<Flavor>) {
            manifest_expected.add_entry(round, "IPA:poly_degree", size_uint64);
            manifest_expected.add_challenge(round, "IPA:generator_challenge");

            for (size_t i = 0; i < log_n; i++) {
                round++;
                std::string idx = std::to_string(i);
                manifest_expected.add_entry(round, "IPA:L_" + idx, size_G);
                manifest_expected.add_entry(round, "IPA:R_" + idx, size_G);
                std::string label = "IPA:round_challenge_" + idx;
                manifest_expected.add_challenge(round, label);
            }

            round++;
            manifest_expected.add_entry(round, "IPA:a_0", size_FF);
        } else {
            manifest_expected.add_entry(round, "ZM:PI", size_G);
        }

        manifest_expected.add_challenge(round); // no challenge

        return manifest_expected;
    }
};

/**
 * @brief Ensure consistency between the manifest hard coded in this testing suite and the one generated by the
 * standard honk prover over the course of proof construction.
 */
TEST_F(UltraTranscriptTests, ProverManifestConsistency)
{
    // Construct a simple circuit of size n = 8 (i.e. the minimum circuit size)
    typename Flavor::FF a = 1;
    auto builder = typename Flavor::CircuitBuilder();
    builder.add_variable(a);
    builder.add_public_variable(a);

    // Automatically generate a transcript manifest by constructing a proof
    auto composer = UltraComposer();
    auto instance = composer.create_instance(builder);
    auto prover = composer.create_prover(instance);
    auto proof = prover.construct_proof();

    // Check that the prover generated manifest agrees with the manifest hard coded in this suite
    auto manifest_expected = construct_ultra_honk_manifest(instance->proving_key->circuit_size);
    auto prover_manifest = prover.transcript.get_manifest();
    // Note: a manifest can be printed using manifest.print()
    for (size_t round = 0; round < manifest_expected.size(); ++round) {
        ASSERT_EQ(prover_manifest[round], manifest_expected[round]) << "Prover manifest discrepency in round " << round;
    }
}

/**
 * @brief Ensure consistency between the manifest generated by the ultra honk prover over the course of proof
 * construction and the one generated by the verifier over the course of proof verification.
 *
 */
TEST_F(UltraTranscriptTests, VerifierManifestConsistency)
{

    // Construct a simple circuit of size n = 8 (i.e. the minimum circuit size)
    auto builder = proof_system::UltraCircuitBuilder();

    auto a = 2;
    builder.add_variable(a);
    builder.add_public_variable(a);

    // Automatically generate a transcript manifest in the prover by constructing a proof
    auto composer = UltraComposer();
    auto instance = composer.create_instance(builder);
    auto prover = composer.create_prover(instance);
    auto proof = prover.construct_proof();

    // Automatically generate a transcript manifest in the verifier by verifying a proof
    auto verifier = composer.create_verifier(instance);
    verifier.verify_proof(proof);

    // Check consistency between the manifests generated by the prover and verifier
    auto prover_manifest = prover.transcript.get_manifest();
    auto verifier_manifest = verifier.transcript.get_manifest();

    // Note: a manifest can be printed using manifest.print()
    for (size_t round = 0; round < prover_manifest.size(); ++round) {
        ASSERT_EQ(prover_manifest[round], verifier_manifest[round])
            << "Prover/Verifier manifest discrepency in round " << round;
    }
}

/**
 * @brief Check that multiple challenges can be generated and sanity check
 * @details We generate 6 challenges that are each 128 bits, and check that they are not 0.
 *
 */
TEST_F(UltraTranscriptTests, ChallengeGenerationTest)
{
    // initialized with random value sent to verifier
    auto transcript = ProverTranscript<FF>::init_empty();
    // test a bunch of challenges
    auto challenges = transcript.get_challenges("a", "b", "c", "d", "e", "f");
    // check they are not 0
    for (size_t i = 0; i < challenges.size(); ++i) {
        ASSERT_NE(challenges[i], 0) << "Challenge " << i << " is 0";
    }
    constexpr uint32_t random_val{ 17 }; // arbitrary
    transcript.send_to_verifier("random val", random_val);
    // test more challenges
    auto [a, b, c] = transcript.get_challenges("a", "b", "c");
    ASSERT_NE(a, 0) << "Challenge a is 0";
    ASSERT_NE(b, 0) << "Challenge a is 0";
    ASSERT_NE(b, 0) << "Challenge a is 0";
}

TEST_F(UltraTranscriptTests, FoldingManifestTest)
{
    using Flavor = flavor::Ultra;
    auto composer = UltraComposer();

    std::vector<std::shared_ptr<ProverInstance_<Flavor>>> insts(2);
    std::generate(insts.begin(), insts.end(), [&]() {
        auto builder = proof_system::UltraCircuitBuilder();
        auto a = FF::random_element();
        auto b = FF::random_element();
        builder.add_variable(a);
        builder.add_public_variable(a);
        builder.add_public_variable(b);
        return composer.create_instance(builder);
    });

    // artificially make first instance relaxed
    auto log_instance_size = static_cast<size_t>(numeric::get_msb(insts[0]->proving_key->circuit_size));
    std::vector<FF> betas(log_instance_size);
    for (size_t idx = 0; idx < log_instance_size; idx++) {
        betas[idx] = FF::random_element();
    }
    insts[0]->folding_parameters = { betas, FF(1) };

    auto prover = composer.create_folding_prover(insts);
    auto verifier = composer.create_folding_verifier(insts);

    auto prover_res = prover.fold_instances();
    verifier.fold_public_parameters(prover_res.folding_data);

    // Check consistency between the manifests generated by the prover and verifier
    auto prover_manifest = prover.transcript.get_manifest();
    auto verifier_manifest = verifier.transcript.get_manifest();
    for (size_t round = 0; round < prover_manifest.size(); ++round) {
        ASSERT_EQ(prover_manifest[round], verifier_manifest[round])
            << "Prover/Verifier manifest discrepency in round " << round;
    }
}
