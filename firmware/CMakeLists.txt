cmake_minimum_required(VERSION 3.16)

set(EXTRA_COMPONENT_DIRS "${CMAKE_CURRENT_LIST_DIR}/lib")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)

# The reported version is the git release tag and nothing else - see
# docs/RELEASING.md. Release tags are bare semver (`2.0.0`), so there is nothing
# to strip; the `--match` glob is still load-bearing, because IDF's default is a
# bare `git describe` that would happily name the firmware after an unrelated
# tag such as `pre-copilot`. Setting PROJECT_VER before project() takes
# precedence over IDF's own derivation.
set(RT_VERSION_TAG_GLOB "[0-9]*.[0-9]*.[0-9]*")
execute_process(
    COMMAND git describe --tags --match "${RT_VERSION_TAG_GLOB}" --always --dirty
    WORKING_DIRECTORY "${CMAKE_CURRENT_LIST_DIR}"
    OUTPUT_VARIABLE RT_GIT_DESCRIBE
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET
    RESULT_VARIABLE RT_GIT_DESCRIBE_RESULT)

if(NOT RT_GIT_DESCRIBE_RESULT EQUAL 0 OR "${RT_GIT_DESCRIBE}" STREQUAL "")
    # No git at all (a tarball, or a build container without the repository).
    set(PROJECT_VER "unknown")
    message(STATUS "Firmware version: no git metadata - the device will report 0.0.0")
elseif("${RT_GIT_DESCRIBE}" MATCHES "^[0-9]+\\.[0-9]+\\.[0-9]+")
    set(PROJECT_VER "${RT_GIT_DESCRIBE}")
    message(STATUS "Firmware version: ${PROJECT_VER}")
else()
    # `--always` fell back to a bare commit hash, so no release tag is
    # reachable. Kept as-is rather than faked into a number: the API's parser
    # rejects it and answers 0.0.0, which is the honest answer.
    set(PROJECT_VER "${RT_GIT_DESCRIBE}")
    message(STATUS
        "Firmware version: no release tag reachable from HEAD "
        "(${RT_GIT_DESCRIBE}) - the device will report 0.0.0. Fetch tags, or cut "
        "a release, to get a real version.")
endif()

project(rotation_target_backend)

# --- what produced this image (#228) ---------------------------------------
#
# Regenerated on every build rather than at configure time: HEAD moves, a file
# is edited, a tag is cut - none of which reconfigures a warm tree, so a
# configure-time answer would describe whichever commit the build directory was
# last configured on. The script writes through `copy_if_different`, so an
# unchanged answer costs nothing.
set(RT_BUILD_INFO_DIR "${CMAKE_BINARY_DIR}/generated")
set(RT_BUILD_INFO_HEADER "${RT_BUILD_INFO_DIR}/build_info.generated.h")
set(RT_BUILD_INFO_SCRIPT "${CMAKE_CURRENT_LIST_DIR}/cmake/build_info.cmake")
file(MAKE_DIRECTORY "${RT_BUILD_INFO_DIR}")

idf_build_get_property(RT_IDF_VER IDF_VER)

# The shipped programs and audio come from the monorepo's `resources/` tree and
# are flashed as a LittleFS image. They are staged into one tree first because
# the on-device layout is not the one resources/ uses: `shipped/` is what the
# firmware treats as read-only, and `uploads/` is the writable half the REST API
# adds to (created on first use).
set(RT_RESOURCES_DIR "${CMAKE_CURRENT_LIST_DIR}/../resources" CACHE PATH
    "Directory holding the shipped audio and programs (audios/, programs/)")

set(LITTLEFS_STAGE "${CMAKE_BINARY_DIR}/littlefs_stage")
set(LITTLEFS_STAGE_STAMP "${CMAKE_BINARY_DIR}/littlefs_stage.stamp")
set(LITTLEFS_STAGE_SCRIPT "${CMAKE_CURRENT_LIST_DIR}/cmake/stage_littlefs.cmake")

if(NOT EXISTS "${RT_RESOURCES_DIR}/audios/audios.json")
    message(FATAL_ERROR
        "RT_RESOURCES_DIR=${RT_RESOURCES_DIR} has no audios/audios.json - point "
        "it at the monorepo's `resources` directory:\n"
        "  idf.py build -D RT_RESOURCES_DIR=/path/to/resources")
endif()

# What the staging step reads. CONFIGURE_DEPENDS so a file added to or removed
# from either tree re-runs CMake and lands in the list; the list itself is what
# makes an edited file re-stage on a warm tree.
file(GLOB RT_STAGE_INPUTS CONFIGURE_DEPENDS
     "${RT_RESOURCES_DIR}/audios/files/*.wav"
     "${RT_RESOURCES_DIR}/programs/files/*.json")
list(APPEND RT_STAGE_INPUTS "${RT_RESOURCES_DIR}/audios/audios.json")

