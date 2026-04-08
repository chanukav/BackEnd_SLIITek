const express = require("express");
const { protect, authorize } = require("../middleware/authMiddleware");
const {
  listUsers,
  patchUserBlock,
  deleteUserAdmin,
} = require("../controllers/adminUserController");

const router = express.Router();

router.use(protect, authorize("admin", "moderator"));

router.get("/", listUsers);
router.patch("/:id/block", patchUserBlock);
router.delete("/:id", deleteUserAdmin);

module.exports = router;
