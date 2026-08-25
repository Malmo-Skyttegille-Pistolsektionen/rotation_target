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
#  Inputs (-D): RT_RESOURCES_DIR, LITTLEFS_STAGE, RT_PYTHON, RT_ADPCM_SCRIPT.
# ============================================================================
cmake_minimum_required(VERSION 3.16)

# Rebuilt from scratch so a file deleted from `dist` or `resources` also
# disappears from the image.
file(REMOVE_RECURSE "${LITTLEFS_STAGE}")
file(MAKE_DIRECTORY "${LITTLEFS_STAGE}/shipped/audio" "${LITTLEFS_STAGE}/shipped/programs")

file(COPY "${RT_RESOURCES_DIR}/audios/audios.json"
     DESTINATION "${LITTLEFS_STAGE}/shipped/audio")

# The shipped clips are transcoded to IMA ADPCM rather than copied: 3.9x
# smaller on the measured corpus (7.63 MB -> 1.96 MB), which is what lets them
# share an image with the firmware and the web app (#227). Still `.wav`, still
# named by id, so audios.json needs no idea this happened - IMA ADPCM is a
# wFormatTag, not a container.
#
# The transcode is in the build and not a committed artifact, so `idf.py build`
# is the only entry point and CI has no separate path to drift from. The
# sources stay in resources/ as PCM, so it is all regenerable.
file(GLOB SHIPPED_WAVS "${RT_RESOURCES_DIR}/audios/files/*.wav")
execute_process(
    COMMAND "${RT_PYTHON}" "${RT_ADPCM_SCRIPT}" "${LITTLEFS_STAGE}/shipped/audio" ${SHIPPED_WAVS}
    RESULT_VARIABLE ADPCM_RESULT)
if(NOT ADPCM_RESULT EQUAL 0)
    message(FATAL_ERROR "tools/wav_to_adpcm.py failed")
endif()
file(GLOB SHIPPED_PROGRAMS "${RT_RESOURCES_DIR}/programs/files/*.json")
file(COPY ${SHIPPED_PROGRAMS} DESTINATION "${LITTLEFS_STAGE}/shipped/programs")
