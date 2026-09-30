const mongoose = require('mongoose');
const { hashPassword } = require('../core/security');

const ownerSchema = new mongoose.Schema(
  {
    owner_id: {
      type: String,
      required: [true, 'Owner ID is required'],
      trim: true,
      unique: true,
    },
    owner_name: {
      type: String,
      required: [true, 'Owner name is required'],
      trim: true,
    },
    business_name: {
      type: String,
      required: [true, 'Business name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    // Stored hashed even though the sample data calls this field `password`.
    password: {
      type: String,
      required: [true, 'Password is required'],
      select: false,
    },
    googleOAuth: {
      connected: { type: Boolean, default: false },
      email: { type: String, default: null },
      refreshTokenEncrypted: { type: String, default: null },
      scope: { type: String, default: null },
      connectedAt: { type: Date, default: null },
    },
    emailConfig: {
      verified: { type: Boolean, default: false },
      email: { type: String, default: null },
      passwordEncrypted: { type: String, default: null },
      provider: { type: String, default: 'gmail' },
      verifiedAt: { type: Date, default: null },
      lastError: { type: String, default: null },
    },
  },
  { versionKey: false }
);


ownerSchema.pre('save', async function() {
  if (!this.isModified('password')) return;

  this.password = await hashPassword(this.password);
});
module.exports = mongoose.model('Owner', ownerSchema);
