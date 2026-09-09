// ============================================================================
//  rt_logic/target_bank.h
//  What a target bank is, and how one is addressed (#207, D-41).
//  Shared by the hardware configuration and the executor; no NVS, no ESP-IDF.
// ============================================================================
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace rt {

// One independently driven target group: one pin, one polarity, one name.
struct TargetBank {
  int32_t gpio = 0;
  // Whether a low level shows this bank. Per bank rather than per device
  // because the de-energised state of each bank's wiring is what has to be its
  // resting state (D-31, D-41).
  bool active_low = true;
  // Display only. It lives in the hardware configuration and never in a
  // program, so renaming a bank cannot re-aim one.
  std::string name;
};

inline bool operator==(const TargetBank &a, const TargetBank &b) {
  return a.gpio == b.gpio && a.active_low == b.active_low && a.name == b.name;
}
inline bool operator!=(const TargetBank &a, const TargetBank &b) {
  return !(a == b);
}

// A..H. A firmware constant rather than a contract limit; raising it later is
// additive (D-41).
constexpr size_t kMaxTargetBanks = 8;

// Long enough for "Vänster" or "Bana 3", short enough to fit a run-page cell.
constexpr size_t kMaxBankNameLength = 16;

// Bank masks are one bit per bank, bit 0 being bank A.
using BankMask = uint32_t;

// Every bank, whatever the device's count. Bits above the count are ignored,
// so one constant works on a one-bank device and an eight-bank one.
constexpr BankMask kAllBanksMask = 0xFFFFFFFFu;

inline BankMask bank_bit(size_t index) {
  return static_cast<BankMask>(1u) << index;
}

// The letter a bank is addressed by. '?' outside the range rather than running
// off the alphabet - a diagnostic that reads as wrong beats one that reads as
// bank 'I'.
inline char bank_letter(size_t index) {
  return index < kMaxTargetBanks ? static_cast<char>('A' + index) : '?';
}

}  // namespace rt
