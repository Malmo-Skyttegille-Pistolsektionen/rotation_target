# ============================================================================
#  firmware/cmake/stage_littlefs.cmake
#  Builds the tree that becomes the LittleFS `storage` image.
#
#  Run at BUILD time (`cmake -P`) from firmware/CMakeLists.txt, not at configure
#  time: `idf.py build` does not reconfigure because a file outside the project
#  changed, so a configure-time copy left a warm build tree serving whatever
#  webapp it was configured with.
#
#  The web app is NOT here: it is embedded in the app image instead (#227), so
#  that an OTA updates it. See tools/pack_assets.py.
#
#  Inputs (-D): RT_RESOURCES_DIR, LITTLEFS_STAGE.
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
