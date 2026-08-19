cmake_minimum_required(VERSION 3.16)

set(EXTRA_COMPONENT_DIRS "${CMAKE_CURRENT_LIST_DIR}/lib")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)

project(rotation_target_backend)

# The shipped programs and audio come from the resources repository, checked out
# as the `resources/` submodule, and are flashed as a LittleFS image. They are
# staged into one tree first because the on-device layout is not the one the
# resources repo uses: `shipped/` is what the firmware treats as read-only, and
# `uploads/` is the writable half the REST API adds to (created on first use).
set(LITTLEFS_STAGE "${CMAKE_BINARY_DIR}/littlefs_stage")

if(NOT EXISTS "${CMAKE_CURRENT_LIST_DIR}/resources/audios/audios.json")
    message(FATAL_ERROR
        "resources/ is empty - the shipped audio and programs live in the "
        "rotation_target_backend_resources submodule. Run:\n"
        "  git submodule update --init --recursive")
endif()

file(REMOVE_RECURSE "${LITTLEFS_STAGE}")
file(MAKE_DIRECTORY "${LITTLEFS_STAGE}/shipped/audio" "${LITTLEFS_STAGE}/shipped/programs")
file(COPY "${CMAKE_CURRENT_LIST_DIR}/resources/audios/audios.json"
     DESTINATION "${LITTLEFS_STAGE}/shipped/audio")
file(GLOB SHIPPED_WAVS CONFIGURE_DEPENDS "${CMAKE_CURRENT_LIST_DIR}/resources/audios/files/*.wav")
file(COPY ${SHIPPED_WAVS} DESTINATION "${LITTLEFS_STAGE}/shipped/audio")
file(GLOB SHIPPED_PROGRAMS CONFIGURE_DEPENDS "${CMAKE_CURRENT_LIST_DIR}/resources/programs/files/*.json")
file(COPY ${SHIPPED_PROGRAMS} DESTINATION "${LITTLEFS_STAGE}/shipped/programs")

littlefs_create_partition_image(storage "${LITTLEFS_STAGE}" FLASH_IN_PROJECT)
