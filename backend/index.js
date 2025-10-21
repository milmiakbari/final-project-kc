// IMPORT MODUL YANG INGIN DIGUNAKAN
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");

// BIKIN APLIKASI
const app = express();
dotenv.config();

// BIKIN URL DEBUGGER - UNTUK NGECEK PESAN URL DARI API
const urlLogger = (req, res, next) => {
  console.log(req.method + " : " + req.url);
  next();
};

// MASUKIN MIDDLEWARE - KEAMANAN
app.use(cors());
app.use(bodyParser.json());
app.use(urlLogger);
app.use(express.static("./public")); 

// KONFIGURASI API ROUTER
const {authRouter, userRouter} = require("./router");

app.use("/auth", authRouter);
app.use("/user", userRouter);

// BIKIN LANDING PAGE API
app.get("/", (req, res) => {
  res
    .status(200) 
    .send( 
      '<div style="text-align:center; font-size:50px; margin-top:20%;">Shoeshop API Connected</div>'
    );
});

// DEFINE PORT API
const PORT = 2000;
app.listen(PORT, () => console.log(`Server is running at PORT: ${PORT}`));