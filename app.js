const { join } = require("node:path");
const express = require("express");
const morgan = require("morgan");
const dotenv = require("dotenv");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const helmet = require("helmet");

const dotenvConfig = dotenv.config({
  path: join(__dirname, ".env"),
});

if (dotenvConfig.error) {
  console.error("[-] dotenv config", dotenvConfig.error.message);
  process.exit(1);
}

const { connectToDatabase } = require("./database/database-connection");
const { AppError } = require("./utils/app-error");
const { globalErrorHandler } = require("./controller/error-handler-controller");
const appRouter = require("./routes/app-route");

process.on("uncaughtException", (err) => {
  console.error(err.name, err.message);
  process.exit(1);
});

const app = express();

app.use(helmet());
app.use(morgan("dev"));

app.set("view engine", "ejs");
app.set("views", join(__dirname, "views"));

app.use(express.static(join(__dirname, "public")));

/*
|--------------------------------------------------------------------------
| CORS
|--------------------------------------------------------------------------
*/

const envOrigins = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  : [];

const developmentOrigins = ["http://127.0.0.1:3000", "http://localhost:3000"];

const allowedOrigins = [
  ...new Set([
    ...envOrigins,
    ...(process.env.NODE_ENV !== "production" ? developmentOrigins : []),
  ]),
];

app.use(
  cors({
    origin(origin, callback) {
      /*
       * درخواست‌هایی مثل Postman، curl و server-to-server
       * معمولاً Origin ندارند.
       */
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.warn(`[CORS] blocked origin: ${origin}`);

      return callback(new AppError(403, `origin ${origin} is not allowed by CORS`));
    },

    credentials: true,

    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

/*
|--------------------------------------------------------------------------
| Request parsers
|--------------------------------------------------------------------------
*/

app.use(express.json({ limit: "10kb" }));

app.use(
  express.urlencoded({
    extended: true,
    limit: "10kb",
  }),
);

app.use(cookieParser());

/*
|--------------------------------------------------------------------------
| Routes
|--------------------------------------------------------------------------
*/

app.use("/", appRouter);

/*
|--------------------------------------------------------------------------
| 404
|--------------------------------------------------------------------------
*/

app.use((req, res, next) => {
  next(new AppError(404, `can't find ${req.method} ${req.originalUrl}`));
});

/*
|--------------------------------------------------------------------------
| Global error handler
|--------------------------------------------------------------------------
*/

app.use(globalErrorHandler);

/*
|--------------------------------------------------------------------------
| Server
|--------------------------------------------------------------------------
*/

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";

let server;

connectToDatabase()
  .then(() => {
    server = app.listen(port, host, () => {
      console.info(`[i] gold-store is running on http://${host}:${port} ...`);

      if (process.env.NODE_ENV !== "production") {
        console.info("[i] allowed CORS origins:", allowedOrigins);
      }
    });
  })
  .catch((err) => {
    console.error("[-] database connection >", err);
    process.exit(1);
  });

process.on("unhandledRejection", (err) => {
  console.error(err.name, err.message);

  if (server) {
    server.close(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

module.exports = app;
