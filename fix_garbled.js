const fs = require('fs');

// Mojibake sequences: UTF-8 bytes read as Windows-1252
// Each is [garbledSequence, replacementHTMLEntity]
const replacements = [
  // em-dash: U+2014 -> E2 80 94 -> â€" (Win1252: 0xE2=â, 0x80=€, 0x94=")
  ['â€”', '&mdash;'],
  // ellipsis: U+2026 -> E2 80 A6 -> â€¦ (Win1252: 0xA6=¦)
  ['â€¦', '&hellip;'],
  // right arrow: U+2192 -> E2 86 92 -> â†' (Win1252: 0x86=†, 0x92=')
  ['â†’', '&#8594;'],
  // left arrow: U+2190 -> E2 86 90 -> â† (Win1252: 0x86=†, 0x90 is unassigned, use PAD in Latin-1)
  // Actually 0x90 in Win1252 is unassigned, shows as itself
  // Let's use hex to be safe - will do a byte-level check below
  // counterclockwise arrow: U+21BA -> E2 86 BA -> â†º
  ['â†º', '&#8634;'],
  // ñ: U+00F1 -> C3 B1 -> Ã± (Latin-1: 0xC3=Ã, 0xB1=±)
  ['Ã±', '&ntilde;'],
  // checkmark heavy: U+2705 -> F0 9F 9C 85 -> but F0 starts 4-byte seq
  // Let's handle common emoji removals separately
];

const files = [
  'c:/xampp/htdocs/CODE/FIELD/field.html',
  'c:/xampp/htdocs/CODE/CITIZEN/civilian.html',
];

files.forEach(p => {
  let c = fs.readFileSync(p, 'utf8');
  const before = c.length;

  replacements.forEach(([from, to]) => {
    while (c.includes(from)) {
      c = c.split(from).join(to);
    }
  });

  // Check what leftover garbled chars remain after simple replacements
  fs.writeFileSync(p, c, 'utf8');
  console.log('Saved: ' + p + ' (length: ' + before + ' -> ' + c.length + ')');
});
