# ============================================================================
#  firmware/cmake/stage_littlefs.cmake
#  Builds the tree that becomes the LittleFS `storage` image.
#
#  Run at BUILD time (`cmake -P`) from firmware/CMakeLists.txt, not at configure
#  time: `idf.py build` does not reconfigure because a file outside the project
#  changed, so a configure-time copy left a warm build tree serving whatever
#  webapp it was configured with.
#
#  Inputs (-D): RT_RESOURCES_DIR, RT_WEBAPP_DIR (empty for an API-only build),
#  LITTLEFS_STAGE, GZIP_EXECUTABLE (empty if gzip was not found).
# ============================================================================
cmake_minimum_required(VERSION 3.16)

# Rebuilt from scratch so a file deleted from `dist` or `resources` also
# disappears from the image.
file(REMOVE_RECURSE "${LITTLEFS_STAGE}")
file(MAKE_DIRECTORY "${LITTLEFS_STAGE}/shipped/audio" "${LITTLEFS_STAGE}/shipped/programs")

file(COPY "${RT_RESOURCES_DIR}/audios/audios.json"
     DESTINATION "${LITTLEFS_STAGE}/shipped/audio")
file(GLOB SHIPPED_WAVS "${RT_RESOURCES_DIR}/audios/files/*.wav")
file(COPY ${SHIPPED_WAVS} DESTINATION "${LITTLEFS_STAGE}/shipped/audio")
file(GLOB SHIPPED_PROGRAMS "${RT_RESOURCES_DIR}/programs/files/*.json")
file(COPY ${SHIPPED_PROGRAMS} DESTINATION "${LITTLEFS_STAGE}/shipped/programs")

if(NOT RT_WEBAPP_DIR)
    return()
endif()

file(MAKE_DIRECTORY "${LITTLEFS_STAGE}/webapp")
file(COPY "${RT_WEBAPP_DIR}/" DESTINATION "${LITTLEFS_STAGE}/webapp")
message(STATUS "Bundling webapp from ${RT_WEBAPP_DIR}")

# Pre-compress the text assets and ship only the .gz.
#
# The device has no CPU to spare compressing on the fly, and the vendored static
# handler already falls back to `<path>.gz` and sets Content-Encoding: gzip
# (lib/psychic_http/src/PsychicStaticFileHander.cpp). The bundle is the whole
# cost of a page load over 2.4 GHz WiFi - measured at roughly 400 KB on the
# critical path, which took double-digit seconds on a phone - and it compresses
# about four-fold. It also frees flash.
#
# Images are skipped: PNG/ICO/WOFF are already compressed, so gzip would add a
# few percent and cost CPU to undo.
if(NOT GZIP_EXECUTABLE)
    return()
endif()

file(GLOB_RECURSE WEBAPP_TEXT_FILES
     "${LITTLEFS_STAGE}/webapp/*.js"   "${LITTLEFS_STAGE}/webapp/*.css"
     "${LITTLEFS_STAGE}/webapp/*.html" "${LITTLEFS_STAGE}/webapp/*.json"
     "${LITTLEFS_STAGE}/webapp/*.svg"  "${LITTLEFS_STAGE}/webapp/*.map")
foreach(TEXT_FILE ${WEBAPP_TEXT_FILES})
    # -9 because this runs once at build time and the device pays the transfer
    # cost on every single page load.
    execute_process(COMMAND "${GZIP_EXECUTABLE}" -9 -f "${TEXT_FILE}"
                    RESULT_VARIABLE GZIP_RESULT)
    if(NOT GZIP_RESULT EQUAL 0)
        message(FATAL_ERROR "Failed to gzip ${TEXT_FILE}")
    endif()
endforeach()
list(LENGTH WEBAPP_TEXT_FILES WEBAPP_TEXT_COUNT)
message(STATUS "Pre-compressed ${WEBAPP_TEXT_COUNT} webapp asset(s) to .gz")