# The built frontend, if one is supplied. Not staged from source: `webapp/dist`
# is a build product that needs npm/Vite to produce, so it exists only after
# `npm run build` in webapp/. Override to bundle a dist built elsewhere:
#
#   idf.py build -D RT_WEBAPP_DIR=/path/to/webapp/dist
#
# Without a built webapp the device serves the API only and `GET /` returns 404,
# so the default is allowed to be absent - but a directory asked for explicitly
# is still a hard error if it is not a dist, as it always was.
set(RT_WEBAPP_DIR_DEFAULT "${CMAKE_CURRENT_LIST_DIR}/../webapp/dist")
set(RT_WEBAPP_DIR "${RT_WEBAPP_DIR_DEFAULT}" CACHE PATH
    "Directory holding the built webapp (a Vite `dist`), or empty for API only")

set(RT_WEBAPP_STAGE_DIR "${RT_WEBAPP_DIR}")
if("${RT_WEBAPP_DIR}" STREQUAL "${RT_WEBAPP_DIR_DEFAULT}" AND NOT EXISTS "${RT_WEBAPP_DIR}")
    set(RT_WEBAPP_STAGE_DIR "")
endif()

if(RT_WEBAPP_STAGE_DIR)
    if(NOT EXISTS "${RT_WEBAPP_DIR}/index.html")
        message(FATAL_ERROR "RT_WEBAPP_DIR=${RT_WEBAPP_DIR} has no index.html - "
                            "point it at the frontend's built `dist` directory")
    endif()
    file(GLOB_RECURSE RT_WEBAPP_INPUTS CONFIGURE_DEPENDS "${RT_WEBAPP_STAGE_DIR}/*")
else()
    message(STATUS "No webapp at ${RT_WEBAPP_DIR} - building without one (API only)")
endif()

# Same reasoning, one step earlier: a warm tree does not reconfigure when
# `webapp/src` changes either, so the staleness check has to run every build.
# Without it a firmware build after a webapp change silently ships the previous
# bundle, and the flash verifies (issue #139).
set(RT_ALLOW_STALE_WEBAPP OFF CACHE BOOL
    "Skip the webapp/dist freshness check (iterating on firmware only)")

if(RT_WEBAPP_STAGE_DIR AND NOT RT_ALLOW_STALE_WEBAPP)
    add_custom_target(rt_webapp_fresh ALL
        COMMAND "${CMAKE_COMMAND}"
                -D "RT_WEBAPP_DIR=${RT_WEBAPP_STAGE_DIR}"
                -D "RT_WEBAPP_SRC=${CMAKE_CURRENT_LIST_DIR}/../webapp"
                -P "${CMAKE_CURRENT_LIST_DIR}/cmake/check_webapp_fresh.cmake"
        COMMENT "Checking webapp/dist is not older than webapp/src"
        VERBATIM)
endif()

# Staging is a build-time step, not a configure-time one: `idf.py build` on a
# warm tree does not reconfigure because `webapp/dist` was rebuilt, so copying
# here at configure time shipped the *previous* bundle (issue #39).
add_custom_command(
    OUTPUT "${LITTLEFS_STAGE_STAMP}"
    COMMAND "${CMAKE_COMMAND}"
            -D "RT_RESOURCES_DIR=${RT_RESOURCES_DIR}"
            -D "LITTLEFS_STAGE=${LITTLEFS_STAGE}"
            -P "${LITTLEFS_STAGE_SCRIPT}"
    COMMAND "${CMAKE_COMMAND}" -E touch "${LITTLEFS_STAGE_STAMP}"
    DEPENDS ${RT_STAGE_INPUTS} "${LITTLEFS_STAGE_SCRIPT}"
    COMMENT "Staging the LittleFS image contents"
    VERBATIM)

add_custom_target(rt_littlefs_stage DEPENDS "${LITTLEFS_STAGE_STAMP}")

# The image target always re-runs (the component cannot watch the base dir), so
# the stamp is only ordering: stage first, then pack what staging produced.
littlefs_create_partition_image(storage "${LITTLEFS_STAGE}" FLASH_IN_PROJECT
                               DEPENDS "${LITTLEFS_STAGE_STAMP}")

# Declared here rather than in main/CMakeLists.txt because RT_WEBAPP_DIR and
# RT_RESOURCES_DIR are settled above, and components are registered inside
# project() - before any of it exists.
set(RT_BUILD_INFO_ARGS
    -D "RT_REPO_DIR=${CMAKE_CURRENT_LIST_DIR}"
    -D "RT_VERSION=${PROJECT_VER}"
    -D "RT_IDF_VERSION=${RT_IDF_VER}"
    -D "RT_WEBAPP_DIR=${RT_WEBAPP_STAGE_DIR}"
    -D "RT_RESOURCES_DIR=${RT_RESOURCES_DIR}"
    -D "RT_OUTPUT=${RT_BUILD_INFO_HEADER}")

