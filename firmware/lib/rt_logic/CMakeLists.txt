# Hardware-independent logic: the program model, the run-position maths, the
# stateUpdate serializer, admin mode and the run state machine. Shared by the
# firmware (main/, via EXTRA_COMPONENT_DIRS) and by host_test/ (plain CMake host
# tests) - same sources, same tested code, two build systems.
idf_component_register(
    SRCS "program.cpp" "executor.cpp" "wav_header.cpp" "console_command.cpp" "hardware_config.cpp" "version.cpp"
    INCLUDE_DIRS "."
    REQUIRES arduinojson
)
