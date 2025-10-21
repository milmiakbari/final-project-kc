const router = require("express").Router();
const { userController } = require("../../controller");
const authMiddleware = require("../../middleware/authMiddleware");
const { upload } = require("../../helper/multer");

router.get("/profile", authMiddleware, userController.getUserProfile);
router.put("/updateprofile", authMiddleware, userController.updateUserProfile);

router.post(
  "/upload-avatar",
  authMiddleware,
  upload("public/profile-picture"),
  userController.uploadAvatar
);

module.exports = router;
