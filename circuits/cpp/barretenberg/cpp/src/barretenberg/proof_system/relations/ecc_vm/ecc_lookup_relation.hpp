#pragma once
#include <array>
#include <tuple>

#include "barretenberg/common/constexpr_utils.hpp"
#include "barretenberg/honk/sumcheck/polynomials/univariate.hpp"
#include "barretenberg/honk/sumcheck/relations/relation_parameters.hpp"
#include "barretenberg/honk/sumcheck/relations/relation_types.hpp"
#include "barretenberg/polynomials/polynomial.hpp"

namespace proof_system::honk::sumcheck {

template <typename FF> class ECCVMLookupRelationBase {
  public:
    static constexpr size_t READ_TERMS = 4;
    static constexpr size_t WRITE_TERMS = 2;
    // 1 + polynomial degree of this relation
    static constexpr size_t RELATION_LENGTH = READ_TERMS + WRITE_TERMS + 3; // 9

    static constexpr size_t LEN_1 = RELATION_LENGTH; // grand product construction sub-relation
    static constexpr size_t LEN_2 = RELATION_LENGTH; // left-shiftable polynomial sub-relation
    template <template <size_t...> typename AccumulatorTypesContainer>
    using AccumulatorTypesBase = AccumulatorTypesContainer<LEN_1, LEN_2>;
    template <typename T> using Accumulator = typename std::tuple_element<0, typename T::Accumulators>::type;

    static constexpr std::array<bool, 2> SUBRELATION_LINEARLY_INDEPENDENT = { true, false };

    template <typename AccumulatorTypes>
    static Accumulator<AccumulatorTypes> convert_to_wnaf(const auto& s0, const auto& s1)
    {
        auto t = s0 + s0;
        t += t;
        t += s1;

        auto naf = t + t - 15;
        return naf;
    }

    /**
     * @brief
     *
     * @tparam read_index
     * @param extended_edges
     * @param relation_params
     * @param index
     * @return Univariate
     */
    template <typename AccumulatorTypes>
    static bool lookup_exists_at_row_index(const auto& extended_edges,
                                           const RelationParameters<FF>& /*unused*/,
                                           const size_t index = 0)

    {
        auto msm_add = get_view<FF, AccumulatorTypes>(extended_edges.msm_add, index);
        auto msm_skew = get_view<FF, AccumulatorTypes>(extended_edges.msm_skew, index);
        auto precompute_select = get_view<FF, AccumulatorTypes>(extended_edges.precompute_select, index);
        return (msm_add == 1) || (msm_skew == 1) || (precompute_select == 1);
    }

    /**
     * @brief
     *
     * @tparam read_index
     * @param extended_edges
     * @param relation_params
     * @param index
     * @return Univariate
     */
    template <typename AccumulatorTypes, size_t read_index>
    static Accumulator<AccumulatorTypes> compute_read_term_predicate(const auto& extended_edges,
                                                                     const RelationParameters<FF>& /*unused*/,
                                                                     const size_t index = 0)

    {
        if constexpr (read_index == 0) {
            return Accumulator<AccumulatorTypes>(get_view<FF, AccumulatorTypes>(extended_edges.msm_add1, index));
        }
        if constexpr (read_index == 1) {
            return Accumulator<AccumulatorTypes>(get_view<FF, AccumulatorTypes>(extended_edges.msm_add2, index));
        }
        if constexpr (read_index == 2) {
            return Accumulator<AccumulatorTypes>(get_view<FF, AccumulatorTypes>(extended_edges.msm_add3, index));
        }
        if constexpr (read_index == 3) {
            return Accumulator<AccumulatorTypes>(get_view<FF, AccumulatorTypes>(extended_edges.msm_add4, index));
        }
        return Accumulator<AccumulatorTypes>(1);
    }

    template <typename AccumulatorTypes, size_t write_index>
    static Accumulator<AccumulatorTypes> compute_write_term_predicate(const auto& extended_edges,
                                                                      const RelationParameters<FF>& /*unused*/,
                                                                      const size_t index = 0)

    {
        if constexpr (write_index == 0) {
            return Accumulator<AccumulatorTypes>(get_view<FF, AccumulatorTypes>(extended_edges.precompute_select, index));
        }
        if constexpr (write_index == 1) {
            return Accumulator<AccumulatorTypes>(get_view<FF, AccumulatorTypes>(extended_edges.precompute_select, index));
        }
        return Accumulator<AccumulatorTypes>(1);
    }

    template <typename AccumulatorTypes, size_t write_index>
    static Accumulator<AccumulatorTypes> compute_write_term(const auto& extended_edges,
                                                            const RelationParameters<FF>& relation_params,
                                                            const size_t index = 0)
    {
        static_assert(write_index < WRITE_TERMS);

        // what are we looking up?
        // we want to map:
        // 1: point pc
        // 2: point slice
        // 3: point x
        // 4: point y
        // for each point in our point table, we want to map `slice` to (x, -y) AND `slice + 8` to (x, y)

        // round starts at 0 and increments to 7
        // point starts at 15[P] and decrements to [P]
        // a slice value of 0 maps to -15[P]
        // 1 -> -13[P]
        // 7 -> -[P]
        // 8 -> P
        // 15 -> 15[P]
        // negative points map pc, round, x, -y
        // positive points map pc, 15 - (round * 2), x, y
        const auto& precompute_pc = get_view<FF, AccumulatorTypes>(extended_edges.precompute_pc, index);
        const auto& tx = get_view<FF, AccumulatorTypes>(extended_edges.precompute_tx, index);
        const auto& ty = get_view<FF, AccumulatorTypes>(extended_edges.precompute_ty, index);
        const auto& precompute_round = get_view<FF, AccumulatorTypes>(extended_edges.precompute_round, index);
        const auto& gamma = relation_params.gamma;
        const auto& eta = relation_params.eta;
        const auto& eta_sqr = relation_params.eta_sqr;
        const auto& eta_cube = relation_params.eta_cube;

        // slice value : (wnaf value) : lookup term
        // 0 : -15 : 0
        // 1 : -13 : 1
        // 7 : -1 : 7
        // 8 : 1 : 0
        // 9 : 3 : 1
        // 15 : 15 : 7

        // slice value : negative term : positive term
        // 0 : 0 : 7
        // 1 : 1 : 6
        // 2 : 2 : 5
        // 3 : 3 : 4
        // 7 : 7 : 0

        // | 0 | 15[P].x | 15[P].y  | 0, -15[P].x, -15[P].y | 15, 15[P].x, 15[P].y |
        // | 1 | 13[P].x | 13[P].y | 1, -13[P].x, -13[P].y | 14, 13[P].x, 13[P].y
        // | 2 | 11[P].x | 11[P].y
        // | 3 |  9[P].x |  9[P].y
        // | 4 |  7[P].x |  7[P].y
        // | 5 |  5[P].x |  5[P].y
        // | 6 |  3[P].x |  3[P].y
        // | 7 |  1[P].x |  1[P].y | 7, -[P].x, -[P].y | 8 , [P].x, [P].y |

        const auto negative_term = precompute_pc + gamma + precompute_round * eta + tx * eta_sqr - ty * eta_cube;
        const auto positive_slice_value = -(precompute_round) + 15;
        const auto positive_term = precompute_pc + gamma + positive_slice_value * eta + tx * eta_sqr + ty * eta_cube;

        // todo optimise this?
        if constexpr (write_index == 0) {
            return positive_term; // degree 1
        }
        if constexpr (write_index == 1) {
            return negative_term; // degree 1
        }
        return Accumulator<AccumulatorTypes>(1);
    }

    /**
     * @brief
     *
     * @tparam read_index
     * @param extended_edges
     * @param relation_params
     * @param index
     * @return Univariate
     */
    template <typename AccumulatorTypes, size_t read_index>
    static Accumulator<AccumulatorTypes> compute_read_term(const auto& extended_edges,
                                                           const RelationParameters<FF>& relation_params,
                                                           const size_t index = 0)
    {
        // read term:
        // pc, slice, x, y
        static_assert(read_index < READ_TERMS);
        const auto& gamma = relation_params.gamma;
        const auto& eta = relation_params.eta;
        const auto& eta_sqr = relation_params.eta_sqr;
        const auto& eta_cube = relation_params.eta_cube;
        const auto& msm_pc = get_view<FF, AccumulatorTypes>(extended_edges.msm_pc, index);
        const auto& msm_count = get_view<FF, AccumulatorTypes>(extended_edges.msm_count, index);
        const auto& msm_slice1 = get_view<FF, AccumulatorTypes>(extended_edges.msm_slice1, index);
        const auto& msm_slice2 = get_view<FF, AccumulatorTypes>(extended_edges.msm_slice2, index);
        const auto& msm_slice3 = get_view<FF, AccumulatorTypes>(extended_edges.msm_slice3, index);
        const auto& msm_slice4 = get_view<FF, AccumulatorTypes>(extended_edges.msm_slice4, index);
        const auto& msm_x1 = get_view<FF, AccumulatorTypes>(extended_edges.msm_x1, index);
        const auto& msm_x2 = get_view<FF, AccumulatorTypes>(extended_edges.msm_x2, index);
        const auto& msm_x3 = get_view<FF, AccumulatorTypes>(extended_edges.msm_x3, index);
        const auto& msm_x4 = get_view<FF, AccumulatorTypes>(extended_edges.msm_x4, index);
        const auto& msm_y1 = get_view<FF, AccumulatorTypes>(extended_edges.msm_y1, index);
        const auto& msm_y2 = get_view<FF, AccumulatorTypes>(extended_edges.msm_y2, index);
        const auto& msm_y3 = get_view<FF, AccumulatorTypes>(extended_edges.msm_y3, index);
        const auto& msm_y4 = get_view<FF, AccumulatorTypes>(extended_edges.msm_y4, index);

        // how do we get pc value
        // row pc = value of pc after msm
        // row count = num processed points in round
        // size_of_msm = msm_size
        // value of pc at start of msm = msm_pc - msm_size_of_msm
        // value of current pc = msm_pc - msm_size_of_msm + msm_count + (0,1,2,3)
        const auto current_pc = msm_pc - msm_count;

        const auto read_term1 = (current_pc) + gamma + msm_slice1 * eta + msm_x1 * eta_sqr + msm_y1 * eta_cube;
        const auto read_term2 = (current_pc - 1) + gamma + msm_slice2 * eta + msm_x2 * eta_sqr + msm_y2 * eta_cube;
        const auto read_term3 = (current_pc - 2) + gamma + msm_slice3 * eta + msm_x3 * eta_sqr + msm_y3 * eta_cube;
        const auto read_term4 = (current_pc - 3) + gamma + msm_slice4 * eta + msm_x4 * eta_sqr + msm_y4 * eta_cube;

        if constexpr (read_index == 0) {
            return read_term1; // degree 1
        }
        if constexpr (read_index == 1) {
            return read_term2; // degree 1
        }
        if constexpr (read_index == 2) {
            return read_term3; // degree 1
        }
        if constexpr (read_index == 3) {
            return read_term4; // degree 1
        }
        return Accumulator<AccumulatorTypes>(1);
    }

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
                                    const FF& /*unused*/) const;
};

template <typename FF> using ECCVMLookupRelation = RelationWrapper<FF, ECCVMLookupRelationBase>;

} // namespace proof_system::honk::sumcheck
