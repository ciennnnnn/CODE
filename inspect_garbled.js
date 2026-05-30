const fs = require('fs');

function showCodes(label, str) {
  const parts = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c > 127) {
      parts.push('[U+' + c.toString(16).toUpperCase() + ']');
    } else {
      parts.push(str[i]);
    }
  }
  console.log(label + ': ' + parts.join(''));
}

const fh = fs.readFileSync('c:/xampp/htdocs/CODE/FIELD/field.html', 'utf8');
const ch = fs.readFileSync('c:/xampp/htdocs/CODE/CITIZEN/civilian.html', 'utf8');

const flines = fh.split('\n');
const clines = ch.split('\n');

console.log('=== field.html ===');
[228, 265, 402, 403, 404, 405, 418, 428].forEach(function(idx) {
  const l = flines[idx];
  if (l) {
    const m = l.match(/>([^<]+)</);
    if (m && m[1].trim()) showCodes('L' + (idx+1), m[1].trim());
  }
});

console.log('\n=== civilian.html ===');
[353, 354, 372].forEach(function(idx) {
  const l = clines[idx];
  if (l) {
    const m = l.match(/>([^<]+)</);
    if (m && m[1].trim()) showCodes('L' + (idx+1), m[1].trim());
  }
});
