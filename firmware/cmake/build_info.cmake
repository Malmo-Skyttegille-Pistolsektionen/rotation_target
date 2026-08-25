# ============================================================================
#  firmware/cmake/build_info.cmake
#  Generates build_info.generated.h: what produced this image (#228).
#
#  Run at BUILD time (`cmake -P`) and on every build, not at configure time.
#  HEAD moves, a file is edited, a tag is cut - none of which makes CMake
#  reconfigure, so a configure-time answer describes whichever commit the build
#  tree was last configured on. The output is written through
#  `copy_if_different`, so an unchanged answer does not force a recompile.
#
#  Inputs (-D): RT_REPO_DIR, RT_VERSION, RT_IDF_VERSION, RT_WEBAPP_DIR (may be
#  empty), RT_RESOURCES_DIR, RT_OUTPUT.
# ============================================================================
cmake_minimum_required(VERSION 3.16)

find_package(Git QUIET)

# Every git call answers "" rather than failing the build. A tarball, or a
# container with no checkout, is a legitimate way to build this firmware; it
# just cannot say which commit it came from, and saying so honestly beats
# refusing to build.
function(rt_git OUT_VAR)
    set(${OUT_VAR} "" PARENT_SCOPE)
    if(NOT GIT_FOUND)
        return()
    endif()
    execute_process(
        COMMAND "${GIT_EXECUTABLE}" ${ARGN}
        WORKING_DIRECTORY "${RT_REPO_DIR}"
        OUTPUT_VARIABLE _out
        OUTPUT_STRIP_TRAILING_WHITESPACE
        ERROR_QUIET
        RESULT_VARIABLE _result)
    if(_result EQUAL 0)
        set(${OUT_VAR} "${_out}" PARENT_SCOPE)
    endif()
endfunction()

# A digest of a directory tree that does not depend on the filesystem's
# ordering, on timestamps, or on anything a rebuild would change. Sorted
# relative paths hashed alongside their contents, so a renamed file changes the
# answer as surely as an edited one.
#
# Hashes the *sources* rather than the staged tree on purpose: the staged
# webapp is gzip -9 output, and different gzip versions do not promise
# identical bytes - the digest would then change for a bundle that had not.
function(rt_tree_digest OUT_VAR DIR)
    set(${OUT_VAR} "" PARENT_SCOPE)
    if(NOT DIR OR NOT IS_DIRECTORY "${DIR}")
        return()
    endif()
    file(GLOB_RECURSE _files RELATIVE "${DIR}" "${DIR}/*")
    list(SORT _files)
    set(_manifest "")
    foreach(_rel IN LISTS _files)
        if(NOT IS_DIRECTORY "${DIR}/${_rel}")
            file(SHA256 "${DIR}/${_rel}" _hash)
            string(APPEND _manifest "${_rel} ${_hash}\n")
        endif()
    endforeach()
    string(SHA256 _digest "${_manifest}")
    set(${OUT_VAR} "${_digest}" PARENT_SCOPE)
endfunction()

rt_git(RT_GIT_BRANCH rev-parse --abbrev-ref HEAD)
rt_git(RT_GIT_SHA_FULL rev-parse HEAD)
rt_git(RT_GIT_SHA_SHORT rev-parse --short HEAD)
rt_git(RT_GIT_DESCRIBE describe --tags --always --dirty)
rt_git(RT_GIT_COMMIT_TIME log -1 --format=%cI)
rt_git(RT_GIT_TOTAL_COMMITS rev-list --count HEAD)
rt_git(RT_GIT_CLOSEST_TAG describe --tags --abbrev=0)
if(RT_GIT_CLOSEST_TAG)
    rt_git(RT_GIT_TAG_DISTANCE rev-list --count "${RT_GIT_CLOSEST_TAG}..HEAD")
endif()

# `--porcelain` is the machine-readable one and stays stable across git
# versions; any output at all means the tree is not clean.
rt_git(RT_GIT_STATUS status --porcelain)
if(RT_GIT_STATUS STREQUAL "")
    set(RT_DIRTY "false")
else()
    set(RT_DIRTY "true")
endif()

# Honours SOURCE_DATE_EPOCH by itself, which is the escape hatch if a
# byte-reproducible build is ever wanted - this is the one field that stops it.
string(TIMESTAMP RT_BUILD_TIME "%Y-%m-%dT%H:%M:%SZ" UTC)

