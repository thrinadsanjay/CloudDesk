const crypto = require("crypto");

function encryptToken(value, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(key), iv);
  let encrypted = cipher.update(JSON.stringify(value), "utf8", "base64");
  encrypted += cipher.final("base64");
  return Buffer.from(
    JSON.stringify({
      iv: iv.toString("base64"),
      value: encrypted,
    })
  ).toString("base64");
}

module.exports = { encryptToken };
