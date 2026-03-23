const express = require("express")
const {
  getSampleUserEmails,
  getCurrentSampleUserEmail,
  setCurrentSampleUserEmail,
} = require("../controllers/sampleUserController")

const router = express.Router()

router.get("/emails", getSampleUserEmails)
router.get("/current-email", getCurrentSampleUserEmail)
router.put("/current-email", setCurrentSampleUserEmail)

module.exports = router

