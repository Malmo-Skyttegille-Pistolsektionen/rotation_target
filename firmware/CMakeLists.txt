cmake_minimum_required(VERSION 3.16)

set(EXTRA_COMPONENT_DIRS "${CMAKE_CURRENT_LIST_DIR}/lib")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)

project(rotation_target_backend)

# The shipped programs and audio come from the monorepo's `resources/` tree and
# are flashed as a LittleFS image. They are staged into one tree first because
# the on-device layout is not the one resources/ uses: `shipped/` is what the
# firmware treats as read-only, and `uploads/` is the writable half the REST API
# adds to (created on first use).
set(RT_RESOURCES_DIR "${CMAKE_CURRENT_LIST_DIR}/../resources" CACHE PATH
    "Directory holding the shipped audio and programs (audios/, programs/)")

set(LITTLEFS_STAGE "${CMAKE_BINARY_DIR}/littlefs_stage")

if(NOT EXISTS "${RT_RESOURCES_DIR}/audios/audios.json")
    message(FATAL_ERROR
        "RT_RESOURCES_DIR=${RT_RESOURCES_DIR} has no audios/audios.json - point "
        "it at the monorepo's `resources` directory:\n"
        "  idf.py build -D RT_RESOURCES_DIR=/path/to/resources")
endif()

file(REMOVE_RECURSE "${LITTLEFS_STAGE}")
file(MAKE_DIRECTORY "${LITTLEFS_STAGE}/shipped/audio" "${LITTLEFS_STAGE}/shipped/programs")
file(COPY "${RT_RESOURCES_DIR}/audios/audios.json"
     DESTINATION "${LITTLEFS_STAGE}/shipped/audio")
file(GLOB SHIPPED_WAVS CONFIGURE_DEPENDS "${RT_RESOURCES_DIR}/audios/files/*.wav")
file(COPY ${SHIPPED_WAVS} DESTINATION "${LITTLEFS_STAGE}/shipped/audio")
file(GLOB SHIPPED_PROGRAMS CONFIGURE_DEPENDS "${RT_RESOURCES_DIR}/programs/files/*.json")
file(COPY ${SHIPPED_PROGRAMS} DESTINATION "${LITTLEFS_STAGE}/shipped/programs")

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
    file(MAKE_DIRECTORY "${LITTLEFS_STAGE}/webapp")
    file(COPY "${RT_WEBAPP_DIR}/" DESTINATION "${LITTLEFS_STAGE}/webapp")
    message(STATUS "Bundling webapp from ${RT_WEBAPP_DIR}")

    # Pre-compress the text assets and ship only the .gz.
    #
    # The device has no CPU to spare compressing on the fly, and the vendored
    # static handler already falls back to `<path>.gz` and sets
    # Content-Encoding: gzip (lib/psychic_http/src/PsychicStaticFileHander.cpp).
    # The bundle is the whole cost of a page load over 2.4 GHz WiFi - measured
    # at roughly 400 KB on the critical path, which took double-digit seconds on
    # a phone - and it compresses about four-fold. It also frees flash.
    #
    # Images are skipped: PNG/ICO/WOFF are already compressed, so gzip would
    # add a few percent and cost CPU to undo.
    find_program(GZIP_EXECUTABLE gzip)
    if(GZIP_EXECUTABLE)
        file(GLOB_RECURSE WEBAPP_TEXT_FILES
             "${LITTLEFS_STAGE}/webapp/*.js"  "${LITTLEFS_STAGE}/webapp/*.css"
             "${LITTLEFS_STAGE}/webapp/*.html" "${LITTLEFS_STAGE}/webapp/*.json"
             "${LITTLEFS_STAGE}/webapp/*.svg" "${LITTLEFS_STAGE}/webapp/*.map")
        foreach(TEXT_FILE ${WEBAPP_TEXT_FILES})
            # -9 because this runs once at build time and the device pays the
            # transfer cost on every single page load.
            execute_process(COMMAND "${GZIP_EXECUTABLE}" -9 -f "${TEXT_FILE}"
                            RESULT_VARIABLE GZIP_RESULT)
            if(NOT GZIP_RESULT EQUAL 0)
                message(FATAL_ERROR "Failed to gzip ${TEXT_FILE}")
            endif()
        endforeach()
        list(LENGTH WEBAPP_TEXT_FILES WEBAPP_TEXT_COUNT)
        message(STATUS "Pre-compressed ${WEBAPP_TEXT_COUNT} webapp asset(s) to .gz")
    else()
        # Not fatal - the device still serves the uncompressed files correctly,
        # just slowly.
        message(WARNING "gzip not found - webapp assets will be served uncompressed")
    endif()
else()
    message(STATUS "No webapp at ${RT_WEBAPP_DIR} - building without one (API only)")
endif()

littlefs_create_partition_image(storage "${LITTLEFS_STAGE}" FLASH_IN_PROJECT)
