const router = require("express").Router();
const { authController } = require("../../controller");
const authMiddleware = require("../../middleware/authMiddleware");

router.post("/registeruser", authController.registerUser);
router.post("/loginuser", authController.login);
router.post("/forgotpassword", authController.forgotPassword);
router.post("/resetpassword", authController.resetPassword);
router.post("/changepassword", authController.changePassword);
router.post("/resendverif", authController.resendVerification);
router.get("/verifyemail", authController.verifyEmail);

router.get("/me", authMiddleware, authController.getCurrentUser);
router.post("/logout", authMiddleware, authController.logout);
module.exports = router;
