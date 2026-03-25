const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const User = require("../models/user");

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const seedUsers = [
  {
    firstName: "System",
    lastName: "Admin",
    email: "admin@sliitek.com",
    academicYear: "4th Year",
    faculty: "Computing",
    phone: "+94770000001",
    role: "admin",
    isEmailVerified: true,
    password: "Admin@123",
    sliitIdPhoto: "/uploads/seed-admin-id.jpg",
  },
  {
    firstName: "Role",
    lastName: "Moderator",
    email: "moderator@sliitek.com",
    academicYear: "3rd Year",
    faculty: "Engineering",
    phone: "+94770000002",
    role: "moderator",
    isEmailVerified: true,
    password: "Moderator@123",
    sliitIdPhoto: "/uploads/seed-moderator-id.jpg",
  },
  {
    firstName: "Sample",
    lastName: "Student",
    email: "it100000@my.sliit.lk",
    academicYear: "2nd Year",
    faculty: "Business",
    phone: "+94770000003",
    role: "user",
    isEmailVerified: false,
    password: "User@123",
    sliitIdPhoto: "/uploads/seed-user-id.jpg",
  },
];

const upsertUsers = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing in .env");
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB connected for seeding.");

  for (const user of seedUsers) {
    const hashedPassword = await bcrypt.hash(user.password, 10);
    const payload = {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email.toLowerCase().trim(),
      academicYear: user.academicYear,
      faculty: user.faculty,
      phone: user.phone,
      role: user.role,
      isEmailVerified: user.isEmailVerified,
      sliitIdPhoto: user.sliitIdPhoto,
      password: hashedPassword,
      refreshToken: null,
    };

    await User.findOneAndUpdate(
      { email: payload.email },
      { $set: payload },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );

    console.log(`Seeded: ${payload.email} (${payload.role})`);
  }

  console.log("User seed completed successfully.");
};

upsertUsers()
  .catch((error) => {
    console.error("User seed failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
    console.log("MongoDB connection closed.");
  });
