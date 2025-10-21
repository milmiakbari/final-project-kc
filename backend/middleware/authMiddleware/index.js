const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // ambil setelah "Bearer "

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Token tidak ditemukan",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "SECRET_KEY");
    req.user = decoded; // simpan data user ke request
    next();
  } catch (err) {
    console.error("JWT verify error:", err);
    return res.status(403).json({
      success: false,
      message: "Token tidak valid atau sudah kadaluwarsa",
    });
  }
};
