// Orphan fixture for the i18n write-site guard self-test (#157 / spec 47 L1).
// The fixture en ships two keys: one referenced here, one referenced nowhere.
// The orphan hard gate must fail the run, name only the unreferenced key, and
// leave the referenced one alone.
export function run() {
  return chrome.i18n.getMessage("referencedDemoKey");
}
