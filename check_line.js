const fs = require('fs');
const c = fs.readFileSync('c:/xampp/htdocs/CODE/CITIZEN/civilian.html', 'utf8');
const lines = c.split('\n');

// Check line 453 (index 452)
const l = lines[452];
console.log('Line 453:', l.trim().substring(0, 100));
console.log('Char codes:');
for (var i = 0; i < l.length; i++) {
  var code = l.charCodeAt(i);
  if (code > 127) {
    console.log('  [' + i + '] = U+' + code.toString(16).toUpperCase() + ' = ' + l[i]);
  }
}

// Also check lines 263 and 296
[262, 295, 218, 219].forEach(function(idx) {
  const line = lines[idx];
  if (!line) return;
  console.log('\nLine ' + (idx+1) + ':', line.trim().substring(0, 100));
  for (var i = 0; i < line.length; i++) {
    var code = line.charCodeAt(i);
    if (code > 127) {
      console.log('  [' + i + '] = U+' + code.toString(16).toUpperCase() + ' = ' + line[i]);
    }
  }
});
