//==================================================================================
// Runs every experiment and writes one report for each.
//
//   ./gt_run_all [output-directory]      default: ../expected relative to the binary
//
// Writes:
//   <out>/n<N>-b<bits>-q<q>.txt   the full report for one configuration
//   <out>/DIGEST.txt              one line per vector, for automated comparison
//   <out>/SUMMARY.txt             the parameter grid and the verdicts
//==================================================================================

#include "gt_report.h"
#include "ntt_gt_cases.h"

#include <filesystem>
#include <map>
#include <utility>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>

using nttgt::u32;

int main(int argc, char** argv) {
    const std::filesystem::path out = (argc > 1) ? argv[1] : "expected";
    std::error_code ec;
    std::filesystem::create_directories(out, ec);
    if (ec) {
        std::cerr << "cannot create " << out << ": " << ec.message() << "\n";
        return 1;
    }

    std::vector<std::string> digest;
    std::ostringstream summary;
    nttgt::writeBuildHeader(summary);
    summary << "\nPARAMETER GRID\n"
            << "  A dash means OpenFHE has no prime of that bit size congruent to 1 mod 2N.\n\n"
            << "  bits";
    for (u32 n : nttgt::ringDimensions())
        summary << std::setw(10) << ("N=" + std::to_string(n));
    summary << "\n";

    unsigned total = 0, possible = 0, failed = 0;
    std::vector<std::string> written;

    // One pass to fill the grid, reusing the reports we are about to write.
    std::map<std::pair<u32, u32>, nttgt::ExpResult> results;
    for (u32 bits : nttgt::modulusBits()) {
        for (u32 n : nttgt::ringDimensions()) {
            std::ostringstream report;
            nttgt::writeBuildHeader(report);
            report << "\n";
            const auto r = nttgt::runExperiment(n, bits, report, &digest);
            results[{n, bits}] = r;
            ++total;
            if (!r.feasible)
                continue;
            ++possible;
            if (!r.allChecksPassed)
                ++failed;
            const auto path = out / (r.name + ".txt");
            std::ofstream f(path, std::ios::binary);
            if (!f) {
                std::cerr << "cannot write " << path << "\n";
                return 1;
            }
            f << report.str();
            written.push_back(r.name);
            std::cout << "  " << std::setw(16) << r.name << "  " << std::setw(4) << r.checks
                      << " checks  " << (r.allChecksPassed ? "ok" : "FAILED") << "\n";
        }
    }

    for (u32 bits : nttgt::modulusBits()) {
        summary << std::setw(6) << bits;
        for (u32 n : nttgt::ringDimensions()) {
            const auto& r = results[{n, bits}];
            summary << std::setw(10) << (r.feasible ? std::to_string(r.q) : "-");
        }
        summary << "\n";
    }
    summary << "\n" << possible << " of " << total << " parameter pairs are possible.\n"
            << failed << " of them had a failing check.\n\nREPORTS\n";
    for (const auto& n : written)
        summary << "  " << n << ".txt\n";

    {
        std::ofstream f(out / "SUMMARY.txt", std::ios::binary);
        f << summary.str();
    }
    {
        std::ofstream f(out / "DIGEST.txt", std::ios::binary);
        f << "# One line per recorded vector: <config>\\t<key>\\t<values>\n"
          << "# Compared against docs/data/traces/*.json by tools/13_check_gt.py\n";
        for (const auto& line : digest)
            f << line << "\n";
    }

    std::cout << "\n" << possible << " experiments written to " << out << "\n"
              << digest.size() << " digest lines\n";
    if (failed) {
        std::cerr << failed << " experiment(s) had a failing check\n";
        return 3;
    }
    std::cout << "every check passed\n";
    return 0;
}
