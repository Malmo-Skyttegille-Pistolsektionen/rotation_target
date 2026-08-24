#include "expert_password.h"

namespace rt {
namespace {

// -1 for the terminating NUL the string literal carries.
constexpr size_t kAlphabetSize = sizeof(kExpertPasswordAlphabet) - 1;

}  // namespace

std::string make_expert_password(RandomBytesFn random_bytes) {
  uint8_t raw[kExpertPasswordGroups * kExpertPasswordGroupLen];
  random_bytes(raw, sizeof(raw));

  std::string out;
  out.reserve(kExpertPasswordLength);
  for (size_t i = 0; i < sizeof(raw); i++) {
    if (i > 0 && i % kExpertPasswordGroupLen == 0) out.push_back('-');
    out.push_back(kExpertPasswordAlphabet[raw[i] % kAlphabetSize]);
  }
  return out;
}

bool is_well_formed_expert_password(const std::string &password) {
  if (password.size() != kExpertPasswordLength) return false;

  for (size_t i = 0; i < password.size(); i++) {
    // Positions 4, 9, 14 for the default shape: every group length plus the
    // hyphens already placed.
    const bool separator = (i + 1) % (kExpertPasswordGroupLen + 1) == 0;
    if (separator) {
      if (password[i] != '-') return false;
      continue;
    }

    bool in_alphabet = false;
    for (size_t j = 0; j < kAlphabetSize; j++) {
      if (password[i] == kExpertPasswordAlphabet[j]) {
        in_alphabet = true;
        break;
      }
    }
    if (!in_alphabet) return false;
  }
  return true;
}

}  // namespace rt
