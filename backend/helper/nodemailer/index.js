const nodemailer = require("nodemailer")

const transporter = nodemailer.createTransport({
    host: 'mail.coursenese.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.MAIL_USERNAME,
        pass: process.env.MAIL_PASSWORD,
    },
    tls: {
        rejectUnauthorized: true,
    }
})

module.exports = transporter