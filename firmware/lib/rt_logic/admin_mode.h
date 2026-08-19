// ============================================================================
//  rt_logic/admin_mode.h
//  In-memory admin mode - host-testable.
//  Ported from src/backend/repositories/admin_mode.py.
// ============================================================================
#pragma once

#include <cstddef>
#include <cstdint>
#include <deque>
#include <string>

namespace rt {

constexpr size_t kTokenBytes = 16;

// Fills `out` with `kTokenBytes` cryptographically random bytes. The firmware
// backs this with esp_fill_random(); host tests substitute a counter, since
// what the tests assert is token *distinctness* and lifecycle, not entropy.
using RandomBytesFn = void (*)(uint8_t *out, size_t len);

// Monotonic milliseconds, for token expiry. Injected for the same reason the
// executor's clock is: so the host tests can age a token out without sleeping.
using NowMsFn = int64_t (*)();

// A session lasts a shooting session, not a boot. Without this a token
// captured from the non-HttpOnly cookie stayed valid for the device's entire
// uptime, and the only revocation was disable() - which drops the device to
// the *unprotected* state rather than a safer one.
constexpr int64_t kTokenTtlMs = 12 * 60 * 60 * 1000;

// Concurrent sessions. A client that re-logs-in on every page load would
// otherwise grow the set for the life of the boot; oldest is evicted first.
constexpr size_t kMaxTokens = 8;

// Compares without an early exit, so the time taken does not depend on how
// many leading bytes matched. The password is the realistic target: it is
// human-chosen and /admin-mode/login can be probed without limit.
inline bool constant_time_equals(const std::string &a, const std::string &b) {
  // Length is not secret - it leaks through the response size anyway - but the
  // walk below must still be over a fixed range for the compared bytes.
  if (a.size() != b.size()) return false;

  unsigned char diff = 0;
  for (size_t i = 0; i < a.size(); i++) {
    diff |= static_cast<unsigned char>(a[i]) ^ static_cast<unsigned char>(b[i]);
  }
  return diff == 0;
}

// Admin mode is off until a client enables it with a password of its choosing;
// while it is on, mutating endpoints require a session token. Nothing is
// persisted, so a reboot returns the device to the unprotected state -
// deliberate parity with the frontend mock contract, documented in
// docs/api-v2.md.
class AdminMode {
 public:
  AdminMode(RandomBytesFn random_bytes, NowMsFn now_ms)
      : random_bytes_(random_bytes), now_ms_(now_ms) {}

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
    if (!enabled() || !constant_time_equals(password, password_)) return {};
    return issue_token();
  }

  void disable() {
    password_.clear();
    has_password_ = false;
    tokens_.clear();
  }

  // Invalidates one token without disabling admin mode - the safe half of
  // "log out", which disable() is not.
  bool logout(const std::string &token) {
    for (auto it = tokens_.begin(); it != tokens_.end(); ++it) {
      if (constant_time_equals(it->value, token)) {
        tokens_.erase(it);
        return true;
      }
    }
    return false;
  }

  // Whether a request carrying these credentials may call a protected
  // endpoint. While admin mode is off everything is allowed - the endpoints
  // are only protected once a client turns protection on.
  bool authorize(const std::string &authorization_header, const std::string &admin_cookie) const {
    if (!enabled()) return true;

    if (is_valid_token(bearer_token(authorization_header))) return true;
    return is_valid_token(admin_cookie);
  }

  // The bearer token from an `Authorization` header, or empty.
  static std::string bearer_token(const std::string &header) {
    constexpr const char *kBearer = "Bearer ";
    constexpr size_t kBearerLen = 7;
    if (header.size() <= kBearerLen) return {};
    if (header.compare(0, kBearerLen, kBearer) != 0) return {};
    return header.substr(kBearerLen);
  }

 private:
  struct Token {
    std::string value;
    int64_t issued_ms = 0;
  };

  bool is_valid_token(const std::string &token) const {
    if (token.empty()) return false;

    const int64_t now = now_ms_();
    bool found = false;
    // Every token is compared, and each comparison is constant-time: an early
    // `break` on a match would leak how far down the list the hit was.
    for (const Token &candidate : tokens_) {
      if (constant_time_equals(candidate.value, token) && now - candidate.issued_ms < kTokenTtlMs) {
        found = true;
      }
    }
    return found;
  }

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
    if (tokens_.size() >= kMaxTokens) tokens_.pop_front();
    tokens_.push_back(Token{token, now_ms_()});
    return token;
  }

  RandomBytesFn random_bytes_;
  NowMsFn now_ms_;
  std::string password_;
  bool has_password_ = false;
  std::deque<Token> tokens_;
};

}  // namespace rt