# The identity rule (#228). On a GitHub-hosted runner the hostname is a
# throwaway like `fv-az1234-567`: it names nobody and is genuinely useful for
# tracing which runner produced a release. On a local build it is a developer's
# machine name, and this repository is public - so a local build says "local"
# and carries no user identity at all.
if(DEFINED ENV{CI} AND NOT "$ENV{CI}" STREQUAL "")
    cmake_host_system_information(RESULT RT_BUILD_HOST QUERY HOSTNAME)
    set(RT_CI_RUN_ID "$ENV{GITHUB_RUN_ID}")
else()
    set(RT_BUILD_HOST "local")
    set(RT_CI_RUN_ID "")
endif()

rt_tree_digest(RT_WEBAPP_DIGEST "${RT_WEBAPP_DIR}")
rt_tree_digest(RT_AUDIO_DIGEST "${RT_RESOURCES_DIR}/audios/files")

# --- emit -------------------------------------------------------------------

set(RT_DETAILS "")

# One list entry per detail; joined with line continuations at the end, because
# a multi-line #define needs a backslash on every line but the last and getting
# that wrong is a compile error in generated code nobody reads.
#
# Values reach a C string literal, so a backslash or a quote in a branch name
# would otherwise end the literal early and break the build in a way nobody
# would connect to the branch they were on.
function(rt_detail KEY VALUE)
    if(VALUE STREQUAL "")
        return()
    endif()
    string(REPLACE "\\" "\\\\" VALUE "${VALUE}")
    string(REPLACE "\"" "\\\"" VALUE "${VALUE}")
    list(APPEND RT_DETAILS "    {\"${KEY}\", \"${VALUE}\"},")
    set(RT_DETAILS "${RT_DETAILS}" PARENT_SCOPE)
endfunction()

rt_detail("git.branch" "${RT_GIT_BRANCH}")
rt_detail("git.commit.id.full" "${RT_GIT_SHA_FULL}")
rt_detail("git.commit.id.describe" "${RT_GIT_DESCRIBE}")
rt_detail("git.commit.time" "${RT_GIT_COMMIT_TIME}")
rt_detail("git.closest.tag.name" "${RT_GIT_CLOSEST_TAG}")
rt_detail("git.closest.tag.commit.count" "${RT_GIT_TAG_DISTANCE}")
rt_detail("git.total.commit.count" "${RT_GIT_TOTAL_COMMITS}")
rt_detail("build.idf.version" "${RT_IDF_VERSION}")
rt_detail("build.host" "${RT_BUILD_HOST}")
rt_detail("build.ci.run.id" "${RT_CI_RUN_ID}")
rt_detail("content.webapp.sha256" "${RT_WEBAPP_DIGEST}")
rt_detail("content.audio.sha256" "${RT_AUDIO_DIGEST}")

# `build.idf.version` and `build.host` are always set, so the array is never
# empty - a zero-length array is ill-formed C++.
string(JOIN " \\\n" RT_DETAILS_TEXT ${RT_DETAILS})

string(REPLACE "\\" "\\\\" RT_VERSION_ESCAPED "${RT_VERSION}")
string(REPLACE "\"" "\\\"" RT_VERSION_ESCAPED "${RT_VERSION_ESCAPED}")

set(RT_HEADER "// Generated by firmware/cmake/build_info.cmake - do not edit, do not commit.
#pragma once

#define RT_BUILD_VERSION \"${RT_VERSION_ESCAPED}\"
#define RT_BUILD_COMMIT \"${RT_GIT_SHA_SHORT}\"
#define RT_BUILD_DIRTY ${RT_DIRTY}
#define RT_BUILD_TIME \"${RT_BUILD_TIME}\"

#define RT_BUILD_DETAILS \\
${RT_DETAILS_TEXT}
")

file(WRITE "${RT_OUTPUT}.tmp" "${RT_HEADER}")
# Only when it actually changed: this script runs on every build, and rewriting
# the header unconditionally would recompile the firmware every time.
execute_process(COMMAND "${CMAKE_COMMAND}" -E copy_if_different
                        "${RT_OUTPUT}.tmp" "${RT_OUTPUT}")
file(REMOVE "${RT_OUTPUT}.tmp")
