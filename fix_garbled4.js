const fs = require('fs');
function ch() { return String.fromCharCode.apply(null, Array.prototype.slice.call(arguments)); }

function removePrefix(content, seq) {
  content = content.split(seq + ' ').join('');
  content = content.split(seq).join('');
  return content;
}

// ── field.html ────────────────────────────────────────────
var fPath = 'c:/xampp/htdocs/CODE/FIELD/field.html';
var f = fs.readFileSync(fPath, 'utf8');

// 📍 pin GPS check-in: F0 9F 93 8D -> ch(f0,178,201c,8d)
f = removePrefix(f, ch(0xf0, 0x178, 0x201c, 0x8d));
// 🧪 test tube simulate: F0 9F A7 AA -> ch(f0,178,a7,aa)
f = removePrefix(f, ch(0xf0, 0x178, 0xa7, 0xaa));
// 📸 camera upload: F0 9F 93 B8 -> ch(f0,178,201c,b8)
f = removePrefix(f, ch(0xf0, 0x178, 0x201c, 0xb8));
// ★ black star: E2 98 85 -> ch(e2,2dc,2026)
f = f.split(ch(0xe2, 0x2dc, 0x2026)).join('&#9733;');

fs.writeFileSync(fPath, f, 'utf8');
console.log('Saved field.html');

// ── civilian.html ─────────────────────────────────────────
var cPath = 'c:/xampp/htdocs/CODE/CITIZEN/civilian.html';
var c = fs.readFileSync(cPath, 'utf8');

// 🔎 magnifying glass search: F0 9F 94 8E -> ch(f0,178,201d,17d)
c = removePrefix(c, ch(0xf0, 0x178, 0x201d, 0x17d));
// 📎 paperclip upload: F0 9F 93 8E -> ch(f0,178,201c,17d)  [but 0x201c comes from byte 0x93]
c = removePrefix(c, ch(0xf0, 0x178, 0x201c, 0x17d));
// 🔒 lock alert: F0 9F 94 92 -> ch(f0,178,201d,2019)
c = removePrefix(c, ch(0xf0, 0x178, 0x201d, 0x2019));
// 🔐 lock+key hint: F0 9F 94 90 -> ch(f0,178,201d,90)
c = removePrefix(c, ch(0xf0, 0x178, 0x201d, 0x90));
// 🚀 rocket mission: F0 9F 9A 80 -> ch(f0,178,161,20ac)
c = removePrefix(c, ch(0xf0, 0x178, 0x161, 0x20ac));
// 💎 gem values: F0 9F 92 8E -> ch(f0,178,2019,17d)
c = removePrefix(c, ch(0xf0, 0x178, 0x2019, 0x17d));
// 🎯 target vision: F0 9F 8E AF -> ch(f0,178,17d,af)
c = removePrefix(c, ch(0xf0, 0x178, 0x17d, 0xaf));
// 👤 person silhouette: F0 9F 91 A4 -> ch(f0,178,2018,a4)
c = c.split(ch(0xf0, 0x178, 0x2018, 0xa4)).join('&#128100;');

fs.writeFileSync(cPath, c, 'utf8');
console.log('Saved civilian.html');
console.log('Done.');
