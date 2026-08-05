import express from "express";
import cors from "cors";
import helmet from "helmet";
import hpp from "hpp";
import cookieParser from "cookie-parser";
import router from "./routes";
import config from "./config";
import { globalLimiter } from "./middlewares/rateLimiter";
import { errorHandler } from "./middlewares/errorHandler";
import { requireJsonContentType } from "./middlewares/requireJsonContentType";

const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(requireJsonContentType);
app.use(express.json());
app.use(cookieParser());
app.use(hpp());
app.use("/api", globalLimiter, router);
app.use(errorHandler);

export default app;
