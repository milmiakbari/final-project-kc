const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const transporter = require("../../helper/nodemailer");
const database = require("../../database");
const { runQuery } = require("../../utils");

module.exports = {
  registerUser: async (req, res) => {
    const {
      name,
      email,
      password,
      confirmPassword,
      phone_number,
      address,
      city,
      country,
      zip_code,
      profile_picture, // FE kirim ini; di DB kolomnya "avatar_url"
    } = req.body;

    // Validasi format sederhana
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: "Format email tidak valid" });
    }
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        success: false,
        message: "Password minimal 8 karakter dan mengandung huruf & angka",
      });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: "Password dan konfirmasi tidak sama" });
    }

    try {
      // Cek duplikat email
      const emailDup = await runQuery("SELECT id FROM users WHERE email = ?", [email]);
      if (emailDup.length) {
        return res.status(409).json({ success: false, message: "Email sudah terdaftar" });
      }

      // (Opsional) cek duplikat phone kalau diisi
      if (phone_number) {
        const phoneDup = await runQuery("SELECT user_id FROM profiles WHERE phone_number = ?", [phone_number]);
        if (phoneDup.length) {
          return res.status(409).json({ success: false, message: "Nomor telepon sudah terdaftar" });
        }
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      // ===== Transaksi: users -> profiles -> course_carts =====
      await runQuery("START TRANSACTION");

      // 1) users (password_hash, role default 'member')
      const resultUser = await runQuery(
        `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'member')`,
        [name || "", email, hashedPassword]
      );
      const userId = resultUser.insertId;

      // 2) profiles (kolom avatar_url, bukan profile_picture)
      await runQuery(
        `INSERT INTO profiles (user_id, phone_number, address, city, country, zip_code, avatar_url)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          phone_number || null,
          address || null,
          city || null,
          country || null,
          zip_code || null,
          profile_picture || null,
        ]
      );

      // 3) course_carts (cart aktif)
      await runQuery(
        `INSERT INTO course_carts (user_id, status) VALUES (?, 'active')`,
        [userId]
      );

      await runQuery("COMMIT");

      // === Kirim email verifikasi (JWT) ===
      const verifyToken = jwt.sign(
        { id: userId, email },
        process.env.JWT_SECRET || "SECRET_KEY",
        { expiresIn: "2h" }
      );
      const verifyLink = `${process.env.FRONTEND_URL || "http://localhost:3000"}/verify-email?token=${verifyToken}`;

      const mailToUser = {
        from: `Coursenese <ridho@coursenese.com>`,
        to: email,
        subject: "Verifikasi Email Anda - Coursenese",
        html: `
          <div style="font-family: Arial, sans-serif; padding:16px; color:#222">
            <h2>Halo ${name || "Member"} 👋</h2>
            <p>Terima kasih sudah mendaftar. Klik tombol di bawah untuk verifikasi email:</p>
            <p>
              <a href="${verifyLink}"
                 style="display:inline-block;padding:10px 16px;background:#1677ff;color:#fff;text-decoration:none;border-radius:6px">
                 Verifikasi Email
              </a>
            </p>
            <p>Link berlaku 2 jam.</p>
          </div>
        `,
      };

      transporter.sendMail(mailToUser, (errSend) => {
        if (errSend) {
          console.error("Gagal kirim email verifikasi:", errSend);
          // Tetap sukses (account created), user bisa klik "resend verification" nanti
          return res.status(201).json({
            success: true,
            message: "Registrasi berhasil. Email verifikasi gagal dikirim, silakan kirim ulang dari halaman login.",
            data: { user: { id: userId, name, email } },
          });
        }

        return res.status(201).json({
          success: true,
          message: "Registrasi berhasil. Cek email kamu untuk verifikasi.",
          data: { user: { id: userId, name, email } },
        });
      });
    } catch (err) {
      // Pastikan rollback kalau transaksi sudah mulai
      try { await runQuery("ROLLBACK"); } catch (_) {}
      console.error(err);
      return res.status(500).json({ success: false, message: "Terjadi kesalahan server" });
    }
  },

  login: async (req, res) => {
    const { email, password } = req.body;

    // Validasi sederhana
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: "Format email tidak valid" });
    }
    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password minimal 8 karakter",
      });
    }

    try {
      // 1) Cari user
      const users = await runQuery(
        `SELECT id, name, email, password_hash, role, email_verified_at
         FROM users WHERE email = ? LIMIT 1`,
        [email]
      );
      if (!users.length) {
        return res.status(400).json({ success: false, message: "User tidak ditemukan" });
      }
      const user = users[0];

      // 2) Cek password
      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: "Password salah" });
      }

      // 3) (Opsional tapi disarankan) blokir jika belum verifikasi email
      if (!user.email_verified_at) {
        return res.status(403).json({
          success: false,
          message: "Email belum terverifikasi. Silakan cek email atau klik 'resend verification'.",
          needVerification: true,
        });
      }

      // 4) Ambil profil ringkas (buat FE)
      const profiles = await runQuery(
        `SELECT phone_number, avatar_url, city, country FROM profiles WHERE user_id = ?`,
        [user.id]
      );
      const profile = profiles[0] || null;

      // 5) Buat JWT
      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET || "SECRET_KEY",
        { expiresIn: "2h" } // silakan sesuaikan
      );

      // 6) Response ke FE
      return res.status(200).json({
        success: true,
        message: "Login berhasil",
        data: {
          token,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            verified: !!user.email_verified_at,
            profile,
          },
        },
      });
    } catch (err) {
      console.error("Login error:", err);
      return res.status(500).json({
        success: false,
        message: "Terjadi kesalahan server",
      });
    }
  },

  forgotPassword: (req, res) => {
    const { email } = req.body;

    // Validasi input kosong
    if (!email) {
      return res.status(400).json({ success: false, message: "Email tidak boleh kosong" });
    }

    // Validasi format email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: "Format email tidak valid" });
    }

    // Cek apakah email ada di database
    const queryUser = `SELECT id, name, email FROM users WHERE email = ? LIMIT 1`;
    database.query(queryUser, [email], (err, result) => {
      if (err) {
        console.error("DB error:", err);
        return res.status(500).json({ success: false, message: "Terjadi kesalahan server" });
      }

      if (result.length === 0) {
        // Supaya aman (tidak bocorkan email valid/invalid)
        return res.status(200).json({
          success: true,
          message: "Jika email terdaftar, tautan reset password telah dikirim",
        });
      }

      const user = result[0];

      // Generate token unik dan waktu kadaluarsa (15 menit)
      const token = crypto.randomBytes(32).toString("hex");
      const expiry = new Date(Date.now() + 1000 * 60 * 15); // 15 menit

      // Simpan token & expiry ke database
      const queryUpdate = `
        UPDATE users
        SET reset_token = ?, reset_token_expiry = ?
        WHERE id = ?
      `;
      database.query(queryUpdate, [token, expiry, user.id], (err2) => {
        if (err2) {
          console.error("Gagal menyimpan token reset:", err2);
          return res.status(500).json({
            success: false,
            message: "Gagal membuat token reset password",
          });
        }

        // Buat link reset password (ubah ke domain frontend kamu)
        const resetLink = `${process.env.FRONTEND_URL || "https://coursenese.com"}/reset-password?token=${token}&email=${email}`;

        // Email template
        const mailOptions = {
          from: `Coursenese <ridho@coursenese.com>`,
          to: email,
          subject: "Permintaan Reset Password - Coursenese",
          html: `
            <div style="font-family: Arial, sans-serif; padding: 20px;">
              <h2>Reset Password</h2>
              <p>Halo ${user.name || "User"}, kami menerima permintaan untuk reset password akun Anda.</p>
              <p>Klik tombol di bawah ini untuk mengganti password Anda:</p>
              <a href="${resetLink}"
                 style="display:inline-block;padding:10px 20px;background:#1677ff;color:white;text-decoration:none;border-radius:5px;">
                Reset Password
              </a>
              <p>Atau salin link ini ke browser Anda:</p>
              <p>${resetLink}</p>
              <p><small>Link ini hanya berlaku selama 15 menit.</small></p>
            </div>
          `,
        };

        // Kirim email
        transporter.sendMail(mailOptions, (err3) => {
          if (err3) {
            console.error("Gagal kirim email reset:", err3);
            return res.status(500).json({
              success: false,
              message: "Gagal mengirim email reset password",
            });
          }

          res.status(200).json({
            success: true,
            message: "Email reset password telah dikirim ke alamat email Anda",
          });
        });
      });
    });
  },

  resetPassword: (req, res) => {
    const { email, token, new_password } = req.body;

    // Validasi input
    if (!email || !token || !new_password) {
      return res.status(400).json({ success: false, message: "Semua field wajib diisi" });
    }

    // Validasi format email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: "Format email tidak valid" });
    }

    // Validasi password minimal
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(new_password)) {
      return res.status(400).json({
        success: false,
        message: "Password minimal 8 karakter dan mengandung huruf & angka",
      });
    }

    // Cek token & email
    const queryCheck = `
      SELECT id, name, email, reset_token, reset_token_expiry
      FROM users
      WHERE email = ? AND reset_token = ? AND reset_token_expiry > NOW()
      LIMIT 1
    `;

    database.query(queryCheck, [email, token], async (err, result) => {
      if (err) {
        console.error("DB error:", err);
        return res.status(500).json({ success: false, message: "Terjadi kesalahan server" });
      }

      if (result.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Token tidak valid atau sudah kedaluwarsa",
        });
      }

      const user = result[0];

      try {
        // Hash password baru
        const hashedPassword = await bcrypt.hash(new_password, 10);

        // Update password_hash dan hapus token
        const updateQuery = `
          UPDATE users
          SET password_hash = ?, reset_token = NULL, reset_token_expiry = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `;

        database.query(updateQuery, [hashedPassword, user.id], (err2) => {
          if (err2) {
            console.error("Gagal update password:", err2);
            return res.status(500).json({ success: false, message: "Gagal mengubah password" });
          }

          // Kirim email notifikasi
          const mailOptions = {
            from: `Coursenese <ridho@coursenese.com>`,
            to: email,
            subject: "Password Anda Berhasil Diubah - Coursenese",
            html: `
              <div style="font-family: Arial, sans-serif; padding: 20px;">
                <h2>Password Berhasil Diubah ✅</h2>
                <p>Halo ${user.name || "Member"},</p>
                <p>Password akun Anda telah berhasil diperbarui.</p>
                <p>Jika Anda tidak melakukan perubahan ini, segera hubungi tim support kami.</p>
                <p><small>Terima kasih,<br/>Tim Coursenese</small></p>
              </div>
            `,
          };

          transporter.sendMail(mailOptions, (err3) => {
            if (err3) {
              console.error("Gagal kirim email notifikasi:", err3);
              return res.status(200).json({
                success: true,
                message: "Password berhasil direset, namun notifikasi email gagal dikirim.",
              });
            }

            res.status(200).json({
              success: true,
              message: "Password berhasil direset dan notifikasi telah dikirim ke email Anda.",
            });
          });
        });
      } catch (hashErr) {
        console.error("Gagal hash password:", hashErr);
        res.status(500).json({ success: false, message: "Terjadi kesalahan saat enkripsi password" });
      }
    });
  },

  changePassword: async (req, res) => {
    const { user_id, old_password, new_password, confirm_password } = req.body;

    // ===== Validasi awal =====
    if (!user_id || !old_password || !new_password || !confirm_password) {
      return res.status(400).json({
        success: false,
        message: "Semua field wajib diisi",
      });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({
        success: false,
        message: "Password baru dan konfirmasi tidak sama",
      });
    }

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(new_password)) {
      return res.status(400).json({
        success: false,
        message: "Password minimal 8 karakter dan mengandung huruf & angka",
      });
    }

    try {
      // 1️⃣ Ambil user dari database
      const users = await runQuery(
        "SELECT id, name, email, password_hash FROM users WHERE id = ? LIMIT 1",
        [user_id]
      );

      if (users.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User tidak ditemukan",
        });
      }

      const user = users[0];

      // 2️⃣ Verifikasi password lama
      const isMatch = await bcrypt.compare(old_password, user.password_hash);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: "Password lama salah",
        });
      }

      // 3️⃣ Hash password baru
      const hashedPassword = await bcrypt.hash(new_password, 10);

      // 4️⃣ Update password ke database
      await runQuery(
        `UPDATE users 
         SET password_hash = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [hashedPassword, user_id]
      );

      // 5️⃣ Kirim email notifikasi perubahan password
      const mailOptions = {
        from: `Coursenese <ridho@coursenese.com>`,
        to: user.email,
        subject: "Password Akun Anda Telah Diperbarui - Coursenese",
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Password Diperbarui 🔒</h2>
            <p>Halo ${user.name || "Member"},</p>
            <p>Password akun Anda telah berhasil diperbarui pada <b>${new Date().toLocaleString("id-ID")}</b>.</p>
            <p>Jika ini bukan Anda, segera hubungi tim support kami.</p>
            <br/>
            <p><small>Terima kasih,<br/>Tim Coursenese</small></p>
          </div>
        `,
      };

      transporter.sendMail(mailOptions, (errMail) => {
        if (errMail) {
          console.error("Gagal kirim email notifikasi:", errMail);
          return res.status(200).json({
            success: true,
            message: "Password berhasil diubah, namun email notifikasi gagal dikirim.",
          });
        }

        return res.status(200).json({
          success: true,
          message: "Password berhasil diubah dan notifikasi telah dikirim ke email Anda.",
        });
      });
    } catch (err) {
      console.error("Change password error:", err);
      return res.status(500).json({
        success: false,
        message: "Terjadi kesalahan server",
      });
    }
  },

  resendVerification: async (req, res) => {
    const { email } = req.body;

    // ===== Validasi input =====
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email tidak boleh kosong",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Format email tidak valid",
      });
    }

    try {
      // 1️⃣ Cek apakah user terdaftar
      const users = await runQuery(
        "SELECT id, name, email, email_verified_at FROM users WHERE email = ? LIMIT 1",
        [email]
      );

      if (users.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Email belum terdaftar",
        });
      }

      const user = users[0];

      // 2️⃣ Jika sudah terverifikasi, tidak perlu kirim ulang
      if (user.email_verified_at) {
        return res.status(400).json({
          success: false,
          message: "Email ini sudah terverifikasi.",
        });
      }

      // 3️⃣ (Opsional) Batasi spam resend (cek waktu 5 menit terakhir)
      // Kamu bisa buat tabel `email_logs` kalau mau catat waktu terakhir kirim
      // Untuk sekarang, kita skip agar selalu bisa kirim saat butuh.

      // 4️⃣ Buat token verifikasi baru
      const verifyToken = jwt.sign(
        { id: user.id, email: user.email },
        process.env.JWT_SECRET || "SECRET_KEY",
        { expiresIn: "2h" }
      );

      // 5️⃣ Buat link verifikasi
      const verifyLink = `${process.env.FRONTEND_URL || "https://coursenese.com"}/verify-email?token=${verifyToken}`;

      // 6️⃣ Kirim email verifikasi
      const mailOptions = {
        from: `Coursenese <ridho@coursenese.com>`,
        to: user.email,
        subject: "Verifikasi Email Anda - Coursenese",
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2>Halo ${user.name || "Member"} 👋</h2>
            <p>Kami perhatikan Anda belum memverifikasi email Anda. Klik tombol di bawah untuk verifikasi akun Anda:</p>
            <p>
              <a href="${verifyLink}"
                 style="display:inline-block;padding:10px 16px;background:#1677ff;color:#fff;text-decoration:none;border-radius:6px">
                 Verifikasi Email
              </a>
            </p>
            <p>Atau salin link ini ke browser Anda:</p>
            <p>${verifyLink}</p>
            <p><small>Link ini berlaku selama 2 jam.</small></p>
            <hr>
            <p style="font-size:12px;color:#888;">Jika Anda tidak membuat akun di Coursenese, abaikan email ini.</p>
          </div>
        `,
      };

      transporter.sendMail(mailOptions, (errSend) => {
        if (errSend) {
          console.error("Gagal kirim email verifikasi ulang:", errSend);
          return res.status(500).json({
            success: false,
            message: "Gagal mengirim ulang email verifikasi",
          });
        }

        return res.status(200).json({
          success: true,
          message: "Email verifikasi telah dikirim ulang. Silakan cek inbox Anda.",
        });
      });
    } catch (err) {
      console.error("Resend verification error:", err);
      return res.status(500).json({
        success: false,
        message: "Terjadi kesalahan server",
      });
    }
  },

  verifyEmail: async (req, res) => {
    const { token } = req.query; // token dikirim dari URL (misal ?token=abc123)

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Token verifikasi tidak ditemukan",
      });
    }

    try {
      // 1️⃣ Verifikasi dan decode token
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "SECRET_KEY");

      // 2️⃣ Cek apakah user masih belum terverifikasi
      const users = await runQuery(
        "SELECT id, email_verified_at FROM users WHERE id = ? LIMIT 1",
        [decoded.id]
      );

      if (!users.length) {
        return res.status(404).json({
          success: false,
          message: "User tidak ditemukan",
        });
      }

      const user = users[0];
      if (user.email_verified_at) {
        return res.status(400).json({
          success: false,
          message: "Email sudah diverifikasi sebelumnya.",
        });
      }

      // 3️⃣ Update kolom email_verified_at
      await runQuery(
        "UPDATE users SET email_verified_at = NOW() WHERE id = ?",
        [decoded.id]
      );

      // 4️⃣ Respon sukses
      return res.status(200).json({
        success: true,
        message: "Email berhasil diverifikasi. Silakan login untuk melanjutkan.",
      });
    } catch (err) {
      console.error("Verifikasi email error:", err);

      // Jika token invalid atau expired
      return res.status(400).json({
        success: false,
        message:
          "Token verifikasi tidak valid atau sudah kedaluwarsa. Silakan kirim ulang email verifikasi.",
      });
    }
  },

  getCurrentUser: async (req, res) => {
    try {
      // 1️⃣ Ambil user ID dari middleware JWT (req.user diisi otomatis)
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Token tidak valid atau user tidak ditemukan",
        });
      }

      // 2️⃣ Ambil data user + profil dari database
      const result = await runQuery(
        `SELECT 
            u.id, u.name, u.email, u.role, u.email_verified_at,
            p.phone_number, p.address, p.city, p.country, p.zip_code, p.avatar_url
         FROM users u
         LEFT JOIN profiles p ON u.id = p.user_id
         WHERE u.id = ?`,
        [userId]
      );

      if (!result.length) {
        return res.status(404).json({
          success: false,
          message: "User tidak ditemukan",
        });
      }

      const user = result[0];

      // 3️⃣ Kembalikan data user ke frontend
      res.status(200).json({
        success: true,
        message: "Data user berhasil diambil",
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          verified: !!user.email_verified_at,
          profile: {
            phone_number: user.phone_number,
            address: user.address,
            city: user.city,
            country: user.country,
            zip_code: user.zip_code,
            avatar_url: user.avatar_url,
          },
        },
      });
    } catch (err) {
      console.error("getCurrentUser error:", err);
      res.status(500).json({
        success: false,
        message: "Terjadi kesalahan server",
      });
    }
  },

  logout: async (req, res) => {
  try {
    // Ambil token dari header Authorization
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Token tidak ditemukan pada header Authorization",
      });
    }

    // Karena JWT bersifat stateless, kita tidak bisa 'menghapus' token dari server.
    // Solusi: Frontend harus menghapus token dari localStorage / cookie.
    // Tapi untuk best practice, bisa juga disimpan ke table 'revoked_tokens' (opsional)

    res.status(200).json({
      success: true,
      message: "Logout berhasil. Silakan login kembali untuk melanjutkan.",
    });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({
      success: false,
      message: "Terjadi kesalahan server saat logout",
    });
  }
},


};
