# Standalone reference experiments for the OpenFHE NTT / INTT.
#
# Built the way any external project links against OpenFHE, following
# CMakeLists.User.txt from the OpenFHE distribution: find_package(OpenFHE CONFIG).
# Nothing here is inside the OpenFHE source tree.
#
#   cmake -S . -B build -DCMAKE_PREFIX_PATH=<openfhe-install-prefix>
#   cmake --build build -j
#   ./build/gt_run_all
cmake_minimum_required(VERSION 3.16)
project(openfhe-gt-exp CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(OpenFHE CONFIG REQUIRED)
message(STATUS "OpenFHE version:      ${BASE_OPENFHE_VERSION}")
message(STATUS "OpenFHE include:      ${OpenFHE_INCLUDE}")
message(STATUS "OpenFHE NATIVE_SIZE:  ${OpenFHE_NATIVE_SIZE}")
message(STATUS "OpenFHE MATHBACKEND:  ${OpenFHE_BACKEND}")

# The traces on the website were produced with NATIVE_SIZE=64. A different build
# would give different Shoup constants, so refuse rather than mislead.
if(NOT "${OpenFHE_NATIVE_SIZE}" STREQUAL "64")
    message(FATAL_ERROR
        "This project expects an OpenFHE built with NATIVE_SIZE=64, found "
        "${OpenFHE_NATIVE_SIZE}. The reference values would not match.")
endif()

# Use the flags OpenFHE was built with, as its own template does. That includes
# -Wall -Werror, so this code has to be warning-free.
set(CMAKE_CXX_FLAGS "${OpenFHE_CXX_FLAGS}")
set(CMAKE_EXE_LINKER_FLAGS "${OpenFHE_EXE_LINKER_FLAGS}")

include_directories(${OPENMP_INCLUDES})
include_directories(${OpenFHE_INCLUDE})
include_directories(${OpenFHE_INCLUDE}/third-party/include)
include_directories(${OpenFHE_INCLUDE}/core)
include_directories(${OpenFHE_INCLUDE}/pke)
include_directories(${OpenFHE_INCLUDE}/binfhe)
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/include)

link_directories(${OpenFHE_LIBDIR})
link_directories(${OPENMP_LIBRARIES})
if(BUILD_STATIC)
    link_libraries(${OpenFHE_STATIC_LIBRARIES})
else()
    link_libraries(${OpenFHE_SHARED_LIBRARIES})
endif()

add_library(gt_report STATIC src/gt_report.cpp)

# gt_experiment  -- one experiment, printed to stdout
# gt_run_all     -- runs every experiment and writes the reports
foreach(prog gt_experiment gt_run_all)
    add_executable(${prog} src/${prog}.cpp)
    target_link_libraries(${prog} gt_report)
endforeach()
