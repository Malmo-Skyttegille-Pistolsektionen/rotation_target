#include "console_command.h"

#include <algorithm>
#include <cctype>

namespace rt::console {
namespace {

char lower(char c) {
  return static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
}

bool is_space(char c) {
  return std::isspace(static_cast<unsigned char>(c)) != 0;
}

std::string_view trim(std::string_view text) {
  while (!text.empty() && is_space(text.front())) text.remove_prefix(1);
  while (!text.empty() && is_space(text.back())) text.remove_suffix(1);
  return text;
}

// Everything after the first word, trimmed. Empty when there is nothing.
std::string_view tail(std::string_view text) {
  text = trim(text);
  const size_t end = text.find_first_of(" \t");
  return end == std::string_view::npos ? std::string_view{} : trim(text.substr(end));
}

std::string_view head(std::string_view text) {
  text = trim(text);
  const size_t end = text.find_first_of(" \t");
  return end == std::string_view::npos ? text : text.substr(0, end);
}

bool equals_ignoring_case(std::string_view a, std::string_view b) {
  return a.size() == b.size() && std::equal(a.begin(), a.end(), b.begin(),
                                            [](char x, char y) { return lower(x) == lower(y); });
}

}  // namespace

Command parse_command(std::string_view line) {
  const std::string_view word = head(line);
  if (word.empty()) return Command::kNone;
  if (equals_ignoring_case(word, "status")) return Command::kStatus;
  if (equals_ignoring_case(word, "help") || equals_ignoring_case(word, "?")) return Command::kHelp;
  if (equals_ignoring_case(word, "boot-targets")) return Command::kBootTargets;
  if (equals_ignoring_case(word, "wifi-scan")) return Command::kWifiScan;
  if (equals_ignoring_case(word, "wifi-info")) return Command::kWifiInfo;
  return Command::kUnknown;
}

BootTargets parse_boot_targets(std::string_view line) {
  const std::string_view argument = tail(line);
  if (argument.empty()) return BootTargets::kMissing;
  if (equals_ignoring_case(argument, "shown")) return BootTargets::kShown;
  if (equals_ignoring_case(argument, "hidden")) return BootTargets::kHidden;
  return BootTargets::kInvalid;
}

std::string first_word(std::string_view line) {
  return std::string(head(line));
}

}  // namespace rt::console
