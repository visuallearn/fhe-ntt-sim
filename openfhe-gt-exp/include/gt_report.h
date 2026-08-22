//==================================================================================
// One NTT ground-truth experiment: run OpenFHE over one (N, modulus-bits) pair
// and print everything it used and everything it produced.
//==================================================================================

#ifndef GT_REPORT_H
#define GT_REPORT_H

#include <cstdint>
#include <ostream>
#include <string>
#include <vector>

namespace nttgt {

struct ExpResult {
    bool feasible = false;
    bool allChecksPassed = false;
    std::string reason;   // why not feasible, when it is not
    std::string name;     // e.g. "n8-b5-q17"
    uint32_t N = 0, M = 0, bits = 0;
    uint64_t q = 0, psi = 0;
    unsigned checks = 0;
    unsigned failures = 0;
};

/// Run the experiment for (N, bits) and write a full human-readable report.
/// If `digest` is non-null, append machine-readable lines for cross-checking.
ExpResult runExperiment(uint32_t N, uint32_t bits, std::ostream& report,
                        std::vector<std::string>* digest);

/// Header block describing the build that produced the numbers.
void writeBuildHeader(std::ostream& out);

}  // namespace nttgt

#endif  // GT_REPORT_H
