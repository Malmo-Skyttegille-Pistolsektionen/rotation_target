# Refuses a build whose `webapp/dist` is older than the webapp source it came
# from. Run as a script (`cmake -P`) at build time, not configure time: a warm
# tree does not reconfigure when `webapp/dist` changes, which is the same reason
# staging moved to build time (issue #39).
#
# Expects RT_WEBAPP_DIR (the dist) and RT_WEBAPP_SRC (the webapp source root).

if(NOT RT_WEBAPP_DIR OR NOT EXISTS "${RT_WEBAPP_DIR}/index.html")
    return()  # API-only build; nothing to be stale
endif()

if(NOT IS_DIRECTORY "${RT_WEBAPP_SRC}/src")
    return()  # a dist built elsewhere, with no source tree to compare against
endif()

file(GLOB_RECURSE _sources
     "${RT_WEBAPP_SRC}/src/*"
     "${RT_WEBAPP_SRC}/public/*")
list(APPEND _sources
     "${RT_WEBAPP_SRC}/index.html"
     "${RT_WEBAPP_SRC}/package.json"
     "${RT_WEBAPP_SRC}/vite.config.ts")

set(_newer "")
foreach(_src IN LISTS _sources)
    if(EXISTS "${_src}" AND "${_src}" IS_NEWER_THAN "${RT_WEBAPP_DIR}/index.html")
        file(RELATIVE_PATH _rel "${RT_WEBAPP_SRC}" "${_src}")
        list(APPEND _newer "${_rel}")
    endif()
endforeach()

if(NOT _newer)
    return()
endif()

list(LENGTH _newer _count)
list(SORT _newer)
list(SUBLIST _newer 0 5 _shown)
string(REPLACE ";" "\n    " _shown "${_shown}")
if(_count GREATER 5)
    math(EXPR _rest "${_count} - 5")
    set(_shown "${_shown}\n    ... and ${_rest} more")
endif()

message(FATAL_ERROR
    "webapp/dist is older than the webapp source, so this image would ship the "
    "previous bundle.\n"
    "The firmware build stages whatever dist holds; it does not rebuild it. A "
    "stale bundle flashes and verifies cleanly, and the device then looks like "
    "it ignored the change.\n\n"
    "  Newer than dist/index.html:\n    ${_shown}\n\n"
    "  Fix:      cd webapp && npm run build\n"
    "  Override: idf.py build -D RT_ALLOW_STALE_WEBAPP=ON  (iterating on "
    "firmware only)\n")
