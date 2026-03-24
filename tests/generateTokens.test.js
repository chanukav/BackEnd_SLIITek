const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const {
  generateAccessToken,
  generateRefreshToken,
} = require("../src/utils/generateTokens");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test-refresh";

const mockUser = {
  _id: "507f191e810c19729de860ea",
  email: "it12345@my.sliit.lk",
  role: "user",
};

test("generateAccessToken returns verifiable JWT payload", () => {
  const token = generateAccessToken(mockUser);
  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  assert.equal(decoded.id, mockUser._id);
  assert.equal(decoded.email, mockUser.email);
  assert.equal(decoded.role, mockUser.role);
});

test("generateRefreshToken returns verifiable refresh JWT payload", () => {
  const token = generateRefreshToken(mockUser);
  const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);

  assert.equal(decoded.id, mockUser._id);
});
