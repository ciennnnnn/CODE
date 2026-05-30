const fs = require('fs');

// Build replacement strings from exact Unicode code points
function ch() { return String.fromCharCode.apply(null, Array.prototype.slice.call(arguments)); }

// Field.html specific replacements
const fieldReplacements = [
  // L229: checkmark-heavy emoji (✅ garbled) prefix -> ✓ entity
  [ch(0xe2, 0x153, 0x2026), '&#10003;'],
  // L266: checkmark (✓ garbled) suffix -> &#10003;
  [ch(0xe2, 0x153, 0x201c), '&#10003;'],
  // L403: pencil emoji ✏️ garbled prefix
  [ch(0xe2, 0x153, 0x8f, 0xef, 0xb8, 0x8f) + ' ', ''],
  // L404: lock emoji 🔒 garbled prefix
  [ch(0xf0, 0x178, 0x201d, 0x2018) + ' ', ''],
  // L405: clipboard emoji 📋 garbled prefix
  [ch(0xf0, 0x178, 0x201c, 0x2039) + ' ', ''],
  // L406: ⬡/logout emoji garbled prefix
  [ch(0xe2, 0xac, 0xa1) + ' ', ''],
  // L429: left arrow ← garbled
  [ch(0xe2, 0x2020, 0x90), '&#8592;'],
];

// Civilian.html specific replacements
const civilianReplacements = [
  // L354: garbled middle dot Â· -> &middot;
  [ch(0xc2, 0xb7), '&middot;'],
  // L355: checkmark ✓ garbled prefix
  [ch(0xe2, 0x153, 0x201c) + ' ', '&#10003; '],
  // L373: pencil ✎ garbled prefix
  [ch(0xe2, 0x153, 0x17d) + ' ', ''],
];

function applyReplacements(content, replacements) {
  replacements.forEach(function(pair) {
    while (content.indexOf(pair[0]) !== -1) {
      content = content.split(pair[0]).join(pair[1]);
    }
  });
  return content;
}

// Fix field.html
const fieldPath = 'c:/xampp/htdocs/CODE/FIELD/field.html';
let fieldContent = fs.readFileSync(fieldPath, 'utf8');
fieldContent = applyReplacements(fieldContent, fieldReplacements);
fs.writeFileSync(fieldPath, fieldContent, 'utf8');
console.log('Fixed: ' + fieldPath);

// Fix civilian.html
const civilPath = 'c:/xampp/htdocs/CODE/CITIZEN/civilian.html';
let civilContent = fs.readFileSync(civilPath, 'utf8');
civilContent = applyReplacements(civilContent, civilianReplacements);
fs.writeFileSync(civilPath, civilContent, 'utf8');
console.log('Fixed: ' + civilPath);

console.log('Done.');
