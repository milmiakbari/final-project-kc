// IMPORT MODULE
const mysql = require("mysql2");

const connection = mysql.createConnection({
  database: process.env.DB_NAME,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// MYSQL DEBUGGER
connection.connect((err) => {
  if (err) {
    console.log(err);
  }
  console.log(`DB Connected as id : ${connection.threadId}`);
});

module.exports = connection