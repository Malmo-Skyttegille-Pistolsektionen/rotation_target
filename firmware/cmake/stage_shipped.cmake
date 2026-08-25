# ============================================================================
#  firmware/cmake/stage_shipped.cmake
#  Builds the shipped audio and program tree that goes into the app image.
#
#  Run at BUILD time (`cmake -P`) from firmware/CMakeLists.txt, not at configure
#  time: `idf.py build` does not reconfigure because a file outside the project
#  changed, so a configure-time copy left a warm build tree carrying whatever
#  it was configured with (issue #39).
#
#  The output is not a filesystem image any more. tools/pack_assets.py packs
#  this tree, the web app and their index into the application binary (#227),
#  so an OTA updates all of it and no update path can reach the `userdata`
#  partition where uploads live.
#
#  Inputs (-D): RT_RESOURCES_DIR, RT_SHIPPED_STAGE, RT_PYTHON, RT_ADPCM_SCRIPT.
# ============================================================================
cmake_minimum_required(VERSION 3.16)

# Rebuilt from scratch so a file deleted from `resources` also disappears from
# the image.
file(REMOVE_RECURSE "${RT_SHIPPED_STAGE}")
file(MAKE_DIRECTORY "${RT_SHIPPED_STAGE}/audio" "${RT_SHIPPED_STAGE}/programs")

file(COPY "${RT_RESOURCES_DIR}/audios/audios.json" DESTINATION "${RT_SHIPPED_STAGE}/audio")

# The shipped clips are transcoded to IMA ADPCM rather than copied: 3.9x
# smaller on the measured corpus (7.63 MB -> 1.96 MB), which is what lets them
# share an image with the firmware and the web app. Still `.wav`, still named by
# id, so audios.json needs no idea this happened - IMA ADPCM is a wFormatTag,
# not a container.
#
# The transcode is in the build and not a committed artifact, so `idf.py build`
# is the only entry point and CI has no separate path to drift from. The
# sources stay in resources/ as PCM, so it is all regenerable.
file(GLOB SHIPPED_WAVS "${RT_RESOURCES_DIR}/audios/files/*.wav")
execute_process(
    COMMAND "${RT_PYTHON}" "${RT_ADPCM_SCRIPT}" "${RT_SHIPPED_STAGE}/audio" ${SHIPPED_WAVS}
    RESULT_VARIABLE ADPCM_RESULT)
if(NOT ADPCM_RESULT EQUAL 0)
    message(FATAL_ERROR "tools/wav_to_adpcm.py failed")
endif()

file(GLOB SHIPPED_PROGRAMS "${RT_RESOURCES_DIR}/programs/files/*.json")
file(COPY ${SHIPPED_PROGRAMS} DESTINATION "${RT_SHIPPED_STAGE}/programs")
