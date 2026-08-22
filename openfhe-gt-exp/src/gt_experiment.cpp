//==================================================================================
// One experiment, printed to stdout.
//
//   ./gt_experiment            -- the default configuration, N=8 with a 5-bit q
//   ./gt_experiment 32 8       -- N=32 with an 8-bit q
//==================================================================================

#include "gt_report.h"

#include <cstdlib>
#include <iostream>
#include <string>

int main(int argc, char** argv) {
    uint32_t N = 8, bits = 5;
    if (argc == 3) {
        N = static_cast<uint32_t>(std::strtoul(argv[1], nullptr, 10));
        bits = static_cast<uint32_t>(std::strtoul(argv[2], nullptr, 10));
    }
    else if (argc != 1) {
        std::cerr << "usage: " << argv[0] << " [ring-dimension modulus-bits]\n"
                  << "example: " << argv[0] << " 8 5\n";
        return 1;
    }
    if (N < 2 || (N & (N - 1)) != 0) {
        std::cerr << "The ring dimension must be a power of two, not " << N << ".\n";
        return 1;
    }

    nttgt::writeBuildHeader(std::cout);
    std::cout << "\n";
    const auto r = nttgt::runExperiment(N, bits, std::cout, nullptr);
    if (!r.feasible)
        return 2;
    return r.allChecksPassed ? 0 : 3;
}
