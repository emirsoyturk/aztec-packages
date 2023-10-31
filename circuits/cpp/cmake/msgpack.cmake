include(ExternalProject)

# External project: Download msgpack-c from GitHu
set(MSGPACK_PREFIX "${CMAKE_BINARY_DIR}/_deps/msgpack-c")
set(MSGPACK_INCLUDE "${MSGPACK_PREFIX}/src/msgpack-c/include")

ExternalProject_Add(
    msgpack-c
    PREFIX ${MSGPACK_PREFIX}
    GIT_REPOSITORY "https://github.com/AztecProtocol/msgpack-c.git"
    GIT_TAG af447c28f0bafe761290a72754212436e530941b
    CONFIGURE_COMMAND ""  # No configure step
    BUILD_COMMAND ""      # No build step
    INSTALL_COMMAND ""    # No install step
    UPDATE_COMMAND ""     # No update step
)