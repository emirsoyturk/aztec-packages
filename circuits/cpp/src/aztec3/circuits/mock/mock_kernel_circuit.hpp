#pragma once
#include <aztec3/circuits/abis/kernel_circuit_public_inputs.hpp>
#include <aztec3/utils/types/circuit_types.hpp>
#include <aztec3/utils/types/native_types.hpp>

#include <barretenberg/common/map.hpp>
#include <barretenberg/stdlib/commitment/pedersen/pedersen.hpp>
#include <barretenberg/stdlib/primitives/field/field.hpp>
#include <barretenberg/stdlib/primitives/witness/witness.hpp>

namespace aztec3::circuits::mock {

using aztec3::circuits::abis::KernelCircuitPublicInputs;
using NT = aztec3::utils::types::NativeTypes;
using aztec3::utils::types::CircuitTypes;
using plonk::stdlib::pedersen_commitment;
using plonk::stdlib::witness_t;

template <typename Composer>
KernelCircuitPublicInputs<NT> mock_kernel_circuit(Composer& composer,
                                                  KernelCircuitPublicInputs<NT> const& _public_inputs)
{
    using CT = CircuitTypes<Composer>;
    using fr = typename CT::fr;

    auto public_inputs = _public_inputs.to_circuit_type(composer);

    {
        std::vector<uint32_t> dummy_witness_indices;
        // 16 is the number of values added to `proof_witness_indices` at the end of `verify_proof`.
        constexpr size_t num_witness_indices = 16;
        for (size_t i = 0; i < num_witness_indices; ++i) {
            auto const witness = typename CT::fr(witness_t(&composer, i));
            uint32_t const witness_index = witness.get_witness_index();
            dummy_witness_indices.push_back(witness_index);
        }
        public_inputs.end.aggregation_object.proof_witness_indices = dummy_witness_indices;
    }

    public_inputs.set_public();

    // NOTE: We don't want a recursive proof in the mock kernel proof.
    // We still add dummy witness indices in the recursive proof indices just so that we don't trigger an assertion in
    // while setting recursion elements as public inputs. These dummy indices would not be used as we're setting
    // contains_recursive_proof to be false.
    composer.contains_recursive_proof = false;

    plonk::stdlib::pedersen_commitment<Composer>::compress(CT::fr(witness_t(&composer, 1)),
                                                           CT::fr(witness_t(&composer, 1)));
    return public_inputs.template to_native_type<Composer>();
}

}  // namespace aztec3::circuits::mock
