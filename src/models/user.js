const mongoose = require("mongoose");

const loginLogSchema = new mongoose.Schema(
  {
    time: {
      type: Date,
      default: Date.now,
    },
    ip: {
      type: String,
      trim: true,
    },
    userAgent: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["success", "failed"],
      required: true,
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
    },
    lastName: {
      type: String,
      required: [true, "Last name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
    },
    academicYear: {
      type: String,
      required: [true, "Academic year is required"],
      enum: ["1st Year", "2nd Year", "3rd Year", "4th Year"],
    },
    faculty: {
      type: String,
      required: [true, "Faculty is required"],
      enum: [
        "Computing",
        "Engineering",
        "Business",
        "Architecture",
        "Humanities & Sciences",
        "Medicine",
      ],
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
    },
    sliitIdPhoto: {
      type: String,
      required: [true, "SLIIT ID photo is required"],
      trim: true,
    },
    avatar: {
      type: String,
      default: null,
      trim: true,
    },
    avatarBlobName: {
      type: String,
      default: "",
      trim: true,
    },
    role: {
      type: String,
      enum: ["admin", "moderator", "user"],
      default: "user",
    },
    trustScore: {
      type: Number,
      default: 1
    },
    /** Set by admins/moderators to prevent sign-in (see admin user API). */
    isBlocked: {
      type: Boolean,
      default: false,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    emailVerificationToken: {
      type: String,
      default: null,
    },
    emailVerificationExpires: {
      type: Date,
      default: null,
    },

    resetPasswordToken: {
      type: String,
      default: null,
    },
    resetPasswordExpires: {
      type: Date,
      default: null,
    },

    resetOtp: {
      type: String,
      default: null,
    },
    resetOtpExpire: {
      type: Date,
      default: null,
    },

    otpSecret: {
      type: String,
      default: null,
    },
    otpEnabled: {
      type: Boolean,
      default: false,
    },

    failedLoginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: {
      type: Date,
      default: null,
    },

    refreshToken: {
      type: String,
      default: null,
    },

    loginLogs: {
      type: [loginLogSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

userSchema.virtual("isLocked").get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

module.exports = mongoose.model("User", userSchema);