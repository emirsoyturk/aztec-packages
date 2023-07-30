#pragma once
#include <array>
#include <tuple>

#include "barretenberg/common/constexpr_utils.hpp"
#include "barretenberg/honk/sumcheck/polynomials/univariate.hpp"
#include "barretenberg/honk/sumcheck/relations/relation_parameters.hpp"
#include "barretenberg/honk/sumcheck/relations/relation_types.hpp"
#include "barretenberg/polynomials/polynomial.hpp"

namespace proof_system::honk::sumcheck {

template <typename FF> class ECCVMSetRelationBase {
  public:
    // 1 + polynomial degree of this relation
    static constexpr size_t RELATION_LENGTH = 19;

    static constexpr size_t LEN_1 = RELATION_LENGTH; // grand product construction sub-relation
    static constexpr size_t LEN_2 = RELATION_LENGTH; // left-shiftable polynomial sub-relation
    template <template <size_t...> typename AccumulatorTypesContainer>
    using AccumulatorTypesBase = AccumulatorTypesContainer<LEN_1>;
    template <typename T> using Accumulator = typename std::tuple_element<0, typename T::Accumulators>::type;

    template <typename AccumulatorTypes>
    static Accumulator<AccumulatorTypes> convert_to_wnaf(const auto& s0, const auto& s1)
    {
        auto t = s0 + s0;
        t += t;
        t += s1;

        auto naf = t + t - 15;
        return naf;
    }

    inline static auto& get_grand_product_polynomial(auto& input) { return input.z_perm; }
    inline static auto& get_shifted_grand_product_polynomial(auto& input) { return input.z_perm_shift; }

    template <typename AccumulatorTypes>
    static Accumulator<AccumulatorTypes> compute_permutation_numerator(const auto& extended_edges,
                                                                       const RelationParameters<FF>& relation_params,
                                                                       size_t index = 0);

    template <typename AccumulatorTypes>
    static Accumulator<AccumulatorTypes> compute_permutation_denominator(const auto& extended_edges,
                                                                         const RelationParameters<FF>& relation_params,
                                                                         size_t index = 0);
    /**
     * @brief Expression for the StandardArithmetic gate.
     * @details The relation is defined as C(extended_edges(X)...) =
     *    (q_m * w_r * w_l) + (q_l * w_l) + (q_r * w_r) + (q_o * w_o) + q_c
     *
     * @param evals transformed to `evals + C(extended_edges(X)...)*scaling_factor`
     * @param extended_edges an std::array containing the fully extended Univariate edges.
     * @param parameters contains beta, gamma, and public_input_delta, ....
     * @param scaling_factor optional term to scale the evaluation before adding to evals.
     */
    template <typename AccumulatorTypes>
    void add_edge_contribution_impl(typename AccumulatorTypes::Accumulators& accumulator,
                                    const auto& extended_edges,
                                    const RelationParameters<FF>& relation_params,
                                    const FF& scaling_factor) const;
};

template <typename FF> using ECCVMSetRelation = RelationWrapper<FF, ECCVMSetRelationBase>;

} // namespace proof_system::honk::sumcheck
