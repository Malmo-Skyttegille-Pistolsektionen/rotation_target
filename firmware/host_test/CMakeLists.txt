# Host (Linux) tests for lib/rt_logic, built on ESP-IDF's toolchain-independent
# Unity.
#
# Plain CMake + CTest, not an idf.py app: each test_*/test_*.cpp defines its own
# main(), so the suites cannot be linked into one "linux" target app. Requires
# IDF_PATH (i.e. ESP-IDF's export.sh sourced) only to locate the vendored Unity
# source - nothing else here needs the toolchain.
#
# Named per ESP-IDF convention: host_test/ is what ESP-IDF itself uses for tests
# that run on the build machine. Deliberately NOT test_apps/, which in that
# convention means an on-target application you flash to the chip.
cmake_minimum_required(VERSION 3.16)
project(rt_logic_tests C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(RT_COVERAGE "Instrument test suites for gcov/gcovr coverage" OFF)
# UBSan is not decoration here: signed-overflow in the duration arithmetic and
# in the id parsers is exactly the class of bug the run loop and the upload
# paths are exposed to, and it is invisible to -Wall. -fno-sanitize-recover
# makes a finding fail the suite rather than print and continue.
option(RT_SANITIZE "Build the test suites with ASan + UBSan" OFF)

if(NOT DEFINED ENV{IDF_PATH})
  message(FATAL_ERROR "IDF_PATH is not set - source $IDF_PATH/export.sh first")
endif()

set(UNITY_DIR "$ENV{IDF_PATH}/components/unity/unity/src")

add_library(unity STATIC "${UNITY_DIR}/unity.c")
target_include_directories(unity PUBLIC "${UNITY_DIR}")

set(RT_LOGIC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../lib/rt_logic")
set(ARDUINOJSON_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../lib/arduinojson")
set(TEST_DIR "${CMAKE_CURRENT_SOURCE_DIR}")

# The same sources the firmware compiles, so tested code == shipped code.
add_library(rt_logic STATIC
  "${RT_LOGIC_DIR}/program.cpp"
  "${RT_LOGIC_DIR}/executor.cpp"
  "${RT_LOGIC_DIR}/wav_header.cpp"
  "${RT_LOGIC_DIR}/ima_adpcm.cpp"
  "${RT_LOGIC_DIR}/console_command.cpp"
  "${RT_LOGIC_DIR}/hardware_config.cpp"
  "${RT_LOGIC_DIR}/version.cpp"
)
target_include_directories(rt_logic PUBLIC "${RT_LOGIC_DIR}")
# SYSTEM: vendored, and must stay byte-identical to upstream, so its warnings
# are not ours to fix. Without this the -O1 the sanitizers turn on enables
# -Wmaybe-uninitialized, which fires inside ArduinoJson and -Werror makes fatal.
target_include_directories(rt_logic SYSTEM PUBLIC "${ARDUINOJSON_DIR}")
target_compile_options(rt_logic PRIVATE -Wall -Wextra -Werror)

# program.cpp is the only TU that includes ArduinoJson. At the -O1 the
# sanitizers turn on, GCC raises -Wmaybe-uninitialized from inside the vendored
# header - and marking the include SYSTEM does not suppress it, because the
# warning is raised from inlined code during optimization, not from the header
# text. Scoped to this one file so executor.cpp keeps the full warning set.
set_source_files_properties("${RT_LOGIC_DIR}/program.cpp"
  PROPERTIES COMPILE_OPTIONS "-Wno-maybe-uninitialized")

if(RT_SANITIZE)
  # PUBLIC/INTERFACE so the suites linking rt_logic inherit both halves - a
  # sanitizer applied to only one of the two ends in link errors.
  target_compile_options(rt_logic PUBLIC -fsanitize=address,undefined
                         -fno-sanitize-recover=all -fno-omit-frame-pointer -O1 -g)
  target_link_options(rt_logic PUBLIC -fsanitize=address,undefined)
endif()

enable_testing()

# test_backend_issue parses its own output with ArduinoJson, so that the
# escaping is checked against a real parser rather than only against
# hand-written expectations. That makes it the second TU to include the
# vendored header, and it hits the same -O1 -Wmaybe-uninitialized as
# program.cpp above.
set_source_files_properties("${TEST_DIR}/test_backend_issue/test_backend_issue.cpp"
  PROPERTIES COMPILE_OPTIONS "-Wno-maybe-uninitialized")
set_source_files_properties("${TEST_DIR}/test_problem/test_problem.cpp"
  PROPERTIES COMPILE_OPTIONS "-Wno-maybe-uninitialized")

file(GLOB test_suites RELATIVE "${TEST_DIR}" "${TEST_DIR}/test_*")
foreach(suite ${test_suites})
  set(suite_dir "${TEST_DIR}/${suite}")
  if(IS_DIRECTORY "${suite_dir}")
    file(GLOB suite_src "${suite_dir}/*.cpp")
    add_executable(${suite} ${suite_src})
    target_include_directories(${suite} PRIVATE "${TEST_DIR}/fakes")
    target_link_libraries(${suite} PRIVATE rt_logic unity)
    target_compile_options(${suite} PRIVATE -Wall -Wextra -Werror)
    if(RT_COVERAGE)
      target_compile_options(${suite} PRIVATE --coverage -O0 -g)
      target_link_options(${suite} PRIVATE --coverage)
    endif()
    add_test(NAME ${suite} COMMAND ${suite})
  endif()
endforeach()

if(RT_COVERAGE)
  target_compile_options(rt_logic PRIVATE --coverage -O0 -g)
  target_link_options(rt_logic PUBLIC --coverage)
endif()