# Once at configure time so the header exists before anything tries to include
# it, and again on every build so it stays true.
execute_process(COMMAND "${CMAKE_COMMAND}" ${RT_BUILD_INFO_ARGS} -P "${RT_BUILD_INFO_SCRIPT}")

add_custom_target(rt_build_info ALL
    COMMAND "${CMAKE_COMMAND}" ${RT_BUILD_INFO_ARGS} -P "${RT_BUILD_INFO_SCRIPT}"
    BYPRODUCTS "${RT_BUILD_INFO_HEADER}"
    COMMENT "Recording what produced this image"
    VERBATIM)

# --- the web app, inside the app image (#227) -------------------------------
#
# It used to be staged into the LittleFS `storage` partition, which an OTA does
# not write - so a firmware update over the air shipped new firmware against the
# *old* bundle, and only a cable could bring the two back into step. Here it is
# part of the application, so one OTA updates both and the A/B rollback the app
# slots already provide covers the web app for free.
#
# tools/pack_assets.py concatenates the tree into one blob and emits the index
# main/storage/embedded_fs.cpp reads. It also does the gzipping the staging
# script used to shell out to `gzip` for, which is why there is no gzip
# prerequisite any more - and why the same input now produces the same bytes on
# every machine, which `content.webapp.sha256` depends on.
set(RT_EMBEDDED_DIR "${CMAKE_BINARY_DIR}/embedded")
set(RT_EMBEDDED_BLOB "${RT_EMBEDDED_DIR}/embedded.bin")
set(RT_EMBEDDED_INDEX "${CMAKE_BINARY_DIR}/generated/embedded_index.generated.h")
set(RT_PACK_SCRIPT "${CMAKE_CURRENT_LIST_DIR}/tools/pack_assets.py")
file(MAKE_DIRECTORY "${RT_EMBEDDED_DIR}" "${CMAKE_BINARY_DIR}/generated")

idf_build_get_property(RT_PYTHON PYTHON)

set(RT_PACK_ARGS "${RT_EMBEDDED_BLOB}" "${RT_EMBEDDED_INDEX}")
if(RT_WEBAPP_STAGE_DIR)
    list(APPEND RT_PACK_ARGS "webapp=${RT_WEBAPP_STAGE_DIR}")
endif()

# Once at configure time so the blob and the index exist before anything tries
# to assemble or include them, and again on every build so they stay true - the
# because `idf.py build` on a warm tree does not reconfigure just because
# `webapp/dist` was rebuilt - which is issue #39, one layer up.
execute_process(COMMAND "${RT_PYTHON}" "${RT_PACK_SCRIPT}" ${RT_PACK_ARGS}
                RESULT_VARIABLE RT_PACK_RESULT)
if(NOT RT_PACK_RESULT EQUAL 0)
    message(FATAL_ERROR "tools/pack_assets.py failed")
endif()

add_custom_target(rt_pack_assets ALL
    COMMAND "${RT_PYTHON}" "${RT_PACK_SCRIPT}" ${RT_PACK_ARGS}
    BYPRODUCTS "${RT_EMBEDDED_BLOB}" "${RT_EMBEDDED_INDEX}"
    COMMENT "Packing the embedded web app into the app image"
    VERBATIM)
if(TARGET rt_webapp_fresh)
    # Ordering only: fail before the packer embeds a stale bundle, not after.
    add_dependencies(rt_pack_assets rt_webapp_fresh)
endif()

set(RT_EMBEDDED_ASM "${RT_EMBEDDED_DIR}/embedded_blob.S")
configure_file("${CMAKE_CURRENT_LIST_DIR}/main/storage/embedded_blob.S.in"
               "${RT_EMBEDDED_ASM}" @ONLY)

# `.incbin` reads the blob at assembly time and nothing tracks that as a
# dependency, so without this a rebuilt web app would assemble the *previous*
# blob - the same failure #39 was, one layer down.
set_source_files_properties("${RT_EMBEDDED_ASM}" PROPERTIES OBJECT_DEPENDS "${RT_EMBEDDED_BLOB}")

# Attached here rather than in main/CMakeLists.txt: components are registered
# inside project(), before RT_WEBAPP_DIR and everything derived from it exists.

# One stanza for both generated things. `main` is registered inside project(),
# so this cannot live in main/CMakeLists.txt - RT_WEBAPP_DIR and everything
# derived from it does not exist yet at that point.
#
# The two generated headers share ${RT_BUILD_INFO_DIR}, so one include
# directory covers build_info.generated.h and embedded_index.generated.h alike.
idf_component_get_property(RT_MAIN_LIB main COMPONENT_LIB)
target_sources(${RT_MAIN_LIB} PRIVATE "${RT_EMBEDDED_ASM}")
target_include_directories(${RT_MAIN_LIB} PRIVATE "${RT_BUILD_INFO_DIR}")
add_dependencies(${RT_MAIN_LIB} rt_build_info rt_pack_assets)
