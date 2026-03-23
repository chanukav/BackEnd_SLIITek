const dummyUsers = require("../data/dummyUsers.json")

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const users = Array.isArray(dummyUsers) ? dummyUsers : []

const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : ""

const userEmails = users
  .map((user) => normalizeEmail(user?.email))
  .filter((email) => emailRegex.test(email))

const distinctEmails = [...new Set(userEmails)]

let currentUserEmail = distinctEmails[0] || ""

exports.getSampleUserEmails = (req, res) => {
  res.status(200).json({
    success: true,
    count: distinctEmails.length,
    data: distinctEmails,
    currentEmail: currentUserEmail,
  })
}

exports.getCurrentSampleUserEmail = (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      email: currentUserEmail,
    },
  })
}

exports.setCurrentSampleUserEmail = (req, res) => {
  const requestedEmail = normalizeEmail(req.body?.email)

  if (!emailRegex.test(requestedEmail)) {
    return res.status(400).json({ success: false, message: "Valid email is required" })
  }

  if (!distinctEmails.includes(requestedEmail)) {
    return res.status(404).json({ success: false, message: "Email not found in sample users" })
  }

  currentUserEmail = requestedEmail
  return res.status(200).json({
    success: true,
    data: {
      email: currentUserEmail,
    },
  })
}

