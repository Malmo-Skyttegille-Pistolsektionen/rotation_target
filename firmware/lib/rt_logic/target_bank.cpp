// ============================================================================
//  rt_logic/target_bank.cpp
//  Reading a bank selection off the wire, and saying what moved (#207, D-41).
//  Here rather than in the HTTP layer so both are host-testable.
// ============================================================================
#include "target_bank.h"

namespace rt {
namespace {

// "A", "A and B", "A, B and D" - the Oxford-less English an operator reads in
// a toast, not a JSON array.
std::string letters_text(BankMask mask, size_t bank_count) {
  std::vector<char> letters;
  for (size_t i = 0; i < bank_count && i < kMaxTargetBanks; ++i) {
    if (mask & bank_bit(i)) letters.push_back(bank_letter(i));
  }
  std::string out;
  for (size_t i = 0; i < letters.size(); ++i) {
    if (i > 0) out += (i + 1 == letters.size()) ? " and " : ", ";
    out += letters[i];
  }
  return out;
}

std::string bank_range_text(size_t bank_count) {
  if (bank_count <= 1) return "only bank A";
  std::string out = "banks A-";
  out += bank_letter(bank_count - 1);
  return out;
}

// "Bank B" / "banks B and C" - `capital` only for the phrase that opens the
// sentence, so a split toggle does not read "..., Bank C hidden".
std::string banks_phrase(BankMask mask, size_t bank_count, size_t moved, bool capital) {
  std::string out = moved == 1 ? "ank " : "anks ";
  out.insert(out.begin(), capital ? 'B' : 'b');
  out += letters_text(mask, bank_count);
  return out;
}

size_t popcount(BankMask mask, size_t bank_count) {
  size_t n = 0;
  for (size_t i = 0; i < bank_count && i < kMaxTargetBanks; ++i) {
    if (mask & bank_bit(i)) ++n;
  }
  return n;
}

}  // namespace

BankSelection parse_bank_selection(const std::vector<std::string> &letters, size_t bank_count) {
  BankSelection selection;
  if (letters.empty()) return selection;

  for (const std::string &entry : letters) {
    const bool well_formed = entry.size() == 1 && entry[0] >= 'A' && entry[0] <= 'H';
    const size_t index = well_formed ? static_cast<size_t>(entry[0] - 'A') : kMaxTargetBanks;
    if (!well_formed || index >= bank_count) {
      selection.offender = entry;
      selection.mask = 0;
      return selection;
    }
    selection.mask |= bank_bit(index);
  }
  selection.ok = true;
  return selection;
}

std::string bank_refusal_message(const BankSelection &selection, size_t bank_count) {
  if (selection.offender.empty()) {
    return "'banks' named no bank. Omit the body to move every bank.";
  }
  return "'" + selection.offender + "' is not a bank on this device, which has " +
         bank_range_text(bank_count) + ".";
}

std::string targets_moved_message(BankMask shown, BankMask hidden, size_t bank_count) {
  const BankMask every = mask_for_count(bank_count);
  if ((shown & every) == every) return "Targets shown";
  if ((hidden & every) == every) return "Targets hidden";

  const size_t shown_count = popcount(shown, bank_count);
  const size_t hidden_count = popcount(hidden, bank_count);
  std::string out;
  if (shown_count > 0) out += banks_phrase(shown, bank_count, shown_count, true) + " shown";
  if (hidden_count > 0) {
    if (!out.empty()) out += ", ";
    out += banks_phrase(hidden, bank_count, hidden_count, out.empty()) + " hidden";
  }
  return out.empty() ? "No targets moved" : out;
}

}  // namespace rt
