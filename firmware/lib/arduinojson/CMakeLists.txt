# Vendored ArduinoJson v7.4.3 (MIT), the single-header amalgamation release.
#
# Vendored rather than pulled from the component registry so that host_test/
# builds the same parser the firmware does without needing the IDF Component
# Manager (it is plain CMake + CTest, not an idf.py app). Registering under the
# component name `arduinojson` also satisfies lib/psychic_http's REQUIRES.
idf_component_register(
    INCLUDE_DIRS "."
)
