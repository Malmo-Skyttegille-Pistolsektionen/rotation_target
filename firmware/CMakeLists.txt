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
    list(APPEND RT_STAGE_INPUTS ${RT_WEBAPP_INPUTS})
    # Not fatal - the device still serves the uncompressed files correctly, just
    # slowly. See cmake/stage_littlefs.cmake for what the compression buys.
    find_program(GZIP_EXECUTABLE gzip)
    if(NOT GZIP_EXECUTABLE)
        message(WARNING "gzip not found - webapp assets will be served uncompressed")
    endif()
else()
    message(STATUS "No webapp at ${RT_WEBAPP_DIR} - building without one (API only)")
endif()

# Staging is a build-time step, not a configure-time one: `idf.py build` on a
# warm tree does not reconfigure because `webapp/dist` was rebuilt, so copying
# here at configure time shipped the *previous* bundle (issue #39).
add_custom_command(
    OUTPUT "${LITTLEFS_STAGE_STAMP}"
    COMMAND "${CMAKE_COMMAND}"
            -D "RT_RESOURCES_DIR=${RT_RESOURCES_DIR}"
            -D "RT_WEBAPP_DIR=${RT_WEBAPP_STAGE_DIR}"
            -D "LITTLEFS_STAGE=${LITTLEFS_STAGE}"
            -D "GZIP_EXECUTABLE=${GZIP_EXECUTABLE}"
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
