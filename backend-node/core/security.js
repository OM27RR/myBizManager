const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('./config');

async function hashPassword(plainPassword) {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(plainPassword, salt);
}

async function comparePassword(plainPassword, hashedPassword) {
  return bcrypt.compare(plainPassword, hashedPassword);
}

function generateToken(payload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

module.exports = { hashPassword, comparePassword, generateToken, verifyToken };