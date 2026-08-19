// ============================================================================
//  rt_logic/admin_mode.h
//  In-memory admin mode - host-testable.
//  Ported from src/backend/repositories/admin_mode.py.
// ============================================================================
#pragma once

#include <cstddef>
#include <cstdint>
#include <set>
#include <string>

namespace rt {

constexpr size_t kTokenBytes = 16;

// Fills `out` with `kTokenBytes` cryptographically random bytes. The firmware
// backs this with esp_fill_random(); host tests substitute a counter, since
// what the tests assert is token *distinctness* and lifecycle, not entropy.
using RandomBytesFn = void (*)(uint8_t *out, size_t len);

// Admin mode is off until a client enables it with a password of its choosing;
// while it is on, mutating endpoints require a session token. Nothing is
// persisted, so a reboot returns the device to the unprotected state -
// deliberate parity with the frontend mock contract, documented in
// docs/api-v2.md.
class AdminMode {
 public:
  explicit AdminMode(RandomBytesFn random_bytes) : random_bytes_(random_bytes) {}

  bool enabled() const { return has_password_; }

  // Turn admin mode on and return a session token, or empty if refused
  // (already on, or an empty password).
  std::string enable(const std::string &password) {
    if (enabled() || password.empty()) return {};
    password_ = password;
    has_password_ = true;
    return issue_token();
  }

  // Return a session token for the active password, or empty if refused.
  std::string login(const std::string &password) {
    if (!enabled() || password != password_) return {};
    return issue_token();
  }

  void disable() {
    password_.clear();
    has_password_ = false;
    tokens_.clear();
  }

  // Whether a request carrying these credentials may call a protected
  // endpoint. While admin mode is off everything is allowed - the endpoints
  // are only protected once a client turns protection on.
  bool authorize(const std::string &authorization_header, const std::string &admin_cookie) const {
    if (!enabled()) return true;

    constexpr const char *kBearer = "Bearer ";
    constexpr size_t kBearerLen = 7;
    if (authorization_header.compare(0, kBearerLen, kBearer) == 0 &&
        is_valid_token(authorization_header.substr(kBearerLen))) {
      return true;
    }
    return is_valid_token(admin_cookie);
  }

  bool is_valid_token(const std::string &token) const {
    return !token.empty() && tokens_.count(token) > 0;
  }

 private:
  std::string issue_token() {
    uint8_t raw[kTokenBytes];
    random_bytes_(raw, sizeof(raw));

    static const char *kHex = "0123456789abcdef";
    std::string token;
    token.reserve(kTokenBytes * 2);
    for (uint8_t b : raw) {
      token += kHex[b >> 4];
      token += kHex[b & 0x0f];
    }
    tokens_.insert(token);
    return token;
  }

  RandomBytesFn random_bytes_;
  std::string password_;
  bool has_password_ = false;
  std::set<std::string> tokens_;
};

}  // namespace rt
