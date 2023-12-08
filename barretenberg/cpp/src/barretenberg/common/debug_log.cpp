#include "debug_log.hpp"
#include <cstdlib>

void _debug_log_check_abort_condition(const std::string& log_str)
{
    const char* abort_cond = std::getenv("DEBUG_LOG_ABORT");
    if (abort_cond != nullptr && log_str.find("operator") != std::string::npos) {
        throw std::runtime_error("Abort condition met: " + log_str);
    }
}