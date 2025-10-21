const database = require("../../database");
const { runQuery } = require("../../utils");
const fs = require("fs");
const path = require("path");

module.exports = {
    getUserProfile: async (req, res) => {
    try {
      const userId = req.user?.id; // diambil dari JWT lewat authMiddleware
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Akses ditolak, token tidak valid",
        });
      }

      // JOIN tabel users dan profiles
      const query = `
        SELECT 
          u.id, 
          u.name, 
          u.email, 
          u.role, 
          u.email_verified_at,
          p.phone_number,
          p.avatar_url,
          p.bio,
          p.address,
          p.city,
          p.country,
          p.zip_code,
          p.created_at AS profile_created_at
        FROM users u
        LEFT JOIN profiles p ON u.id = p.user_id
        WHERE u.id = ?
        LIMIT 1
      `;

      const result = await runQuery(query, [userId]);
      if (!result.length) {
        return res.status(404).json({
          success: false,
          message: "Profil user tidak ditemukan",
        });
      }

      const user = result[0];

      res.status(200).json({
        success: true,
        message: "Data profil user berhasil diambil",
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          verified: !!user.email_verified_at,
          profile: {
            phone_number: user.phone_number,
            avatar_url: user.avatar_url,
            bio: user.bio,
            address: user.address,
            city: user.city,
            country: user.country,
            zip_code: user.zip_code,
            created_at: user.profile_created_at,
          },
        },
      });
    } catch (err) {
      console.error("getUserProfile error:", err);
      res.status(500).json({
        success: false,
        message: "Terjadi kesalahan server",
      });
    }
  },

  updateUserProfile: async (req, res) => {
    try {
      const userId = req.user?.id; // ambil user ID dari token JWT (authMiddleware)
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Akses ditolak. Token tidak valid.",
        });
      }

      // Ambil data dari body
      const {
        name,
        phone_number,
        address,
        city,
        country,
        zip_code,
        avatar_url,
      } = req.body;

      // Validasi minimal 1 field diubah
      if (
        !name &&
        !phone_number &&
        !address &&
        !city &&
        !country &&
        !zip_code &&
        !avatar_url
      ) {
        return res.status(400).json({
          success: false,
          message: "Tidak ada data yang diubah.",
        });
      }

      // Mulai transaksi
      await runQuery("START TRANSACTION");

      // Update tabel users (nama aja yang bisa diubah di sini)
      if (name) {
        await runQuery(`UPDATE users SET name = ? WHERE id = ?`, [name, userId]);
      }

      // Update tabel profiles
      await runQuery(
        `
        UPDATE profiles 
        SET phone_number = COALESCE(?, phone_number),
            address = COALESCE(?, address),
            city = COALESCE(?, city),
            country = COALESCE(?, country),
            zip_code = COALESCE(?, zip_code),
            avatar_url = COALESCE(?, avatar_url)
        WHERE user_id = ?
        `,
        [
          phone_number || null,
          address || null,
          city || null,
          country || null,
          zip_code || null,
          avatar_url || null,
          userId,
        ]
      );

      await runQuery("COMMIT");

      // Ambil data terbaru
      const updated = await runQuery(
        `SELECT 
          u.id, u.name, u.email, u.role, u.email_verified_at,
          p.phone_number, p.address, p.city, p.country, p.zip_code, p.avatar_url
         FROM users u
         LEFT JOIN profiles p ON u.id = p.user_id
         WHERE u.id = ?`,
        [userId]
      );

      res.status(200).json({
        success: true,
        message: "Profil berhasil diperbarui.",
        data: updated[0],
      });
    } catch (err) {
      console.error("updateUserProfile error:", err);
      try {
        await runQuery("ROLLBACK");
      } catch (_) {}
      res.status(500).json({
        success: false,
        message: "Terjadi kesalahan server saat memperbarui profil.",
      });
    }
  },

  uploadAvatar: async (req, res) => {
    try {
      const userId = req.user?.id; // dari authMiddleware
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Akses ditolak. Token tidak valid.",
        });
      }

      // Pastikan ada file yang diunggah (multer -> .single("IMG"))
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Tidak ada file yang diunggah. Gunakan field form-data bernama 'IMG'.",
        });
      }

      // Path relatif yang disimpan ke DB (karena public sudah di-serve statis)
      const newRelPath = `/profile-picture/${req.file.filename}`;

      // (Opsional) hapus file avatar lama jika tersimpan lokal di /public/profile-picture
      try {
        const prev = await runQuery(
          "SELECT avatar_url FROM profiles WHERE user_id = ? LIMIT 1",
          [userId]
        );
        const prevUrl = prev[0]?.avatar_url || null;

        if (prevUrl && prevUrl.startsWith("/profile-picture/")) {
          // prevUrl contoh: "/profile-picture/IMG-123.png"
          // jadikan path absolut: <root>/public/profile-picture/IMG-123.png
          const absoluteOld = path.resolve("public", `.${prevUrl}`);
          if (fs.existsSync(absoluteOld)) {
            fs.unlink(absoluteOld, () => {}); // non-blocking
          }
        }
      } catch (_) {
        // abaikan error penghapusan file lama
      }

      // Simpan path baru ke DB
      await runQuery(
        "UPDATE profiles SET avatar_url = ? WHERE user_id = ?",
        [newRelPath, userId]
      );

      const baseUrl = `${req.protocol}://${req.get("host")}`;

      return res.status(200).json({
        success: true,
        message: "Avatar berhasil diperbarui.",
        data: {
          avatar_url: newRelPath,                  // simpan ini di DB
          avatar_full_url: `${baseUrl}${newRelPath}`, // untuk preview di FE
        },
      });
    } catch (err) {
      console.error("uploadAvatar error:", err);
      return res.status(500).json({
        success: false,
        message: "Terjadi kesalahan server saat upload avatar.",
      });
    }
  },
};